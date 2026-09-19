import type { RetrievedChunk } from "@/lib/retrieval/search";

import type { CitationSource } from "./citations";

export const REFUSAL_SENTENCE =
  "I could not find this in the indexed documentation.";

/**
 * The instruction set is deliberately blunt about citation and refusal. Softer
 * phrasing ("try to cite where possible") measurably increases uncited claims.
 */
export function buildSystemPrompt(projectName: string): string {
  return [
    `You answer questions about the ${projectName} documentation.`,
    "",
    "Rules:",
    "1. Use ONLY the numbered context below. It is the whole of your knowledge.",
    "2. End every factual sentence with the marker of its source, like [1].",
    "3. Never cite a number that does not appear in the context.",
    `4. If the context does not answer the question, reply exactly: "${REFUSAL_SENTENCE}" and then name the closest topics that are covered.`,
    "5. Do not invent function names, options, flags or fields. If a detail is absent, say it is not documented.",
    "6. Prefer the user's exact terminology. Keep code snippets verbatim and fenced with their language.",
    "7. Be concise: answer in a few sentences plus a snippet when one helps.",
  ].join("\n");
}

/** Renders retrieved chunks as the numbered context the markers refer to. */
export function buildContextBlock(sources: RetrievedChunk[]): string {
  return sources
    .map((chunk, index) => {
      const heading = chunk.headingPath || chunk.title || "Untitled section";
      const link = chunk.anchor ? `${chunk.url}#${chunk.anchor}` : chunk.url;
      return `[${index + 1}] ${heading}\nSource: ${link}\n\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

export function toCitationSources(sources: RetrievedChunk[]): CitationSource[] {
  return sources.map((chunk) => ({
    chunkId: chunk.id,
    url: chunk.url,
    title: chunk.title,
    headingPath: chunk.headingPath,
    anchor: chunk.anchor,
  }));
}

export function buildUserPrompt(question: string, context: string): string {
  return `Context:\n\n${context}\n\n---\n\nQuestion: ${question}`;
}
