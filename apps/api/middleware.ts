import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prismaClient } from "db/client";
import type { AuthTokenPayload, UserRole } from "common";
import { config } from "./config";

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return authHeader.trim();
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
    if (!decoded?.sub || decoded.type !== "access") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.authUser = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.authUser.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}

function getNodeIdFromRequest(req: Request): string {
  const header = req.headers["x-node-id"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }

  const queryNodeId = req.query.nodeId;
  if (typeof queryNodeId === "string" && queryNodeId.trim()) {
    return queryNodeId.trim();
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyNodeId = body?.nodeId;
  if (typeof bodyNodeId === "string" && bodyNodeId.trim()) {
    return bodyNodeId.trim();
  }

  return "";
}

function getNodeApiKeyFromRequest(req: Request): string {
  const header = req.headers["x-node-api-key"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("node ")) {
    return authHeader.slice(5).trim();
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyKey = body?.apiKey;
  if (typeof bodyKey === "string" && bodyKey.trim()) {
    return bodyKey.trim();
  }

  return "";
}

export async function nodeAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const nodeId = getNodeIdFromRequest(req);
  const nodeApiKey = getNodeApiKeyFromRequest(req);

  if (!nodeId || !nodeApiKey) {
    res.status(401).json({ error: "Missing node credentials" });
    return;
  }

  const node = await prismaClient.node.findUnique({ where: { id: nodeId } });
  if (!node || !node.isActive) {
    res.status(401).json({ error: "Invalid node" });
    return;
  }

  const lhs = Buffer.from(node.apiKey);
  const rhs = Buffer.from(nodeApiKey);
  if (lhs.length !== rhs.length || !timingSafeEqual(lhs, rhs)) {
    res.status(401).json({ error: "Invalid node credentials" });
    return;
  }

  req.nodeAuth = {
    id: node.id,
    region: node.region,
    apiKey: node.apiKey,
  };

  next();
}
