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
