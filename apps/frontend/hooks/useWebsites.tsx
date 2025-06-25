"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface WebsiteStatusResult {
  id: string;
  status: "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";
  statusCode?: number | null;
  responseTimeMs?: number | null;
  timestamp: string;
}

export interface WebsiteSummary {
  id: string;
  name: string;
  url: string;
  slug: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  uptimePercent: number;
  results: WebsiteStatusResult[];
}

export function useWebsites() {
  const [websites, setWebsites] = useState<WebsiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWebsites = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ websites: WebsiteSummary[] }>("/websites");
      setWebsites(response.data.websites);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load websites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWebsites();
    const timer = setInterval(() => {
      void refreshWebsites();
    }, 20_000);
    return () => clearInterval(timer);
  }, [refreshWebsites]);

  return {
    websites,
    loading,
    error,
    refreshWebsites,
  };
}
