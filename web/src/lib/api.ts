"use client";

import { useEffect, useState } from "react";
import { ORCHESTRATOR_URL } from "./config";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${ORCHESTRATOR_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Poll an orchestrator endpoint and keep the UI in sync with real chain state. */
export function useApi<T>(path: string, intervalMs = 5000): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const json = await get<T>(path);
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs]);

  return { data, error, loading };
}

export const api = { get };
