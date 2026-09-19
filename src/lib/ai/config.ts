/**
 * Model identity and vector shape. Dependency-free so the database schema can
 * import it without pulling the AI SDK into migration tooling.
 *
 * Changing EMBEDDING_MODEL_ID or EMBEDDING_DIMENSIONS invalidates every stored
 * embedding and requires a full re-index.
 */

export const EMBEDDING_MODEL_ID = "gemini-embedding-001";

/**
 * 768 rather than the model's 3072 default: pgvector's HNSW index rejects
 * vectors above 2000 dimensions, and this model is trained for truncation.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** 2.5-flash is closed to new API keys; 3.6-flash is the current free-tier Flash. */
export const CHAT_MODEL_ID = "gemini-3.6-flash";
