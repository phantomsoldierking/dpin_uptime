import { createHmac, randomUUID, scryptSync } from "node:crypto";
import { prismaClient } from "../src";

function hashPassword(password: string): string {
  const salt = "dpin-local-seed";
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function makeNodeApiKey(nodeId: string): string {
  return createHmac("sha256", "dpin-local-api-key").update(nodeId).digest("hex");
}

async function seed() {
  await prismaClient.result.deleteMany();
  await prismaClient.job.deleteMany();
  await prismaClient.websiteRegion.deleteMany();
  await prismaClient.alertConfig.deleteMany();
  await prismaClient.incident.deleteMany();
  await prismaClient.slaRecord.deleteMany();
  await prismaClient.nodeReputation.deleteMany();
  await prismaClient.node.deleteMany();
  await prismaClient.website.deleteMany();
  await prismaClient.user.deleteMany();

  const admin = await prismaClient.user.create({
    data: {
      email: "admin@dpin-local.io",
      passwordHash: hashPassword("admin123"),
      name: "Local Admin",
      role: "ADMIN",
    },
  });

  await prismaClient.user.create({
    data: {
      email: "node@dpin-local.io",
      passwordHash: hashPassword("node123"),
      name: "Node Operator",
      role: "NODE",
    },
  });

  const nodes = [
    {
      id: "validator-us-east-dev",
      region: "us-east-1",
      secret: process.env.VALIDATOR_US_EAST_SECRET ?? "dev-secret-us-east-1234567890",
      latitude: 37.7749,
      longitude: -122.4194,
    },
    {
      id: "validator-eu-west-dev",
      region: "eu-west-1",
      secret: process.env.VALIDATOR_EU_WEST_SECRET ?? "dev-secret-eu-west-1234567890",
      latitude: 53.3498,
      longitude: -6.2603,
    },
    {
      id: "validator-ap-south-dev",
      region: "ap-south-1",
      secret: process.env.VALIDATOR_AP_SOUTH_SECRET ?? "dev-secret-ap-south-1234567890",
      latitude: 19.076,
      longitude: 72.8777,
    },
  ];

  for (const node of nodes) {
    await prismaClient.node.create({
      data: {
        id: node.id,
        name: node.id,
        region: node.region,
        publicKey: node.secret,
        apiKey: makeNodeApiKey(node.id),
        isActive: true,
        lastHeartbeat: new Date(),
        latitude: node.latitude,
        longitude: node.longitude,
        metadata: {
          os: "linux",
          version: "1.0.0-dev",
        },
      },
    });

    await prismaClient.nodeReputation.create({
      data: {
        nodeId: node.id,
        score: 100,
      },
    });
  }

  const websites = [
    {
      name: "Example HTTP",
      slug: "example-http",
      url: "https://httpstat.us/200",
      intervalSeconds: 30,
    },
    {
      name: "Example Slow",
      slug: "example-slow",
      url: "https://httpstat.us/200?sleep=1500",
      intervalSeconds: 60,
    },
    {
      name: "Example Down",
      slug: "example-down",
      url: "https://httpstat.us/500",
      intervalSeconds: 30,
    },
  ];

  for (const website of websites) {
    const created = await prismaClient.website.create({
      data: {
        userId: admin.id,
        name: website.name,
        slug: website.slug,
        url: website.url,
        intervalSeconds: website.intervalSeconds,
        timeoutSeconds: 8,
        expectedStatus: 200,
        checkType: "HTTP",
        isActive: true,
        isPublic: true,
      },
    });

    for (const region of ["us-east-1", "eu-west-1", "ap-south-1"]) {
      await prismaClient.websiteRegion.create({
        data: {
          websiteId: created.id,
          region,
          minNodes: 1,
          isEnabled: true,
        },
      });
    }

    const seedJob = await prismaClient.job.create({
      data: {
        websiteId: created.id,
        region: "us-east-1",
        status: "COMPLETED",
        scheduledAt: new Date(Date.now() - 60_000),
        assignedNodeIds: ["validator-us-east-dev"],
        completedAt: new Date(Date.now() - 30_000),
      },
    });

    await prismaClient.result.create({
      data: {
        jobId: seedJob.id,
        nodeId: "validator-us-east-dev",
        websiteId: created.id,
        region: "us-east-1",
        status: website.slug === "example-down" ? "DOWN" : "UP",
        statusCode: website.slug === "example-down" ? 500 : 200,
        responseTimeMs: website.slug === "example-slow" ? 1800 : 180,
        dnsTimeMs: 25,
        tcpTimeMs: 45,
        tlsTimeMs: 40,
        ttfbMs: 70,
        signature: randomUUID().replace(/-/g, ""),
        isConsensus: true,
        timestamp: new Date(Date.now() - 30_000),
      },
    });
  }

  const exampleDown = await prismaClient.website.findUnique({ where: { slug: "example-down" } });
  if (exampleDown) {
    await prismaClient.alertConfig.create({
      data: {
        websiteId: exampleDown.id,
        userId: admin.id,
        type: "DOWNTIME",
        threshold: { downtimeMinutes: 1 },
        channels: {
          email: { enabled: true, address: "admin@dpin-local.io" },
          slack: { enabled: false, webhookUrl: "" },
          webhook: { enabled: false, url: "" },
        },
        isEnabled: true,
      },
    });
  }

  console.log("Seed complete");
  console.log("Admin: admin@dpin-local.io / admin123");
  console.log("Node:  node@dpin-local.io / node123");
  console.log("Node API keys:");

  for (const node of nodes) {
    console.log(`  ${node.id}: ${makeNodeApiKey(node.id)}`);
  }
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
