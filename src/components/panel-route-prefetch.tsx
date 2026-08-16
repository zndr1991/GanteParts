"use client";

import type { Route } from "next";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

type PanelRoutePrefetchProps = {
  routes: Route[];
};

export function PanelRoutePrefetch({ routes }: PanelRoutePrefetchProps) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const runPrefetch = () => {
      if (cancelled) return;
      routes.forEach((route) => {
        router.prefetch(route);
      });

      if (routes.some((route) => route === "/inventory" || route.startsWith("/inventory/"))) {
        void fetch("/api/inventory?page=1&pageSize=1&includeMeta=0", {
          cache: "no-store",
          credentials: "same-origin"
        }).catch(() => {
          // Warm-up ligero best-effort: evita forzar carga completa en segundo plano.
        });
      }
    };

    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;

    if (typeof requestIdle === "function") {
      const idleId = requestIdle(runPrefetch, { timeout: 2500 });
      return () => {
        cancelled = true;
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(runPrefetch, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [router, routes]);

  return null;
}
