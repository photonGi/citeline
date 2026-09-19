import { embed, embedMany } from "ai";

import { embeddingModel, embeddingOptions } from "@/lib/ai/gemini";

/**
 * Batch size for embedding calls. Gemini accepts more per request, but smaller
 * batches fail smaller: on the free tier a rejected batch is retried in full,
 * so a modest size keeps the cost of a retry low.
 */
export const EMBED_BATCH_SIZE = 24;

const MAX_ATTEMPTS = 4;

function isRetryable(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;

  if (status === 429 || (status !== undefined && status >= 500)) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("fetch failed")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter, retrying only rate limits and 5xx. */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      const backoff = 1000 * 2 ** attempt + Math.random() * 500;
      await sleep(backoff);
    }
  }

  throw lastError;
}

/**
 * Embeds chunk texts for storage. Task type RETRIEVAL_DOCUMENT is asymmetric
 * with the query side; mixing them degrades retrieval.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const { embeddings } = await withRetry(() =>
      embedMany({
        model: embeddingModel,
        values: batch,
        providerOptions: embeddingOptions("document"),
      }),
    );
    vectors.push(...embeddings);
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await withRetry(() =>
    embed({
      model: embeddingModel,
      value: text,
      providerOptions: embeddingOptions("query"),
    }),
  );

  return embedding;
}
