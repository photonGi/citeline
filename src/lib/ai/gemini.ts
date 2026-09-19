import { google } from "@ai-sdk/google";

import { CHAT_MODEL_ID, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from "./config";

/**
 * Gemini access lives behind this module so a provider swap is a change here
 * rather than across the codebase.
 */

export const embeddingModel = google.embedding(EMBEDDING_MODEL_ID);

export const chatModel = google.chat(CHAT_MODEL_ID);

/**
 * Asymmetric embedding: stored chunks and incoming questions are embedded with
 * different task types, which measurably improves retrieval over using one.
 */
export function embeddingOptions(kind: "document" | "query") {
  return {
    google: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: kind === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
    },
  } as const;
}

export { CHAT_MODEL_ID, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID };
