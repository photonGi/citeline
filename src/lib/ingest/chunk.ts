import { countTokens } from "./tokens";

/** A run of body text under one heading trail, produced by the normaliser. */
export type DocSection = {
  /** Heading trail from outermost to innermost, e.g. ["Guides", "Auth"]. */
  headingPath: string[];
  /** Fragment identifier of the nearest heading, for deep-linked citations. */
  anchor: string | null;
  /** Markdown body, excluding the heading line itself. */
  content: string;
};

export type DocChunk = {
  index: number;
  headingPath: string;
  anchor: string | null;
  content: string;
  tokenCount: number;
};

export type ChunkOptions = {
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
};

export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_MIN_TOKENS = 120;
export const CHUNK_OVERLAP_TOKENS = 80;

export const HEADING_SEPARATOR = " › ";

export function formatHeadingPath(headingPath: string[]): string {
  return headingPath.filter(Boolean).join(HEADING_SEPARATOR);
}

function isFenced(block: string): boolean {
  return /^(```|~~~)/.test(block.trimStart());
}

/**
 * Splits markdown into blocks on blank lines, keeping fenced code blocks whole
 * even when they contain blank lines. Splitting a code fence across chunks
 * produces citations that show half a snippet, so fences are atomic.
 */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);

    if (fence) {
      current.push(line);
      if (fenceMatch && line.trimStart().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }

    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

/** Last-resort split for a single prose block that exceeds the token budget. */
function splitOversizedProse(block: string, maxTokens: number): string[] {
  const sentences = block.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let buffer: string[] = [];
  let tokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence);
    if (tokens > 0 && tokens + sentenceTokens > maxTokens) {
      pieces.push(buffer.join(" "));
      buffer = [];
      tokens = 0;
    }
    buffer.push(sentence);
    tokens += sentenceTokens;
  }

  if (buffer.length > 0) pieces.push(buffer.join(" "));
  return pieces;
}

/**
 * Merges a chunk that fell below the minimum into its predecessor, but only
 * within the same heading trail — merging across headings would make a
 * citation point at the wrong section.
 */
function mergeUndersized(
  chunks: DocChunk[],
  minTokens: number,
  maxTokens: number,
): DocChunk[] {
  const merged: DocChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    const canMerge =
      previous !== undefined &&
      chunk.tokenCount < minTokens &&
      previous.headingPath === chunk.headingPath &&
      previous.tokenCount + chunk.tokenCount <= maxTokens;

    if (canMerge) {
      const content = `${previous.content}\n\n${chunk.content}`;
      merged[merged.length - 1] = {
        ...previous,
        content,
        tokenCount: countTokens(content),
      };
      continue;
    }

    merged.push(chunk);
  }

  return merged.map((chunk, index) => ({ ...chunk, index }));
}

/**
 * Packs sections into chunks bounded by token count, carrying a small prose
 * overlap between consecutive chunks so an answer spanning a paragraph break
 * still retrieves both halves.
 */
export function chunkSections(
  sections: DocSection[],
  options: ChunkOptions = {},
): DocChunk[] {
  const maxTokens = options.maxTokens ?? CHUNK_MAX_TOKENS;
  const minTokens = options.minTokens ?? CHUNK_MIN_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;

  const chunks: DocChunk[] = [];

  for (const section of sections) {
    const headingPath = formatHeadingPath(section.headingPath);
    const push = (content: string) => {
      chunks.push({
        index: chunks.length,
        headingPath,
        anchor: section.anchor,
        content,
        tokenCount: countTokens(content),
      });
    };

    let buffer: string[] = [];
    let bufferTokens = 0;
    let overlap: string | null = null;

    const emit = () => {
      if (buffer.length === 0) return;
      push(buffer.join("\n\n"));

      // Only carry an overlap when the chunk had more than one block,
      // otherwise the next chunk would simply repeat this one.
      const last = buffer[buffer.length - 1];
      overlap =
        buffer.length > 1 && !isFenced(last) && countTokens(last) <= overlapTokens
          ? last
          : null;

      buffer = [];
      bufferTokens = 0;
    };

    for (const block of splitBlocks(section.content)) {
      const blockTokens = countTokens(block);

      if (blockTokens > maxTokens) {
        emit();
        overlap = null;
        if (isFenced(block)) {
          // Deliberately over budget: a truncated snippet is worse than a long one.
          push(block);
        } else {
          for (const piece of splitOversizedProse(block, maxTokens)) push(piece);
        }
        continue;
      }

      if (bufferTokens + blockTokens > maxTokens) emit();

      if (buffer.length === 0 && overlap) {
        buffer.push(overlap);
        bufferTokens += countTokens(overlap);
        overlap = null;
      }

      buffer.push(block);
      bufferTokens += blockTokens;
    }

    emit();
  }

  return mergeUndersized(chunks, minTokens, maxTokens);
}
