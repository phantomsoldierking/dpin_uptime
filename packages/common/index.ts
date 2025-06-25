import { createHmac } from "node:crypto";

export type UserRole = "ADMIN" | "NODE" | "SUPER";
export type CheckType = "HTTP" | "HTTPS" | "TCP" | "ICMP";
export type JobStatus = "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "TIMED_OUT";
export type SiteStatus = "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: "access" | "refresh";
}

export interface NodeJobPayload {
  jobId: string;
  websiteId: string;
  url: string;
  region: string;
  checkType: CheckType;
  expectedStatus: number;
  timeoutSeconds: number;
  expectedBody?: string | null;
}

export interface ResultIngestionBody {
  jobId: string;
  nodeId: string;
  websiteId: string;
  region: string;
  status: SiteStatus;
  statusCode?: number;
  responseTimeMs?: number;
  dnsTimeMs?: number;
  tcpTimeMs?: number;
  tlsTimeMs?: number;
  ttfbMs?: number;
  errorMessage?: string;
  timestamp: number;
  signature: string;
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function stableResultPayload(payload: Omit<ResultIngestionBody, "signature">): string {
  const ordered = {
    jobId: payload.jobId,
    nodeId: payload.nodeId,
    websiteId: payload.websiteId,
    region: payload.region,
    status: payload.status,
    statusCode: payload.statusCode ?? null,
    responseTimeMs: payload.responseTimeMs ?? null,
    dnsTimeMs: payload.dnsTimeMs ?? null,
    tcpTimeMs: payload.tcpTimeMs ?? null,
    tlsTimeMs: payload.tlsTimeMs ?? null,
    ttfbMs: payload.ttfbMs ?? null,
    errorMessage: payload.errorMessage ?? null,
    timestamp: payload.timestamp,
  };

  return JSON.stringify(ordered);
}

export function signResultPayload(payload: Omit<ResultIngestionBody, "signature">, secret: string): string {
  return createHmac("sha256", secret).update(stableResultPayload(payload)).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}
