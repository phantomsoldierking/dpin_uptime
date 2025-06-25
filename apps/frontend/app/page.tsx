import Link from "next/link";
import { ArrowRight, Globe, ShieldCheck, Timer } from "lucide-react";

const features = [
  {
    title: "Regional Checks",
    description: "Run checks from multiple regions to avoid single-point blind spots.",
    icon: Globe,
  },
  {
    title: "Signed Results",
    description: "Validator payloads are HMAC-signed and verified at ingestion.",
    icon: ShieldCheck,
  },
  {
    title: "Low-Latency Loop",
    description: "Scheduler, API, and validators run as a tight feedback loop locally.",
    icon: Timer,
  },
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(6,182,212,0.2),transparent_35%),radial-gradient(circle_at_90%_10%,rgba(251,146,60,0.18),transparent_25%)]" />
      <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-20">
        <p className="mb-4 inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs uppercase tracking-[0.16em] text-cyan-300">
          Local MVP Stack
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-50 md:text-6xl">
          Distributed uptime monitoring with job scheduling, signed validators, and live analytics.
        </h1>
        <p className="mt-6 max-w-2xl text-base text-zinc-300 md:text-lg">
          Register websites, schedule region-aware checks, ingest validator results, and track uptime from a single control plane.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-md bg-cyan-400 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-300"
          >
            Create Account <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center rounded-md border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:border-zinc-500 hover:bg-zinc-900"
          >
            Sign In
          </Link>
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-3">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">
            <feature.icon className="mb-4 h-6 w-6 text-cyan-300" />
            <h2 className="mb-2 text-lg font-semibold text-zinc-100">{feature.title}</h2>
            <p className="text-sm text-zinc-400">{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
