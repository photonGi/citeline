/**
 * Enables the Postgres extensions the schema depends on. Drizzle migrations
 * reference `vector` columns but cannot create the extension themselves, so
 * this runs first.
 *
 * Run: npm run db:setup (chained from db:migrate)
 */
import postgres from "postgres";

import { normalizePgUrl } from "@/lib/db/url";
import { env } from "@/lib/env";

async function main() {
  const sql = postgres(normalizePgUrl(env().DATABASE_URL_UNPOOLED), {
    max: 1,
    ssl: "require",
  });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const [row] = await sql<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    console.log(`pgvector ${row.extversion} enabled`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
