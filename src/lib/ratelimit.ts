import { Ratelimit } from "@upstash/ratelimit";

import { getRedis } from "./redis";

let limiter: Ratelimit | undefined;

function getLimiter() {
  limiter ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    prefix: "citeline:ask",
    analytics: false,
  });
  return limiter;
}

export type RateLimitVerdict = { allowed: boolean; remaining: number };

/**
 * Fails open: if Upstash is unreachable, answering the question matters more
 * than enforcing a quota on an authenticated surface. Public endpoints should
 * make the opposite choice.
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitVerdict> {
  try {
    const { success, remaining } = await getLimiter().limit(identifier);
    return { allowed: success, remaining };
  } catch {
    return { allowed: true, remaining: -1 };
  }
}
