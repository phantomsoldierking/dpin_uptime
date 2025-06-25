"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { clearSession, getSessionUser, type SessionUser } from "@/lib/auth";

export function Appbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSessionUser());
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-zinc-100">
          <Activity className="h-5 w-5 text-cyan-400" />
          <span className="text-sm font-semibold tracking-wider">DPIN UPTIME</span>
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link href="/dashboard" className="rounded px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white">
                Dashboard
              </Link>
              <span className="hidden text-zinc-500 sm:inline">{user.email}</span>
              <button
                type="button"
                onClick={() => {
                  clearSession();
                  setUser(null);
                  router.push("/login");
                }}
                className="rounded bg-zinc-800 px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white">
                Login
              </Link>
              <Link href="/register" className="rounded bg-cyan-500 px-3 py-1.5 font-medium text-zinc-950 hover:bg-cyan-400">
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
