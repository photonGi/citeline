import { and, cosineDistance, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { chunks, documents } from "@/lib/db/schema";
import { embedQuery } from "@/lib/embed";

import { reciprocalRankFusion, type FusedResult } from "./fuse";

export type RetrievedChunk = {
  id: string;
  chunkIndex: number;
  documentId: string;
  url: string;
  title: string | null;
  headingPath: string;
  anchor: string | null;
  content: string;
  tokenCount: number;
  /** Cosine similarity, present only for vector hits. */
  similarity: number | null;
};

/** Candidates requested from each strategy before fusion. */
export const CANDIDATES_PER_STRATEGY = 20;

/** Chunks handed to the model after fusion. */
export const CONTEXT_CHUNK_LIMIT = 8;

export const CONTEXT_TOKEN_BUDGET = 6000;

/**
 * Backstop only, not a tuned threshold. gemini-embedding-001 returns high
 * similarity even for unrelated queries — an off-topic question measured 0.59
 * against 0.78 for a relevant one — so this catches only the empty-corpus
 * case. Grounded refusal is enforced by the prompt and by citation validation.
 * Needs calibration against the evaluation set before it is load-bearing.
 */
export const MIN_SIMILARITY = 0.45;

const SELECTION = {
  id: chunks.id,
  chunkIndex: chunks.chunkIndex,
  documentId: chunks.documentId,
  url: documents.url,
  title: documents.title,
  headingPath: chunks.headingPath,
  anchor: chunks.anchor,
  content: chunks.content,
  tokenCount: chunks.tokenCount,
};

/** Nearest neighbours by cosine distance over the HNSW index. */
export async function vectorSearch(
  projectId: string,
  queryVector: number[],
  limit = CANDIDATES_PER_STRATEGY,
): Promise<RetrievedChunk[]> {
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryVector)})`;

  const rows = await getDb()
    .select({ ...SELECTION, similarity })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.projectId, projectId), isNotNull(chunks.embedding)))
    .orderBy(desc(similarity))
    .limit(limit);

  return rows;
}

/**
 * Lexical search over the generated tsvector. This is the half that catches
 * exact identifiers — `pgEnum`, `--no-verify` — which embeddings blur away.
 */
export async function lexicalSearch(
  projectId: string,
  question: string,
  limit = CANDIDATES_PER_STRATEGY,
): Promise<RetrievedChunk[]> {
  // plainto_tsquery ANDs every term, so a natural-language question matches
  // nothing unless one chunk contains all of it. Rewriting the operators to OR
  // keeps the stemming and stopword removal while letting partial matches
  // through; ts_rank still favours chunks covering more of the question.
  const query = sql`replace(plainto_tsquery('english', ${question})::text, ' & ', ' | ')::tsquery`;
  const rank = sql<number>`ts_rank(${chunks.tsv}, ${query})`;

  const rows = await getDb()
    .select(SELECTION)
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.projectId, projectId), sql`${chunks.tsv} @@ ${query}`))
    .orderBy(desc(rank))
    .limit(limit);

  return rows.map((row) => ({ ...row, similarity: null }));
}

export type RetrievalResult = {
  results: FusedResult<RetrievedChunk>[];
  topSimilarity: number | null;
  hasLexicalMatch: boolean;
};

export type RetrieveOptions = {
  projectId: string;
  question: string;
  /** Overrides for the ablation study in the evaluation harness. */
  strategies?: ("vector" | "lexical")[];
};

/**
 * Runs both strategies, fuses them by rank, and trims to the context budget.
 */
export async function retrieve({
  projectId,
  question,
  strategies = ["vector", "lexical"],
}: RetrieveOptions): Promise<RetrievalResult> {
  const useVector = strategies.includes("vector");
  const useLexical = strategies.includes("lexical");

  const queryVector = useVector ? await embedQuery(question) : null;

  const [vectorHits, lexicalHits] = await Promise.all([
    queryVector ? vectorSearch(projectId, queryVector) : Promise.resolve([]),
    useLexical ? lexicalSearch(projectId, question) : Promise.resolve([]),
  ]);

  const fused = reciprocalRankFusion(
    [
      { name: "vector", items: vectorHits },
      { name: "lexical", items: lexicalHits },
    ],
    (chunk) => chunk.id,
  );

  const selected: FusedResult<RetrievedChunk>[] = [];
  const seenContent = new Set<string>();
  let tokens = 0;

  for (const candidate of fused) {
    if (selected.length >= CONTEXT_CHUNK_LIMIT) break;

    // Documentation sites repeat boilerplate across pages verbatim.
    const fingerprint = candidate.item.content.slice(0, 200);
    if (seenContent.has(fingerprint)) continue;

    if (tokens + candidate.item.tokenCount > CONTEXT_TOKEN_BUDGET) continue;

    seenContent.add(fingerprint);
    selected.push(candidate);
    tokens += candidate.item.tokenCount;
  }

  return {
    results: selected,
    topSimilarity: vectorHits[0]?.similarity ?? null,
    hasLexicalMatch: lexicalHits.length > 0,
  };
}

/**
 * Refusal rule. Retrieval returning something is not evidence that it is
 * relevant: pgvector always returns nearest neighbours, however far away.
 */
export function shouldRefuse(result: RetrievalResult): boolean {
  if (result.results.length === 0) return true;
  if (result.hasLexicalMatch) return false;
  return (result.topSimilarity ?? 0) < MIN_SIMILARITY;
}
