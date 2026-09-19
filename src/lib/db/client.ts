import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";
import { normalizePgUrl } from "./url";

/**
 * Neon's pooled endpoint sits behind PgBouncer in transaction mode, which does
 * not support prepared statements — hence `prepare: false`. One connection per
 * instance keeps serverless invocations from exhausting the pool.
 */
function createClient() {
  return postgres(normalizePgUrl(env().DATABASE_URL), {
    max: 1,
    prepare: false,
    ssl: "require",
  });
}

const globalForDb = globalThis as unknown as {
  citelineSql?: ReturnType<typeof createClient>;
  citelineDb?: ReturnType<typeof drizzle<typeof schema>>;
};

/**
 * Resolved on first use rather than at import time: importing this module
 * should not open a connection or require a populated environment.
 * Cached on globalThis so hot reloads do not leak connections.
 */
export function getDb() {
  if (!globalForDb.citelineDb) {
    globalForDb.citelineSql ??= createClient();
    globalForDb.citelineDb = drizzle(globalForDb.citelineSql, { schema });
  }
  return globalForDb.citelineDb;
}
