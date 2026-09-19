"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls the server component tree while a crawl is in flight. Polling keeps
 * the progress view honest without adding a websocket layer for one screen.
 */
export function AutoRefresh({
  enabled,
  intervalMs = 3000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, router]);

  return null;
}
