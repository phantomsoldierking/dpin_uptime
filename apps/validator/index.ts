import { URL } from "node:url";
import net from "node:net";
import { signResultPayload, type CheckType, type SiteStatus } from "common";

const HUB_API_URL = process.env.HUB_API_URL ?? "http://localhost:3001/v1";
const NODE_ID = process.env.NODE_ID ?? "validator-us-east-dev";
const NODE_REGION = process.env.NODE_REGION ?? "us-east-1";
const NODE_API_KEY = process.env.NODE_API_KEY ?? "";
const NODE_HMAC_SECRET = process.env.NODE_HMAC_SECRET ?? "";
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? 5);
const HEARTBEAT_INTERVAL_SECONDS = Number(process.env.HEARTBEAT_INTERVAL_SECONDS ?? 30);

if (!NODE_API_KEY) {
  throw new Error("NODE_API_KEY is required");
}
if (!NODE_HMAC_SECRET) {
  throw new Error("NODE_HMAC_SECRET is required");
}

type JobPayload = {
  jobId: string;
  websiteId: string;
  url: string;
  region: string;
  checkType: CheckType;
  expectedStatus: number;
  timeoutSeconds: number;
  expectedBody?: string | null;
  assignedNodeIds: string[];
};

type CheckResult = {
  status: SiteStatus;
  statusCode?: number;
  responseTimeMs?: number;
  dnsTimeMs?: number;
  tcpTimeMs?: number;
  tlsTimeMs?: number;
  ttfbMs?: number;
  errorMessage?: string;
};

function now() {
  return new Date().toISOString();
}

async function sendHeartbeat(): Promise<void> {
  try {
    const response = await fetch(`${HUB_API_URL}/nodes/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-node-id": NODE_ID,
        "x-node-api-key": NODE_API_KEY,
      },
      body: JSON.stringify({
        nodeId: NODE_ID,
        metadata: {
          region: NODE_REGION,
          runtime: "bun",
          version: "1.0.0-dev",
          sentAt: now(),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[validator:${NODE_ID}] heartbeat failed`, response.status, body);
      return;
    }

    console.log(`[validator:${NODE_ID}] heartbeat sent`);
  } catch (error) {
    console.error(`[validator:${NODE_ID}] heartbeat error`, error);
  }
}

async function pollJob(): Promise<JobPayload | null> {
  try {
    const response = await fetch(`${HUB_API_URL}/jobs/poll?nodeId=${encodeURIComponent(NODE_ID)}`, {
      headers: {
        "x-node-id": NODE_ID,
        "x-node-api-key": NODE_API_KEY,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[validator:${NODE_ID}] poll failed`, response.status, body);
      return null;
    }

    const payload = (await response.json()) as { job: JobPayload | null };
    return payload.job;
  } catch (error) {
    console.error(`[validator:${NODE_ID}] poll error`, error);
    return null;
  }
}

async function checkHttp(url: string, timeoutSeconds: number): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });

    const end = Date.now();

    return {
      status: response.ok ? "UP" : "DOWN",
      statusCode: response.status,
      responseTimeMs: end - start,
      dnsTimeMs: 0,
      tcpTimeMs: 0,
      tlsTimeMs: 0,
      ttfbMs: end - start,
    };
  } catch (error) {
    const end = Date.now();
    return {
      status: "DOWN",
      responseTimeMs: end - start,
      errorMessage: error instanceof Error ? error.message : "request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkTcp(rawUrl: string, timeoutSeconds: number): Promise<CheckResult> {
  const parsed = new URL(rawUrl);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  const host = parsed.hostname;
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();

    const finish = (status: SiteStatus, errorMessage?: string) => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({
        status,
        responseTimeMs: elapsed,
        tcpTimeMs: elapsed,
        errorMessage,
      });
    };

    socket.setTimeout(timeoutSeconds * 1000);
    socket.connect(port, host, () => finish("UP"));
    socket.on("timeout", () => finish("DOWN", "TCP timeout"));
    socket.on("error", (error) => finish("DOWN", error.message));
  });
}

async function checkIcmp(url: string, timeoutSeconds: number): Promise<CheckResult> {
  return {
    status: "UNKNOWN",
    errorMessage: `ICMP checks are unavailable in this runtime; fallback required for ${url} (${timeoutSeconds}s)`,
  };
}

async function runCheck(job: JobPayload): Promise<CheckResult> {
  if (job.checkType === "TCP") {
    return checkTcp(job.url, job.timeoutSeconds);
  }

  if (job.checkType === "ICMP") {
    return checkIcmp(job.url, job.timeoutSeconds);
  }

  return checkHttp(job.url, job.timeoutSeconds);
}

async function submitResult(job: JobPayload, result: CheckResult): Promise<void> {
  const payload = {
    jobId: job.jobId,
    nodeId: NODE_ID,
    websiteId: job.websiteId,
    region: job.region,
    status: result.status,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    dnsTimeMs: result.dnsTimeMs,
    tcpTimeMs: result.tcpTimeMs,
    tlsTimeMs: result.tlsTimeMs,
    ttfbMs: result.ttfbMs,
    errorMessage: result.errorMessage,
    timestamp: Date.now(),
  };

  const signature = signResultPayload(payload, NODE_HMAC_SECRET);

  const response = await fetch(`${HUB_API_URL}/results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-node-id": NODE_ID,
      "x-node-api-key": NODE_API_KEY,
    },
    body: JSON.stringify({
      ...payload,
      signature,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Result submission failed (${response.status}): ${text}`);
  }
}

async function loop(): Promise<void> {
  const job = await pollJob();
  if (!job) {
    return;
  }

  console.log(`[validator:${NODE_ID}] received job=${job.jobId} website=${job.websiteId} url=${job.url}`);
  const result = await runCheck(job);

  try {
    await submitResult(job, result);
    console.log(
      `[validator:${NODE_ID}] submitted job=${job.jobId} status=${result.status} latency=${result.responseTimeMs ?? -1}ms`,
    );
  } catch (error) {
    console.error(`[validator:${NODE_ID}] submit error`, error);
  }
}

async function main(): Promise<void> {
  console.log(`[validator:${NODE_ID}] starting region=${NODE_REGION}`);
  console.log(`[validator:${NODE_ID}] hub=${HUB_API_URL}`);

  await sendHeartbeat();

  setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_SECONDS * 1000);

  setInterval(() => {
    void loop();
  }, POLL_INTERVAL_SECONDS * 1000);
}

main().catch((error) => {
  console.error("[validator] fatal", error);
  process.exit(1);
});
