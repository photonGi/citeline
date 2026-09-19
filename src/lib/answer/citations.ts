import type { Citation } from "@/lib/db/schema";

export type CitationSource = {
  chunkId: string;
  url: string;
  title: string | null;
  headingPath: string;
  anchor: string | null;
};

export type ValidatedAnswer = {
  /** Answer text with invalid markers removed and valid ones renumbered. */
  text: string;
  citations: Citation[];
};

/** Matches `[1]`, `[12]`, and grouped forms such as `[1, 3]`. */
const MARKER_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Validates the citation markers a model produced against the sources it was
 * actually given.
 *
 * Models invent references. A marker pointing past the end of the supplied
 * context is a fabrication, and rendering it as a link would be worse than
 * showing nothing — so unresolvable markers are stripped. Surviving markers
 * are renumbered from one in order of first appearance, leaving no gaps for a
 * reader to wonder about.
 */
export function validateCitations(
  text: string,
  sources: CitationSource[],
): ValidatedAnswer {
  const assigned = new Map<number, number>();
  const citations: Citation[] = [];

  const rewritten = text.replace(MARKER_PATTERN, (match, group: string) => {
    const renumbered = group
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((original) => original >= 1 && original <= sources.length)
      .map((original) => {
        const existing = assigned.get(original);
        if (existing !== undefined) return existing;

        const marker = assigned.size + 1;
        assigned.set(original, marker);

        const source = sources[original - 1];
        citations.push({
          marker,
          chunkId: source.chunkId,
          url: source.url,
          title: source.title,
          headingPath: source.headingPath,
          anchor: source.anchor,
        });

        return marker;
      });

    if (renumbered.length === 0) return "";
    return renumbered.map((marker) => `[${marker}]`).join("");
  });

  return {
    // Stripping a marker can leave a double space or a space before punctuation.
    text: rewritten.replace(/ {2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim(),
    citations: citations.sort((a, b) => a.marker - b.marker),
  };
}

/** True when the model produced no resolvable citation at all. */
export function isUncited(answer: ValidatedAnswer): boolean {
  return answer.citations.length === 0;
}
