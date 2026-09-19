/**
 * Creates a project from a sitemap and runs its crawl, printing progress until
 * the run finishes. Used for verification and for seeding demo projects.
 *
 * Usage:
 *   npm run crawl -- --url https://orm.drizzle.team --name "Drizzle docs" --max 8
 *   npm run crawl -- --project drizzle-docs-ab12     # re-crawl an existing project
 */
import { randomBytes } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { chunks, documents, ingestRuns, projects, sources, users } from "@/lib/db/schema";
import { crawlRequested, inngest } from "@/lib/inngest/client";
import { slugify } from "@/lib/ingest/normalize";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveProjectAndSource(db: ReturnType<typeof getDb>) {
  const existingSlug = arg("project");

  if (existingSlug) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, existingSlug))
      .limit(1);
    if (!project) throw new Error(`no project with slug ${existingSlug}`);

    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.projectId, project.id))
      .limit(1);
    if (!source) throw new Error(`project ${existingSlug} has no source`);

    return { project, source };
  }

  const url = arg("url");
  if (!url) throw new Error("Missing --url <docs or sitemap URL> (or --project <slug>)");

  const name = arg("name") ?? "Untitled project";
  const maxPages = Number(arg("max") ?? 10);
  const email = arg("email");

  const [owner] = email
    ? await db.select().from(users).where(eq(users.email, email)).limit(1)
    : await db.select().from(users).limit(1);

  if (!owner) throw new Error("No user found. Sign in through the app first.");

  const [project] = await db
    .insert(projects)
    .values({
      ownerId: owner.id,
      name,
      slug: `${slugify(name)}-${randomBytes(2).toString("hex")}`,
    })
    .returning();

  const [source] = await db
    .insert(sources)
    .values({ projectId: project.id, kind: "sitemap", location: url, maxPages })
    .returning();

  return { project, source };
}

async function main() {
  const db = getDb();

  const { project, source } = await resolveProjectAndSource(db).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

  const [run] = await db
    .insert(ingestRuns)
    .values({ projectId: project.id, sourceId: source.id, status: "queued" })
    .returning();

  console.log(`\n  project ${project.slug}`);
  console.log(`  crawling ${source.location}, max ${source.maxPages} pages\n`);

  await inngest.send(
    crawlRequested.create({
      runId: run.id,
      projectId: project.id,
      sourceId: source.id,
    }),
  );

  const deadline = Date.now() + TIMEOUT_MS;
  let lastLine = "";

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const [current] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, run.id))
      .limit(1);

    const line = `  ${current.status}: discovered ${current.pagesDiscovered}, indexed ${current.pagesIndexed}, unchanged ${current.pagesSkipped}, failed ${current.pagesFailed}, chunks ${current.chunksEmbedded}`;
    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }

    if (current.status === "completed" || current.status === "failed") {
      if (current.error) console.log(`\n  error: ${current.error}`);
      break;
    }
  }

  const sample = await db
    .select({
      headingPath: chunks.headingPath,
      tokenCount: chunks.tokenCount,
      content: chunks.content,
      url: documents.url,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(eq(chunks.projectId, project.id))
    .orderBy(desc(chunks.tokenCount))
    .limit(3);

  console.log("\n  sample chunks:");
  for (const chunk of sample) {
    console.log(`\n  ── ${chunk.headingPath || "(no heading)"} · ${chunk.tokenCount} tokens`);
    console.log(`     ${chunk.url}`);
    console.log(`     ${chunk.content.replace(/\s+/g, " ").slice(0, 160)}…`);
  }

  console.log("");
  process.exit(0);
}

void main();
