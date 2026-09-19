/**
 * Verifies every external service the app depends on, so a bad credential
 * surfaces here instead of halfway through a feature.
 *
 * Run: npm run check
 */
import { embed, generateText } from "ai";
import postgres from "postgres";

import {
  CHAT_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  chatModel,
  embeddingModel,
  embeddingOptions,
} from "@/lib/ai/gemini";
import { normalizePgUrl } from "@/lib/db/url";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";

type Check = { name: string; run: () => Promise<string> };

async function withSql<T>(
  url: string,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(normalizePgUrl(url), {
    max: 1,
    ssl: "require",
    prepare: false,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const checks: Check[] = [
  {
    name: "Environment variables",
    run: async () => {
      env();
      return "all required variables present";
    },
  },
  {
    name: "Neon Postgres (direct)",
    run: () =>
      withSql(env().DATABASE_URL_UNPOOLED, async (sql) => {
        const [server] = await sql<{ v: string }[]>`SELECT version() AS v`;
        const [vector] = await sql<{ default_version: string }[]>`
          SELECT default_version FROM pg_available_extensions WHERE name = 'vector'
        `;
        if (!vector) throw new Error("pgvector is not available on this instance");
        return `${server.v.split(" ").slice(0, 2).join(" ")}, pgvector ${vector.default_version} available`;
      }),
  },
  {
    name: "Neon Postgres (pooled)",
    run: () =>
      withSql(env().DATABASE_URL, async (sql) => {
        const [row] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
        return `connected to ${row.db} through pooler`;
      }),
  },
  {
    name: "Upstash Redis",
    run: async () => {
      const redis = getRedis();
      const key = `citeline:healthcheck:${Date.now()}`;
      await redis.set(key, "ok", { ex: 30 });
      const value = await redis.get<string>(key);
      await redis.del(key);
      if (value !== "ok") throw new Error(`unexpected round-trip value: ${value}`);
      return "set/get/del round-trip succeeded";
    },
  },
  {
    name: "Gemini embeddings",
    run: async () => {
      const { embedding } = await embed({
        model: embeddingModel,
        value: "How do I refresh an access token?",
        providerOptions: embeddingOptions("query"),
      });
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `expected ${EMBEDDING_DIMENSIONS} dimensions, received ${embedding.length}`,
        );
      }
      return `${EMBEDDING_MODEL_ID} returned ${embedding.length} dimensions`;
    },
  },
  {
    name: "Gemini generation",
    run: async () => {
      const { text } = await generateText({
        model: chatModel,
        prompt: 'Reply with the single word "ready" and nothing else.',
      });
      return `${CHAT_MODEL_ID} replied "${text.trim().slice(0, 20)}"`;
    },
  },
  {
    name: "GitHub OAuth app",
    run: async () => {
      // Probing the token endpoint with a deliberately invalid code
      // distinguishes valid credentials (bad_verification_code) from invalid
      // ones (incorrect_client_credentials) without needing a browser.
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: env().AUTH_GITHUB_ID,
          client_secret: env().AUTH_GITHUB_SECRET,
          code: "citeline-healthcheck-invalid-code",
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (body.error === "bad_verification_code") {
        return "client id and secret accepted by GitHub";
      }
      throw new Error(body.error ?? "unexpected response from GitHub");
    },
  },
  {
    name: "Inngest event key",
    run: async () => {
      const eventKey = env().INNGEST_EVENT_KEY;
      if (!eventKey) return "skipped (not set; dev server runs unauthenticated)";
      const response = await fetch(`https://inn.gs/e/${eventKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "citeline/healthcheck",
          data: { at: new Date().toISOString() },
        }),
      });
      if (!response.ok) {
        throw new Error(`event API returned ${response.status}`);
      }
      return "test event accepted";
    },
  },
];

async function main() {
  console.log("");
  let failed = 0;

  for (const check of checks) {
    const started = Date.now();
    try {
      const detail = await check.run();
      console.log(
        `  PASS  ${check.name.padEnd(24)} ${detail} (${Date.now() - started}ms)`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  FAIL  ${check.name.padEnd(24)} ${message}`);
    }
  }

  console.log(
    failed === 0
      ? "\n  All services reachable.\n"
      : `\n  ${failed} check(s) failed.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
