import { eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { getDb } from "@/lib/db/client";
import { ingestRuns, sources } from "@/lib/db/schema";
import { resolveSitemap } from "@/lib/ingest/discover";
import { fetchPage, fetchResource, USER_AGENT } from "@/lib/ingest/fetch-page";
import { indexPage, recordPageFailure } from "@/lib/ingest/index-page";
import { isAllowed, parseRobots } from "@/lib/ingest/robots";
import { parseSitemap, selectCrawlTargets, type SitemapEntry } from "@/lib/ingest/sitemap";

import { crawlRequested, inngest } from "../client";

/**
 * Pages per durable step. Small enough to finish inside a serverless
 * invocation on Vercel's Hobby plan, large enough to avoid a step per page.
 */
const PAGES_PER_STEP = 4;

/** Guard against a sitemap index fanning out to hundreds of child sitemaps. */
const MAX_CHILD_SITEMAPS = 10;

export const crawlSource = inngest.createFunction(
  {
    id: "crawl-source",
    triggers: [crawlRequested],
    // One crawl at a time per project: parallel crawls would race on the same
    // documents and multiply the embedding rate-limit pressure.
    concurrency: { limit: 1, key: "event.data.projectId" },
    retries: 3,
    // Runs only once retries are exhausted, so a run left mid-flight by a
    // permanent failure still ends up marked failed in the UI.
    onFailure: async ({ event }) => {
      const original = event.data.event as { data?: { runId?: string } };
      const runId = original?.data?.runId;
      if (!runId) return;

      await getDb()
        .update(ingestRuns)
        .set({
          status: "failed",
          error: event.data.error.message,
          finishedAt: new Date(),
        })
        .where(eq(ingestRuns.id, runId));
    },
  },
  async ({ event, step, logger }) => {
    const { runId, projectId, sourceId } = event.data;
    const db = getDb();

    const source = await step.run("load-source", async () => {
      const [row] = await db
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId))
        .limit(1);
      if (!row) throw new Error(`source ${sourceId} not found`);

      await db
        .update(ingestRuns)
        .set({ status: "running" })
        .where(eq(ingestRuns.id, runId));

      return row;
    });

    const targets = await step.run("discover-urls", async () => {
      const origin = new URL(source.location).origin;

      const robotsResponse = await fetchResource(
        new URL("/robots.txt", origin).toString(),
      );
      const robots = robotsResponse.ok
        ? parseRobots(robotsResponse.body, USER_AGENT)
        : { allow: [], disallow: [], sitemaps: [], crawlDelaySeconds: null };

      // The stored location may be a plain docs URL; find the actual sitemap.
      const resolved = await resolveSitemap(source.location, fetchResource);
      if (!resolved.ok) {
        throw new NonRetriableError(
          `${resolved.error}. Tried: ${resolved.tried.join(", ") || "nothing"}`,
        );
      }

      const root = parseSitemap(resolved.xml);
      let entries: SitemapEntry[] = root.entries;

      // A sitemap index lists further sitemaps rather than pages.
      if (entries.length === 0 && root.sitemaps.length > 0) {
        for (const child of root.sitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
          const childResponse = await fetchResource(child);
          if (!childResponse.ok) continue;
          entries = entries.concat(parseSitemap(childResponse.body).entries);
          if (entries.length >= source.maxPages * 4) break;
        }
      }

      const selected = selectCrawlTargets(entries, {
        origin,
        maxPages: source.maxPages,
        maxDepth: source.maxDepth,
      }).filter((url) => isAllowed(robots, new URL(url).pathname));

      await db
        .update(ingestRuns)
        .set({ pagesDiscovered: selected.length })
        .where(eq(ingestRuns.id, runId));

      return selected;
    });

    if (targets.length === 0) {
      await step.run("finish-empty", async () => {
        await db
          .update(ingestRuns)
          .set({
            status: "failed",
            error: "no crawlable pages found in sitemap",
            finishedAt: new Date(),
          })
          .where(eq(ingestRuns.id, runId));
      });
      return { indexed: 0, skipped: 0, failed: 0 };
    }

    const totals = { indexed: 0, skipped: 0, failed: 0, chunks: 0 };

    for (let start = 0; start < targets.length; start += PAGES_PER_STEP) {
      const batch = targets.slice(start, start + PAGES_PER_STEP);
      const stepId = `index-pages-${start / PAGES_PER_STEP}`;

      const result = await step.run(stepId, async () => {
        const tally = { indexed: 0, skipped: 0, failed: 0, chunks: 0 };

        for (const url of batch) {
          const page = await fetchPage(url);

          if (!page.ok) {
            logger.warn({ url, error: page.error }, "page fetch failed");
            await recordPageFailure({ projectId, sourceId, url, error: page.error });
            tally.failed += 1;
            continue;
          }

          try {
            const outcome = await indexPage({
              projectId,
              sourceId,
              url,
              html: page.html,
            });

            if (outcome.status === "indexed") {
              tally.indexed += 1;
              tally.chunks += outcome.chunkCount;
            } else {
              tally.skipped += 1;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error({ url, error: message }, "page indexing failed");
            await recordPageFailure({ projectId, sourceId, url, error: message });
            tally.failed += 1;
          }
        }

        // Counters are incremented rather than assigned so a retried step
        // cannot clobber progress recorded by its predecessors.
        await db
          .update(ingestRuns)
          .set({
            pagesIndexed: sql`${ingestRuns.pagesIndexed} + ${tally.indexed}`,
            pagesSkipped: sql`${ingestRuns.pagesSkipped} + ${tally.skipped}`,
            pagesFailed: sql`${ingestRuns.pagesFailed} + ${tally.failed}`,
            chunksEmbedded: sql`${ingestRuns.chunksEmbedded} + ${tally.chunks}`,
          })
          .where(eq(ingestRuns.id, runId));

        return tally;
      });

      totals.indexed += result.indexed;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
      totals.chunks += result.chunks;
    }

    await step.run("finish", async () => {
      await db
        .update(ingestRuns)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(ingestRuns.id, runId));
    });

    return totals;
  },
);
