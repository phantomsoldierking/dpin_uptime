import { prismaClient } from "db/client";

const schedulerIntervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 10_000);
const staleJobTimeoutMs = Number(process.env.STALE_JOB_TIMEOUT_MS ?? 120_000);

let running = false;
let aggregatingSLA = false;

async function scheduleDueJobs(): Promise<void> {
  if (running) {
    return;
  }

  running = true;
  try {
    const now = new Date();

    const websites = await prismaClient.website.findMany({
      where: { isActive: true },
      include: {
        regionConfigs: {
          where: { isEnabled: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const website of websites) {
      const lastJob = await prismaClient.job.findFirst({
        where: { websiteId: website.id },
        orderBy: { scheduledAt: "desc" },
        select: { scheduledAt: true },
      });

      const due = !lastJob || now.getTime() - lastJob.scheduledAt.getTime() >= website.intervalSeconds * 1000;
      if (!due) {
        continue;
      }

      for (const regionConfig of website.regionConfigs) {
        await prismaClient.job.create({
          data: {
            websiteId: website.id,
            region: regionConfig.region,
            status: "PENDING",
            scheduledAt: now,
          },
        });
      }

      console.log(
        `[hub] scheduled website=${website.slug} regions=${website.regionConfigs.map((item) => item.region).join(",")}`,
      );
    }

    const staleThreshold = new Date(Date.now() - staleJobTimeoutMs);
    const staleJobs = await prismaClient.job.findMany({
      where: {
        status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
        scheduledAt: { lt: staleThreshold },
      },
      select: { id: true },
      take: 500,
    });

    if (staleJobs.length > 0) {
      await prismaClient.job.updateMany({
        where: { id: { in: staleJobs.map((job) => job.id) } },
        data: { status: "TIMED_OUT", completedAt: new Date() },
      });
      console.log(`[hub] timed out ${staleJobs.length} stale jobs`);
    }
  } catch (error) {
    console.error("[hub] scheduler tick failed", error);
  } finally {
    running = false;
  }
}

async function printHeartbeat(): Promise<void> {
  const [pending, assigned, inProgress, completed] = await Promise.all([
    prismaClient.job.count({ where: { status: "PENDING" } }),
    prismaClient.job.count({ where: { status: "ASSIGNED" } }),
    prismaClient.job.count({ where: { status: "IN_PROGRESS" } }),
    prismaClient.job.count({ where: { status: "COMPLETED" } }),
  ]);

  console.log(`[hub] queue snapshot pending=${pending} assigned=${assigned} inProgress=${inProgress} completed=${completed}`);
}

async function aggregateDailySLARecords(): Promise<void> {
  if (aggregatingSLA) {
    return;
  }

  aggregatingSLA = true;
  try {
    const websites = await prismaClient.website.findMany({
      where: { isActive: true },
      include: { regionConfigs: { where: { isEnabled: true } } },
    });

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    for (const website of websites) {
      for (const regionConfig of website.regionConfigs) {
        const results = await prismaClient.result.findMany({
          where: {
            websiteId: website.id,
            region: regionConfig.region,
            timestamp: { gte: dayStart },
          },
          select: { status: true, responseTimeMs: true },
        });

        const totalChecks = results.length;
        const failedChecks = results.filter((item) => item.status !== "UP").length;
        const upChecks = totalChecks - failedChecks;
        const uptimePercent = totalChecks === 0 ? 100 : Number(((upChecks / totalChecks) * 100).toFixed(4));
        const responseTimes = results
          .map((item) => item.responseTimeMs)
          .filter((item): item is number => typeof item === "number" && item > 0)
          .sort((a, b) => a - b);

        const avgResponseMs =
          responseTimes.length === 0
            ? null
            : responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length;
        const p95Index = responseTimes.length === 0 ? -1 : Math.floor(responseTimes.length * 0.95) - 1;
        const p95ResponseMs = p95Index >= 0 ? responseTimes[Math.max(0, p95Index)] : null;

        await prismaClient.slaRecord.upsert({
          where: {
            websiteId_region_date: {
              websiteId: website.id,
              region: regionConfig.region,
              date: dayStart,
            },
          },
          update: {
            uptimePercent,
            avgResponseMs,
            p95ResponseMs,
            totalChecks,
            failedChecks,
          },
          create: {
            websiteId: website.id,
            region: regionConfig.region,
            date: dayStart,
            uptimePercent,
            avgResponseMs,
            p95ResponseMs,
            totalChecks,
            failedChecks,
          },
        });
      }
    }

    console.log("[hub] SLA aggregation updated");
  } catch (error) {
    console.error("[hub] SLA aggregation failed", error);
  } finally {
    aggregatingSLA = false;
  }
}

async function main(): Promise<void> {
  console.log(`[hub] scheduler starting (tick=${schedulerIntervalMs}ms)`);

  await scheduleDueJobs();

  setInterval(() => {
    void scheduleDueJobs();
  }, schedulerIntervalMs);

  setInterval(() => {
    void printHeartbeat();
  }, 30_000);

  setInterval(() => {
    void aggregateDailySLARecords();
  }, 300_000);
}

main().catch((error) => {
  console.error("[hub] fatal", error);
  process.exit(1);
});
