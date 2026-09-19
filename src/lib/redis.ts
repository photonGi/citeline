import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

let client: Redis | undefined;

/**
 * HTTP-based client: Upstash's redis:// protocol does not work on Vercel.
 * Resolved on first use so importing this module needs no environment.
 */
export function getRedis() {
  client ??= new Redis({
    url: env().UPSTASH_REDIS_REST_URL,
    token: env().UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}
