import { createHash } from "node:crypto";

/**
 * Stable fingerprint of a page's normalised content. Whitespace is collapsed
 * first so cosmetic reformatting on the source site does not trigger a
 * needless re-embed of every chunk.
 */
export function contentHash(content: string): string {
  const canonical = content.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(canonical).digest("hex");
}
