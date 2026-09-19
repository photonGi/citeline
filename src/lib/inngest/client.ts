import { Inngest, eventType } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({ id: "citeline" });

/**
 * Typed event definition. Inngest v4 validates against any Standard Schema, so
 * the Zod schema below is enforced at runtime as well as compile time.
 */
export const crawlRequested = eventType("citeline/source.crawl.requested", {
  schema: z.object({
    runId: z.string(),
    projectId: z.string(),
    sourceId: z.string(),
  }),
});
