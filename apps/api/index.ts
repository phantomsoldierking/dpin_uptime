import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { prismaClient } from "db/client";
import {
  signResultPayload,
  toSlug,
  type AuthTokenPayload,
  type ResultIngestionBody,
  type SiteStatus,
  type UserRole,
} from "common";
import { config } from "./config";
import { authMiddleware, nodeAuthMiddleware, requireRoles } from "./middleware";

const app = express();
app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const requestMetrics = new Map<string, number>();
const resultMetrics = new Map<SiteStatus, number>();
const extraMetrics = {
  invalidSignatures: 0,
  resultIngestions: 0,
};

app.use((req, res, next) => {
  res.on("finish", () => {
    const key = `${req.method} ${req.path} ${res.statusCode}`;
    requestMetrics.set(key, (requestMetrics.get(key) ?? 0) + 1);
  });
  next();
});

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) {
    return false;
  }

  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  const lhs = Buffer.from(hash, "hex");
  const rhs = Buffer.from(passwordHash, "hex");

  if (lhs.length !== rhs.length) {
    return false;
  }

  return timingSafeEqual(lhs, rhs);
}

function issueToken(payload: AuthTokenPayload, expiresIn: string): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function issueTokens(user: { id: string; email: string; role: UserRole }) {
  const accessPayload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    type: "access",
  };

  const refreshPayload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    type: "refresh",
  };

  return {
    accessToken: issueToken(accessPayload, config.jwtExpiry),
    refreshToken: issueToken(refreshPayload, config.refreshTokenExpiry),
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function parseInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeStatus(status: SiteStatus): SiteStatus {
  if (status === "DEGRADED") {
    return "DOWN";
  }
  return status;
}

async function evaluateConsensus(jobId: string): Promise<void> {
  const job = await prismaClient.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return;
  }

  const results = await prismaClient.result.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
  if (results.length === 0) {
    return;
  }

  const counts = new Map<SiteStatus, number>();
  for (const result of results) {
    const status = normalizeStatus(result.status as SiteStatus);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  let majorityStatus: SiteStatus = "UNKNOWN";
  let majorityCount = 0;
  for (const [status, count] of counts.entries()) {
    if (count > majorityCount) {
      majorityStatus = status;
      majorityCount = count;
    }
  }

  const expectedNodes = Math.max(job.assignedNodeIds.length, 1);
  const reachedMajority = majorityCount >= Math.ceil(expectedNodes / 2);
  const enoughReports = results.length >= expectedNodes;
  if (!reachedMajority && !enoughReports) {
    if (job.status === "ASSIGNED" || job.status === "PENDING") {
      await prismaClient.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
    }
    return;
  }

  await prismaClient.$transaction(async (tx) => {
    await tx.result.updateMany({
      where: { jobId },
      data: { isConsensus: false },
    });

    await tx.result.updateMany({
      where: { jobId, status: majorityStatus },
      data: { isConsensus: true },
    });

    await tx.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    const consensusResult = await tx.result.findFirst({
      where: { jobId, status: majorityStatus },
      orderBy: { createdAt: "asc" },
    });

    if (!consensusResult) {
      return;
    }

    if (majorityStatus === "DOWN") {
      const alertConfigs = await tx.alertConfig.findMany({
        where: {
          websiteId: consensusResult.websiteId,
          isEnabled: true,
          type: "DOWNTIME",
        },
      });

      for (const alert of alertConfigs) {
        await tx.incident.create({
          data: {
            alertConfigId: alert.id,
            websiteId: consensusResult.websiteId,
            startedAt: new Date(),
            severity: "HIGH",
            summary: `Website down in ${consensusResult.region}`,
            notifiedAt: new Date(),
          },
        });
      }
    } else {
      await tx.incident.updateMany({
        where: {
          websiteId: consensusResult.websiteId,
          resolvedAt: null,
        },
        data: {
          resolvedAt: new Date(),
        },
      });
    }
  });
}

async function updateNodeReputation(nodeId: string, isSuccess: boolean): Promise<void> {
  const rep = await prismaClient.nodeReputation.findUnique({ where: { nodeId } });
  if (!rep) {
    await prismaClient.nodeReputation.create({
      data: {
        nodeId,
        score: isSuccess ? 100 : 95,
        totalChecks: 1,
        successChecks: isSuccess ? 1 : 0,
        falseReports: isSuccess ? 0 : 1,
      },
    });
    return;
  }

  const penalty = isSuccess ? 0 : 2;
  const reward = isSuccess ? 0.1 : 0;

  await prismaClient.nodeReputation.update({
    where: { nodeId },
    data: {
      totalChecks: { increment: 1 },
      successChecks: { increment: isSuccess ? 1 : 0 },
      falseReports: { increment: isSuccess ? 0 : 1 },
      score: Math.max(0, Math.min(100, rep.score - penalty + reward)),
      lastPenalizedAt: isSuccess ? rep.lastPenalizedAt : new Date(),
    },
  });
}

async function getWebsiteIdsForUser(userId: string): Promise<string[]> {
  const websites = await prismaClient.website.findMany({
    where: { userId },
    select: { id: true },
  });

  return websites.map((website) => website.id);
}

const v1 = express.Router();

v1.post("/auth/register", async (req, res) => {
  try {
    const email = requireString(req.body?.email, "email").toLowerCase();
    const password = requireString(req.body?.password, "password");
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
    const role = (req.body?.role === "NODE" ? "NODE" : "ADMIN") as UserRole;

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const exists = await prismaClient.user.findUnique({ where: { email } });
    if (exists) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const user = await prismaClient.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        name,
        role,
      },
    });

    const tokens = issueTokens({ id: user.id, email: user.email, role: user.role as UserRole });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      ...tokens,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.post("/auth/login", async (req, res) => {
  try {
    const email = requireString(req.body?.email, "email").toLowerCase();
    const password = requireString(req.body?.password, "password");

    const user = await prismaClient.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const tokens = issueTokens({ id: user.id, email: user.email, role: user.role as UserRole });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      ...tokens,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.post("/auth/refresh", async (req, res) => {
  try {
    const refreshToken = requireString(req.body?.refreshToken, "refreshToken");
    const decoded = jwt.verify(refreshToken, config.jwtSecret) as AuthTokenPayload;

    if (!decoded?.sub || decoded.type !== "refresh") {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    const user = await prismaClient.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    const tokens = issueTokens({ id: user.id, email: user.email, role: user.role as UserRole });
    res.json(tokens);
  } catch {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

v1.get("/auth/me", authMiddleware, async (req, res) => {
  const user = await prismaClient.user.findUnique({
    where: { id: req.authUser!.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  res.json({ user });
});

v1.post("/websites", authMiddleware, async (req, res) => {
  try {
    const name = requireString(req.body?.name ?? req.body?.url, "name");
    const url = requireString(req.body?.url, "url");
    const checkType =
      req.body?.checkType === "HTTPS" || req.body?.checkType === "TCP" || req.body?.checkType === "ICMP"
        ? req.body.checkType
        : "HTTP";

    const intervalSeconds = parseInteger(req.body?.intervalSeconds, 60, 5, 3600);
    const timeoutSeconds = parseInteger(req.body?.timeoutSeconds, 10, 2, 60);
    const expectedStatus = parseInteger(req.body?.expectedStatus, 200, 100, 599);
    const expectedBody = typeof req.body?.expectedBody === "string" ? req.body.expectedBody : null;
    const isPublic = Boolean(req.body?.isPublic);

    const requestedRegions = Array.isArray(req.body?.regions)
      ? req.body.regions.filter((region: unknown): region is string => typeof region === "string" && region.trim() !== "")
      : ["us-east-1", "eu-west-1", "ap-south-1"];

    const slugBase = toSlug(name || url);
    const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;

    const website = await prismaClient.website.create({
      data: {
        userId: req.authUser!.id,
        name,
        url,
        slug,
        checkType,
        intervalSeconds,
        timeoutSeconds,
        expectedStatus,
        expectedBody,
        isPublic,
        regionConfigs: {
          create: requestedRegions.map((region) => ({
            region,
            minNodes: 1,
            isEnabled: true,
          })),
        },
      },
      include: {
        regionConfigs: true,
      },
    });

    res.status(201).json(website);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.get("/websites", authMiddleware, async (req, res) => {
  const websites = await prismaClient.website.findMany({
    where: {
      userId: req.authUser!.id,
      isActive: true,
    },
    include: {
      regionConfigs: true,
      results: {
        orderBy: { timestamp: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const withUptime = await Promise.all(
    websites.map(async (website) => {
      const total = await prismaClient.result.count({ where: { websiteId: website.id } });
      const up = await prismaClient.result.count({
        where: {
          websiteId: website.id,
          status: "UP",
        },
      });

      return {
        ...website,
        uptimePercent: total === 0 ? 100 : Number(((up / total) * 100).toFixed(2)),
      };
    }),
  );

  res.json({ websites: withUptime });
});

v1.get("/websites/:websiteId", authMiddleware, async (req, res) => {
  const website = await prismaClient.website.findFirst({
    where: {
      id: req.params.websiteId,
      userId: req.authUser!.id,
    },
    include: {
      regionConfigs: true,
      alerts: true,
      results: {
        orderBy: { timestamp: "desc" },
        take: 20,
      },
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json(website);
});

v1.put("/websites/:websiteId", authMiddleware, async (req, res) => {
  const website = await prismaClient.website.findFirst({
    where: {
      id: req.params.websiteId,
      userId: req.authUser!.id,
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const updated = await prismaClient.website.update({
    where: { id: website.id },
    data: {
      name: typeof req.body?.name === "string" ? req.body.name : website.name,
      url: typeof req.body?.url === "string" ? req.body.url : website.url,
      intervalSeconds:
        typeof req.body?.intervalSeconds === "number"
          ? parseInteger(req.body.intervalSeconds, website.intervalSeconds, 5, 3600)
          : website.intervalSeconds,
      timeoutSeconds:
        typeof req.body?.timeoutSeconds === "number"
          ? parseInteger(req.body.timeoutSeconds, website.timeoutSeconds, 2, 60)
          : website.timeoutSeconds,
      expectedStatus:
        typeof req.body?.expectedStatus === "number"
          ? parseInteger(req.body.expectedStatus, website.expectedStatus, 100, 599)
          : website.expectedStatus,
      expectedBody: typeof req.body?.expectedBody === "string" ? req.body.expectedBody : website.expectedBody,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : website.isActive,
      isPublic: typeof req.body?.isPublic === "boolean" ? req.body.isPublic : website.isPublic,
    },
    include: { regionConfigs: true },
  });

  res.json(updated);
});

v1.delete("/websites/:websiteId", authMiddleware, async (req, res) => {
  const website = await prismaClient.website.findFirst({
    where: {
      id: req.params.websiteId,
      userId: req.authUser!.id,
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  await prismaClient.website.update({
    where: { id: website.id },
    data: { isActive: false },
  });

  res.json({ success: true });
});

v1.get("/websites/:websiteId/results", authMiddleware, async (req, res) => {
  const limit = parseInteger(Number(req.query.limit ?? 30), 30, 1, 500);

  const website = await prismaClient.website.findFirst({
    where: {
      id: req.params.websiteId,
      userId: req.authUser!.id,
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const results = await prismaClient.result.findMany({
    where: {
      websiteId: website.id,
    },
    include: {
      node: {
        select: { id: true, region: true, name: true },
      },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  res.json({ results });
});

v1.post("/nodes/register", authMiddleware, requireRoles("ADMIN", "SUPER"), async (req, res) => {
  try {
    const nodeId = requireString(req.body?.nodeId ?? req.body?.id, "nodeId");
    const region = requireString(req.body?.region, "region");
    const hmacSecret = requireString(req.body?.hmacSecret ?? req.body?.publicKey, "hmacSecret");
    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : nodeId;
    const apiKey =
      typeof req.body?.apiKey === "string" && req.body.apiKey.trim()
        ? req.body.apiKey.trim()
        : randomBytes(24).toString("hex");

    const upserted = await prismaClient.node.upsert({
      where: { id: nodeId },
      create: {
        id: nodeId,
        name,
        region,
        publicKey: hmacSecret,
        apiKey,
        isActive: true,
        metadata: req.body?.metadata ?? {},
        latitude: typeof req.body?.latitude === "number" ? req.body.latitude : null,
        longitude: typeof req.body?.longitude === "number" ? req.body.longitude : null,
        lastHeartbeat: new Date(),
      },
      update: {
        name,
        region,
        publicKey: hmacSecret,
        apiKey,
        isActive: true,
        metadata: req.body?.metadata ?? undefined,
        latitude: typeof req.body?.latitude === "number" ? req.body.latitude : undefined,
        longitude: typeof req.body?.longitude === "number" ? req.body.longitude : undefined,
      },
    });

    await prismaClient.nodeReputation.upsert({
      where: { nodeId: upserted.id },
      create: { nodeId: upserted.id, score: 100 },
      update: {},
    });

    res.status(201).json({
      node: {
        id: upserted.id,
        name: upserted.name,
        region: upserted.region,
        apiKey: upserted.apiKey,
      },
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.get("/nodes", authMiddleware, requireRoles("ADMIN", "SUPER"), async (_req, res) => {
  const cutoff = new Date(Date.now() - config.nodeHeartbeatGraceSeconds * 1000);

  const nodes = await prismaClient.node.findMany({
    include: {
      reputation: true,
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    nodes: nodes.map((node) => ({
      ...node,
      isOnline: Boolean(node.lastHeartbeat && node.lastHeartbeat >= cutoff),
    })),
  });
});

v1.get("/nodes/:nodeId", authMiddleware, requireRoles("ADMIN", "SUPER"), async (req, res) => {
  const node = await prismaClient.node.findUnique({
    where: { id: req.params.nodeId },
    include: { reputation: true },
  });

  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }

  res.json({ node });
});

v1.post("/nodes/heartbeat", nodeAuthMiddleware, async (req, res) => {
  await prismaClient.node.update({
    where: { id: req.nodeAuth!.id },
    data: {
      lastHeartbeat: new Date(),
      isActive: true,
      metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : undefined,
    },
  });

  res.json({ success: true, timestamp: new Date().toISOString() });
});

v1.get("/jobs", authMiddleware, requireRoles("ADMIN", "SUPER"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const allowedStatuses = ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "FAILED", "TIMED_OUT"];
  const safeStatus = status && allowedStatuses.includes(status) ? status : undefined;

  const jobs = await prismaClient.job.findMany({
    where: {
      ...(safeStatus
        ? { status: safeStatus as "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "TIMED_OUT" }
        : {}),
    },
    include: {
      website: {
        select: { id: true, name: true, url: true },
      },
    },
    orderBy: { scheduledAt: "desc" },
    take: 200,
  });

  res.json({ jobs });
});

v1.get("/jobs/:jobId", authMiddleware, requireRoles("ADMIN", "SUPER"), async (req, res) => {
  const job = await prismaClient.job.findUnique({
    where: { id: req.params.jobId },
    include: {
      website: true,
      results: {
        include: {
          node: {
            select: { id: true, region: true, name: true },
          },
        },
      },
    },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({ job });
});

v1.get("/jobs/poll", nodeAuthMiddleware, async (req, res) => {
  const node = req.nodeAuth!;
  const now = new Date();

  const jobCandidates = await prismaClient.job.findMany({
    where: {
      region: node.region,
      scheduledAt: { lte: now },
      status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
    },
    include: {
      website: true,
      results: {
        where: { nodeId: node.id },
        select: { id: true },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  let selected = jobCandidates.find((job) => {
    if (job.results.length > 0) {
      return false;
    }

    if (job.status === "PENDING") {
      return true;
    }

    return job.assignedNodeIds.includes(node.id);
  });

  if (!selected) {
    res.json({ job: null });
    return;
  }

  if (selected.status === "PENDING") {
    const activeNodes = await prismaClient.node.findMany({
      where: {
        region: node.region,
        isActive: true,
      },
      orderBy: [{ lastHeartbeat: "desc" }, { createdAt: "asc" }],
      take: 3,
      select: { id: true },
    });

    const assignedSet = new Set(activeNodes.map((item) => item.id));
    assignedSet.add(node.id);
    const assignedNodeIds = Array.from(assignedSet);

    selected = await prismaClient.job.update({
      where: { id: selected.id },
      data: {
        status: "ASSIGNED",
        assignedNodeIds,
      },
      include: {
        website: true,
        results: {
          where: { nodeId: node.id },
          select: { id: true },
        },
      },
    });
  }

  if (selected.status === "ASSIGNED") {
    selected = await prismaClient.job.update({
      where: { id: selected.id },
      data: { status: "IN_PROGRESS" },
      include: {
        website: true,
        results: {
          where: { nodeId: node.id },
          select: { id: true },
        },
      },
    });
  }

  if (!selected.assignedNodeIds.includes(node.id) && selected.status !== "PENDING") {
    res.json({ job: null });
    return;
  }

  res.json({
    job: {
      jobId: selected.id,
      websiteId: selected.websiteId,
      url: selected.website.url,
      region: selected.region,
      checkType: selected.website.checkType,
      expectedStatus: selected.website.expectedStatus,
      expectedBody: selected.website.expectedBody,
      timeoutSeconds: selected.website.timeoutSeconds,
      assignedNodeIds: selected.assignedNodeIds,
    },
  });
});

v1.post("/results", async (req, res) => {
  try {
    const body = req.body as Partial<ResultIngestionBody>;

    const normalized: ResultIngestionBody = {
      jobId: requireString(body.jobId, "jobId"),
      nodeId: requireString(body.nodeId, "nodeId"),
      websiteId: requireString(body.websiteId, "websiteId"),
      region: requireString(body.region, "region"),
      status: (body.status ?? "UNKNOWN") as SiteStatus,
      statusCode: typeof body.statusCode === "number" ? body.statusCode : undefined,
      responseTimeMs: typeof body.responseTimeMs === "number" ? body.responseTimeMs : undefined,
      dnsTimeMs: typeof body.dnsTimeMs === "number" ? body.dnsTimeMs : undefined,
      tcpTimeMs: typeof body.tcpTimeMs === "number" ? body.tcpTimeMs : undefined,
      tlsTimeMs: typeof body.tlsTimeMs === "number" ? body.tlsTimeMs : undefined,
      ttfbMs: typeof body.ttfbMs === "number" ? body.ttfbMs : undefined,
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
      timestamp: typeof body.timestamp === "number" ? body.timestamp : Date.now(),
      signature: requireString(body.signature, "signature"),
    };

    if (!["UP", "DOWN", "DEGRADED", "UNKNOWN"].includes(normalized.status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const node = await prismaClient.node.findUnique({ where: { id: normalized.nodeId } });
    if (!node || !node.isActive) {
      res.status(401).json({ error: "Unknown node" });
      return;
    }

    const expectedSignature = signResultPayload(
      {
        jobId: normalized.jobId,
        nodeId: normalized.nodeId,
        websiteId: normalized.websiteId,
        region: normalized.region,
        status: normalized.status,
        statusCode: normalized.statusCode,
        responseTimeMs: normalized.responseTimeMs,
        dnsTimeMs: normalized.dnsTimeMs,
        tcpTimeMs: normalized.tcpTimeMs,
        tlsTimeMs: normalized.tlsTimeMs,
        ttfbMs: normalized.ttfbMs,
        errorMessage: normalized.errorMessage,
        timestamp: normalized.timestamp,
      },
      node.publicKey,
    );

    const lhs = Buffer.from(expectedSignature);
    const rhs = Buffer.from(normalized.signature);
    if (lhs.length !== rhs.length || !timingSafeEqual(lhs, rhs)) {
      extraMetrics.invalidSignatures += 1;
      res.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }

    const job = await prismaClient.job.findUnique({ where: { id: normalized.jobId } });
    if (!job) {
      res.status(404).json({ error: "Unknown job" });
      return;
    }

    if (job.websiteId !== normalized.websiteId || job.region !== normalized.region) {
      res.status(400).json({ error: "Job payload mismatch" });
      return;
    }

    const existing = await prismaClient.result.findUnique({
      where: {
        jobId_nodeId: {
          jobId: normalized.jobId,
          nodeId: normalized.nodeId,
        },
      },
    });

    if (existing) {
      res.status(409).json({ error: "Result already submitted for this job/node" });
      return;
    }

    const result = await prismaClient.result.create({
      data: {
        jobId: normalized.jobId,
        nodeId: normalized.nodeId,
        websiteId: normalized.websiteId,
        region: normalized.region,
        status: normalized.status,
        statusCode: normalized.statusCode,
        responseTimeMs: normalized.responseTimeMs,
        dnsTimeMs: normalized.dnsTimeMs,
        tcpTimeMs: normalized.tcpTimeMs,
        tlsTimeMs: normalized.tlsTimeMs,
        ttfbMs: normalized.ttfbMs,
        errorMessage: normalized.errorMessage,
        signature: normalized.signature,
        timestamp: new Date(normalized.timestamp),
      },
    });

    await prismaClient.node.update({
      where: { id: normalized.nodeId },
      data: { lastHeartbeat: new Date() },
    });

    resultMetrics.set(normalized.status, (resultMetrics.get(normalized.status) ?? 0) + 1);
    extraMetrics.resultIngestions += 1;

    await updateNodeReputation(normalized.nodeId, normalized.status === "UP");
    await evaluateConsensus(normalized.jobId);

    res.status(201).json({ result });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.get("/alerts", authMiddleware, async (req, res) => {
  const websiteIds = await getWebsiteIdsForUser(req.authUser!.id);

  const alerts = await prismaClient.alertConfig.findMany({
    where: {
      websiteId: { in: websiteIds },
    },
    include: {
      website: {
        select: {
          id: true,
          name: true,
          url: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ alerts });
});

v1.post("/alerts", authMiddleware, async (req, res) => {
  try {
    const websiteId = requireString(req.body?.websiteId, "websiteId");

    const website = await prismaClient.website.findFirst({
      where: {
        id: websiteId,
        userId: req.authUser!.id,
      },
    });

    if (!website) {
      res.status(404).json({ error: "Website not found" });
      return;
    }

    const created = await prismaClient.alertConfig.create({
      data: {
        websiteId,
        userId: req.authUser!.id,
        type:
          req.body?.type === "LATENCY_SPIKE" || req.body?.type === "REGION_FAILURE" || req.body?.type === "SLA_BREACH"
            ? req.body.type
            : "DOWNTIME",
        threshold: typeof req.body?.threshold === "object" && req.body.threshold ? req.body.threshold : { downtimeMinutes: 1 },
        channels:
          typeof req.body?.channels === "object" && req.body.channels
            ? req.body.channels
            : {
                email: { enabled: true, address: req.authUser!.email },
                slack: { enabled: false, webhookUrl: "" },
                webhook: { enabled: false, url: "" },
              },
        isEnabled: req.body?.isEnabled !== false,
      },
    });

    res.status(201).json({ alert: created });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

v1.put("/alerts/:alertId", authMiddleware, async (req, res) => {
  const alert = await prismaClient.alertConfig.findUnique({ where: { id: req.params.alertId } });
  if (!alert || alert.userId !== req.authUser!.id) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }

  const allowedTypes = ["DOWNTIME", "LATENCY_SPIKE", "REGION_FAILURE", "SLA_BREACH"];
  const type =
    typeof req.body?.type === "string" && allowedTypes.includes(req.body.type)
      ? req.body.type
      : alert.type;

  const updated = await prismaClient.alertConfig.update({
    where: { id: alert.id },
    data: {
      type,
      threshold: typeof req.body?.threshold === "object" && req.body.threshold ? req.body.threshold : alert.threshold,
      channels: typeof req.body?.channels === "object" && req.body.channels ? req.body.channels : alert.channels,
      isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : alert.isEnabled,
    },
  });

  res.json({ alert: updated });
});

v1.delete("/alerts/:alertId", authMiddleware, async (req, res) => {
  const alert = await prismaClient.alertConfig.findUnique({ where: { id: req.params.alertId } });
  if (!alert || alert.userId !== req.authUser!.id) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }

  await prismaClient.alertConfig.delete({ where: { id: alert.id } });
  res.json({ success: true });
});

v1.get("/analytics/overview", authMiddleware, async (req, res) => {
  const websiteIds = await getWebsiteIdsForUser(req.authUser!.id);

  const [activeWebsites, recentResults, nodes, incidents] = await Promise.all([
    prismaClient.website.count({
      where: {
        userId: req.authUser!.id,
        isActive: true,
      },
    }),
    prismaClient.result.findMany({
      where: {
        websiteId: { in: websiteIds },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    }),
    prismaClient.node.findMany({
      select: {
        id: true,
        region: true,
        lastHeartbeat: true,
        isActive: true,
      },
    }),
    prismaClient.incident.findMany({
      where: {
        websiteId: { in: websiteIds },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
  ]);

  const upResults = recentResults.filter((result) => result.status === "UP").length;
  const uptimePercent = recentResults.length === 0 ? 100 : Number(((upResults / recentResults.length) * 100).toFixed(2));

  const cutoff = Date.now() - config.nodeHeartbeatGraceSeconds * 1000;
  const activeNodes = nodes.filter((node) => node.isActive && node.lastHeartbeat && node.lastHeartbeat.getTime() >= cutoff).length;

  res.json({
    totals: {
      activeWebsites,
      activeNodes,
      openIncidents: incidents.filter((incident) => !incident.resolvedAt).length,
      uptimePercent,
    },
    incidents,
  });
});

v1.get("/analytics/websites/:websiteId", authMiddleware, async (req, res) => {
  const website = await prismaClient.website.findFirst({
    where: {
      id: req.params.websiteId,
      userId: req.authUser!.id,
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const results = await prismaClient.result.findMany({
    where: {
      websiteId: website.id,
      timestamp: { gte: from },
    },
    orderBy: { timestamp: "asc" },
  });

  const total = results.length;
  const up = results.filter((result) => result.status === "UP").length;
  const responseTimes = results.map((item) => item.responseTimeMs ?? 0).filter((value) => value > 0);

  const avgResponseMs =
    responseTimes.length === 0
      ? null
      : Number((responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length).toFixed(2));

  res.json({
    website,
    stats: {
      totalChecks: total,
      successfulChecks: up,
      failedChecks: total - up,
      uptimePercent: total === 0 ? 100 : Number(((up / total) * 100).toFixed(2)),
      avgResponseMs,
    },
    series: results.map((item) => ({
      timestamp: item.timestamp,
      status: item.status,
      responseTimeMs: item.responseTimeMs,
      region: item.region,
    })),
  });
});

v1.get("/analytics/sla", authMiddleware, async (req, res) => {
  const websiteIds = await getWebsiteIdsForUser(req.authUser!.id);
  const days = parseInteger(Number(req.query.days ?? 30), 30, 1, 365);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const records = await prismaClient.slaRecord.findMany({
    where: {
      websiteId: { in: websiteIds },
      date: { gte: from },
    },
    include: {
      website: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: [{ date: "desc" }, { websiteId: "asc" }, { region: "asc" }],
  });

  res.json({ records, days });
});

app.use("/v1", v1);
app.use("/api/v1", v1);

app.get("/metrics", async (_req: Request, res: Response) => {
  const lines: string[] = [];

  lines.push("# HELP dpin_http_requests_total Total HTTP requests handled by endpoint and status");
  lines.push("# TYPE dpin_http_requests_total counter");
  for (const [label, count] of requestMetrics.entries()) {
    const [method, path, status] = label.split(" ");
    lines.push(`dpin_http_requests_total{method=\"${method}\",path=\"${path}\",status=\"${status}\"} ${count}`);
  }

  lines.push("# HELP dpin_checks_total Total ingested check results by status");
  lines.push("# TYPE dpin_checks_total counter");
  for (const [status, count] of resultMetrics.entries()) {
    lines.push(`dpin_checks_total{status=\"${status}\"} ${count}`);
  }

  lines.push("# HELP dpin_invalid_signatures_total Total invalid node signatures");
  lines.push("# TYPE dpin_invalid_signatures_total counter");
  lines.push(`dpin_invalid_signatures_total ${extraMetrics.invalidSignatures}`);

  lines.push("# HELP dpin_result_ingestions_total Total accepted result ingestions");
  lines.push("# TYPE dpin_result_ingestions_total counter");
  lines.push(`dpin_result_ingestions_total ${extraMetrics.resultIngestions}`);

  const nodeCounts = await prismaClient.node.groupBy({
    by: ["region"],
    where: { isActive: true },
    _count: { _all: true },
  });

  lines.push("# HELP dpin_active_nodes_total Active nodes per region");
  lines.push("# TYPE dpin_active_nodes_total gauge");
  for (const item of nodeCounts) {
    lines.push(`dpin_active_nodes_total{region=\"${item.region}\"} ${item._count._all}`);
  }

  res.header("Content-Type", "text/plain; version=0.0.4");
  res.send(lines.join("\n"));
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  });
});

app.get("/", (_req, res) => {
  res.json({
    service: "dpin-api",
    endpoints: [
      "/health",
      "/metrics",
      "/v1/auth",
      "/v1/websites",
      "/v1/nodes",
      "/v1/jobs",
      "/v1/results",
      "/v1/alerts",
      "/v1/analytics",
    ],
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
  const message = error instanceof Error ? error.message : "Internal Server Error";
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`dpin-api listening on port ${config.port}`);
  console.log(`health: http://localhost:${config.port}/health`);
  console.log(`metrics: http://localhost:${config.port}/metrics`);
});
