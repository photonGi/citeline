/**
 * Prints row counts for every table, for checking what a sign-in or an
 * ingestion run actually wrote.
 *
 * Run: npm run db:inspect
 */
import postgres from "postgres";

import { normalizePgUrl } from "@/lib/db/url";
import { env } from "@/lib/env";

const TABLES = [
  "user",
  "account",
  "session",
  "project",
  "source",
  "document",
  "chunk",
  "conversation",
  "message",
  "query_log",
  "ingest_run",
] as const;

async function main() {
  const sql = postgres(normalizePgUrl(env().DATABASE_URL_UNPOOLED), {
    max: 1,
    ssl: "require",
  });

  try {
    console.log("");
    for (const table of TABLES) {
      const [row] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM ${sql(table)}
      `;
      console.log(`  ${table.padEnd(14)} ${row.count.padStart(6)}`);
    }

    const [account] = await sql<
      { provider: string; scope: string | null; email: string | null }[]
    >`
      SELECT a.provider, a.scope, u.email
      FROM account a JOIN "user" u ON u.id = a."userId"
      ORDER BY u.email
      LIMIT 1
    `;
    if (account) {
      console.log(
        `\n  linked account: ${account.email} via ${account.provider} (scope: ${account.scope ?? "none"})`,
      );
    }
    console.log("");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
