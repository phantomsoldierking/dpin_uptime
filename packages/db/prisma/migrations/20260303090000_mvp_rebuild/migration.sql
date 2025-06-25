-- Drop old prototype tables
DROP TABLE IF EXISTS "WebsiteTick" CASCADE;
DROP TABLE IF EXISTS "Validator" CASCADE;
DROP TABLE IF EXISTS "Website" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TYPE IF EXISTS "WebsiteStatus" CASCADE;

-- New enums
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'NODE', 'SUPER');
CREATE TYPE "CheckType" AS ENUM ('HTTP', 'HTTPS', 'TCP', 'ICMP');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'TIMED_OUT');
CREATE TYPE "SiteStatus" AS ENUM ('UP', 'DOWN', 'DEGRADED', 'UNKNOWN');
CREATE TYPE "AlertType" AS ENUM ('DOWNTIME', 'LATENCY_SPIKE', 'REGION_FAILURE', 'SLA_BREACH');
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "websites" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "checkType" "CheckType" NOT NULL DEFAULT 'HTTP',
  "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 10,
  "expectedStatus" INTEGER NOT NULL DEFAULT 200,
  "expectedBody" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "stressConfig" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "website_regions" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "minNodes" INTEGER NOT NULL DEFAULT 1,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "website_regions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nodes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastHeartbeat" TIMESTAMP(3),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "node_reputations" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  "totalChecks" INTEGER NOT NULL DEFAULT 0,
  "successChecks" INTEGER NOT NULL DEFAULT 0,
  "falseReports" INTEGER NOT NULL DEFAULT 0,
  "lastPenalizedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "node_reputations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "assignedNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "results" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "status" "SiteStatus" NOT NULL DEFAULT 'UNKNOWN',
  "statusCode" INTEGER,
  "responseTimeMs" INTEGER,
  "dnsTimeMs" INTEGER,
  "tcpTimeMs" INTEGER,
  "tlsTimeMs" INTEGER,
  "ttfbMs" INTEGER,
  "errorMessage" TEXT,
  "signature" TEXT NOT NULL,
  "isConsensus" BOOLEAN NOT NULL DEFAULT false,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_records" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "uptimePercent" DOUBLE PRECISION NOT NULL,
  "avgResponseMs" DOUBLE PRECISION,
  "p95ResponseMs" DOUBLE PRECISION,
  "totalChecks" INTEGER NOT NULL,
  "failedChecks" INTEGER NOT NULL,
  "mttrSeconds" DOUBLE PRECISION,
  "mtbfSeconds" DOUBLE PRECISION,
  CONSTRAINT "sla_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alert_configs" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "AlertType" NOT NULL,
  "threshold" JSONB NOT NULL,
  "channels" JSONB NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incidents" (
  "id" TEXT NOT NULL,
  "alertConfigId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
  "summary" TEXT NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- Indexes & uniques
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "websites_slug_key" ON "websites"("slug");
CREATE INDEX "websites_userId_idx" ON "websites"("userId");
CREATE INDEX "websites_isActive_idx" ON "websites"("isActive");
CREATE UNIQUE INDEX "website_regions_websiteId_region_key" ON "website_regions"("websiteId", "region");
CREATE UNIQUE INDEX "nodes_apiKey_key" ON "nodes"("apiKey");
CREATE INDEX "nodes_region_isActive_idx" ON "nodes"("region", "isActive");
CREATE UNIQUE INDEX "node_reputations_nodeId_key" ON "node_reputations"("nodeId");
CREATE INDEX "jobs_websiteId_region_idx" ON "jobs"("websiteId", "region");
CREATE INDEX "jobs_status_scheduledAt_idx" ON "jobs"("status", "scheduledAt");
CREATE INDEX "results_websiteId_timestamp_idx" ON "results"("websiteId", "timestamp");
CREATE INDEX "results_jobId_idx" ON "results"("jobId");
CREATE INDEX "results_nodeId_timestamp_idx" ON "results"("nodeId", "timestamp");
CREATE UNIQUE INDEX "results_jobId_nodeId_key" ON "results"("jobId", "nodeId");
CREATE UNIQUE INDEX "sla_records_websiteId_region_date_key" ON "sla_records"("websiteId", "region", "date");
CREATE INDEX "incidents_websiteId_idx" ON "incidents"("websiteId");

-- FKs
ALTER TABLE "websites"
  ADD CONSTRAINT "websites_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "website_regions"
  ADD CONSTRAINT "website_regions_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "node_reputations"
  ADD CONSTRAINT "node_reputations_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "results"
  ADD CONSTRAINT "results_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "results"
  ADD CONSTRAINT "results_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "results"
  ADD CONSTRAINT "results_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sla_records"
  ADD CONSTRAINT "sla_records_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_configs"
  ADD CONSTRAINT "alert_configs_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_configs"
  ADD CONSTRAINT "alert_configs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_alertConfigId_fkey"
  FOREIGN KEY ("alertConfigId") REFERENCES "alert_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
