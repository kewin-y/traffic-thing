"use client";

import { useEffect, useReducer, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { loadNetwork, type LoadedNetwork } from "../lib/network";

export function useRoadNetwork(
  reference: { name: string; version: string } | null,
) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const published = useQuery(
    api.networks.queries.get,
    isAuthenticated && reference ? reference : "skip",
  );
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  const [result, setResult] = useState<{
    key: string;
    data: LoadedNetwork | null;
    error: boolean;
  } | null>(null);
  const key = `${published?.id ?? ""}:${attempt}`;

  useEffect(() => {
    if (!published) return;
    const controller = new AbortController();
    loadNetwork(published, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: false });
      },
      () => {
        if (!controller.signal.aborted)
          setResult({ key, data: null, error: true });
      },
    );
    return () => controller.abort();
  }, [published, key]);

  const current =
    isAuthenticated && published && result?.key === key ? result : null;
  return {
    data: current?.data ?? null,
    status: authLoading
      ? "loading"
      : !isAuthenticated
        ? "signed-out"
        : !reference || published === null
          ? "missing"
          : current?.error
            ? "error"
            : current?.data
              ? "ready"
              : "loading",
    retry,
  } as const;
}
