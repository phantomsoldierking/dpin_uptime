"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Clock, Plus, Server } from "lucide-react";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useWebsites } from "@/hooks/useWebsites";

type Overview = {
  totals: {
    activeWebsites: number;
    activeNodes: number;
    openIncidents: number;
    uptimePercent: number;
  };
};

type SlaRecord = {
  id: string;
  region: string;
  date: string;
  uptimePercent: number;
  avgResponseMs: number | null;
  website: {
    id: string;
    name: string;
    slug: string;
  };
};

const defaultOverview: Overview = {
  totals: {
    activeWebsites: 0,
    activeNodes: 0,
    openIncidents: 0,
    uptimePercent: 100,
  },
};

function statusBadge(status?: string) {
  if (status === "UP") {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  }
  if (status === "DOWN") {
    return "bg-rose-500/15 text-rose-300 border-rose-500/40";
  }
  return "bg-zinc-800 text-zinc-300 border-zinc-600";
}

export default function DashboardPage() {
  const router = useRouter();
  const { websites, loading, error, refreshWebsites } = useWebsites();
  const [overview, setOverview] = useState<Overview>(defaultOverview);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slaRecords, setSlaRecords] = useState<SlaRecord[]>([]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }

    void api
      .get<Overview>("/analytics/overview")
      .then((response) => setOverview(response.data))
      .catch(() => {
        setOverview(defaultOverview);
      });

    void api
      .get<{ records: SlaRecord[] }>("/analytics/sla?days=7")
      .then((response) => setSlaRecords(response.data.records))
      .catch(() => setSlaRecords([]));
  }, [router, websites.length]);

  const cards = useMemo(
    () => [
      {
        label: "Active Websites",
        value: overview.totals.activeWebsites,
        icon: Server,
      },
      {
        label: "Active Nodes",
        value: overview.totals.activeNodes,
        icon: Activity,
      },
      {
        label: "Open Incidents",
        value: overview.totals.openIncidents,
        icon: Clock,
      },
      {
        label: "Uptime (24h)",
        value: `${overview.totals.uptimePercent.toFixed(2)}%`,
        icon: Activity,
      },
    ],
    [overview],
  );

  async function createWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await api.post("/websites", {
        name,
        url,
        intervalSeconds,
        timeoutSeconds: 8,
        expectedStatus: 200,
        checkType: "HTTP",
        regions: ["us-east-1", "eu-west-1", "ap-south-1"],
      });

      setName("");
      setUrl("");
      setIntervalSeconds(30);
      await refreshWebsites();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create website");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">{card.label}</p>
              <card.icon className="h-4 w-4 text-cyan-300" />
            </div>
            <p className="text-2xl font-semibold text-zinc-100">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_2fr]">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="h-4 w-4 text-cyan-300" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-300">Add Website</h2>
          </div>

          <form onSubmit={createWebsite} className="space-y-3">
            <input
              type="text"
              placeholder="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
              required
            />
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
              required
            />
            <input
              type="number"
              min={5}
              max={3600}
              value={intervalSeconds}
              onChange={(event) => setIntervalSeconds(Number(event.target.value))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
              required
            />

            {formError ? <p className="text-xs text-rose-400">{formError}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Monitor"}
            </button>
          </form>
        </article>

        <article className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-300">Monitored Websites</h2>

          {loading ? <p className="text-sm text-zinc-400">Loading websites...</p> : null}
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          {!loading && websites.length === 0 ? <p className="text-sm text-zinc-400">No websites configured yet.</p> : null}

          <div className="space-y-3">
            {websites.map((website) => {
              const latest = website.results[0];
              return (
                <div key={website.id} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{website.name}</p>
                      <p className="text-xs text-zinc-400">{website.url}</p>
                    </div>

                    <span className={`rounded border px-2 py-1 text-xs ${statusBadge(latest?.status)}`}>
                      {latest?.status ?? "UNKNOWN"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                    <span>Uptime: {website.uptimePercent.toFixed(2)}%</span>
                    <span>Interval: {website.intervalSeconds}s</span>
                    <span>Last Latency: {latest?.responseTimeMs ?? "-"}ms</span>
                    <span>HTTP: {latest?.statusCode ?? "-"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-300">SLA (Last 7 Days)</h2>
        {slaRecords.length === 0 ? (
          <p className="text-sm text-zinc-400">No SLA records yet. Run hub for at least one aggregation cycle.</p>
        ) : (
          <div className="space-y-2">
            {slaRecords.slice(0, 8).map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs">
                <span className="text-zinc-300">{record.website.name}</span>
                <span className="text-zinc-400">{record.region}</span>
                <span className="text-cyan-300">{record.uptimePercent.toFixed(2)}%</span>
                <span className="text-zinc-400">{record.avgResponseMs ? `${record.avgResponseMs.toFixed(1)}ms` : "-"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
