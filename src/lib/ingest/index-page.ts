import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { chunks, documents } from "@/lib/db/schema";
import { embedDocuments } from "@/lib/embed";

import { chunkSections, type DocChunk } from "./chunk";
import { contentHash } from "./hash";
import { normalizeHtml } from "./normalize";

export type IndexPageOutcome = {
  status: "indexed" | "skipped" | "failed";
  chunkCount: number;
  reason?: string;
};

export type IndexPageInput = {
  projectId: string;
  sourceId: string;
  url: string;
  html: string;
};

/** Heading trail is embedded alongside the body: it carries real signal. */
function embeddingInput(chunk: DocChunk): string {
  return chunk.headingPath ? `${chunk.headingPath}\n\n${chunk.content}` : chunk.content;
}

/**
 * Indexes one page: normalise, compare against the stored content hash, and
 * re-embed only when the content actually changed. The hash comparison is what
 * makes a re-crawl cheap instead of a full re-index.
 */
export async function indexPage(input: IndexPageInput): Promise<IndexPageOutcome> {
  const db = getDb();
  const { title, sections } = normalizeHtml(input.html);

  const body = sections.map((section) => section.content).join("\n\n").trim();
  if (!body) {
    return { status: "skipped", chunkCount: 0, reason: "no extractable content" };
  }

  const hash = contentHash(body);

  const [existing] = await db
    .select({
      id: documents.id,
      contentHash: documents.contentHash,
      status: documents.status,
    })
    .from(documents)
    .where(and(eq(documents.projectId, input.projectId), eq(documents.url, input.url)))
    .limit(1);

  if (existing && existing.contentHash === hash && existing.status === "indexed") {
    await db
      .update(documents)
      .set({ lastCrawledAt: new Date() })
      .where(eq(documents.id, existing.id));
    return { status: "skipped", chunkCount: 0, reason: "unchanged since last crawl" };
  }

  const docChunks = chunkSections(sections);
  if (docChunks.length === 0) {
    return { status: "skipped", chunkCount: 0, reason: "produced no chunks" };
  }

  const embeddings = await embedDocuments(docChunks.map(embeddingInput));

  await db.transaction(async (tx) => {
    let id = existing?.id;

    if (id) {
      await tx
        .update(documents)
        .set({
          title,
          contentHash: hash,
          status: "indexed",
          error: null,
          lastCrawledAt: new Date(),
        })
        .where(eq(documents.id, id));
      await tx.delete(chunks).where(eq(chunks.documentId, id));
    } else {
      const [created] = await tx
        .insert(documents)
        .values({
          projectId: input.projectId,
          sourceId: input.sourceId,
          url: input.url,
          title,
          contentHash: hash,
          status: "indexed",
          lastCrawledAt: new Date(),
        })
        .returning({ id: documents.id });
      id = created.id;
    }

    await tx.insert(chunks).values(
      docChunks.map((chunk, position) => ({
        projectId: input.projectId,
        documentId: id!,
        chunkIndex: chunk.index,
        headingPath: chunk.headingPath,
        anchor: chunk.anchor,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: embeddings[position],
      })),
    );

  });

  return { status: "indexed", chunkCount: docChunks.length };
}

/** Records a page that could not be fetched, without aborting the crawl. */
export async function recordPageFailure(input: {
  projectId: string;
  sourceId: string;
  url: string;
  error: string;
}): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.projectId, input.projectId), eq(documents.url, input.url)))
    .limit(1);

  if (existing) {
    await db
      .update(documents)
      .set({ status: "failed", error: input.error, lastCrawledAt: new Date() })
      .where(eq(documents.id, existing.id));
    return;
  }

  await db.insert(documents).values({
    projectId: input.projectId,
    sourceId: input.sourceId,
    url: input.url,
    contentHash: "",
    status: "failed",
    error: input.error,
    lastCrawledAt: new Date(),
  });
}
