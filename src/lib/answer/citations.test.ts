import { describe, expect, it } from "vitest";

import { isUncited, validateCitations, type CitationSource } from "./citations";

const source = (n: number): CitationSource => ({
  chunkId: `chunk-${n}`,
  url: `https://docs.acme.dev/page-${n}`,
  title: `Page ${n}`,
  headingPath: `Guides › Page ${n}`,
  anchor: `section-${n}`,
});

const SOURCES = [source(1), source(2), source(3)];

describe("validateCitations", () => {
  it("keeps valid markers and returns their sources", () => {
    const result = validateCitations("Tokens expire after one hour [1].", SOURCES);

    expect(result.text).toBe("Tokens expire after one hour [1].");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      marker: 1,
      chunkId: "chunk-1",
      url: "https://docs.acme.dev/page-1",
      anchor: "section-1",
    });
  });

  it("strips a marker that points past the supplied sources", () => {
    const result = validateCitations("Invented claim [9].", SOURCES);

    expect(result.text).toBe("Invented claim.");
    expect(result.citations).toEqual([]);
  });

  it("strips zero and keeps valid neighbours", () => {
    const result = validateCitations("Mixed [0][2] claim.", SOURCES);

    expect(result.text).toBe("Mixed [1] claim.");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-2");
  });

  it("renumbers from one in order of first appearance", () => {
    const result = validateCitations("First [3]. Second [2].", SOURCES);

    expect(result.text).toBe("First [1]. Second [2].");
    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-3",
      "chunk-2",
    ]);
  });

  it("reuses the same marker when a source is cited twice", () => {
    const result = validateCitations("One [2]. Again [2].", SOURCES);

    expect(result.text).toBe("One [1]. Again [1].");
    expect(result.citations).toHaveLength(1);
  });

  it("expands a grouped marker into separate markers", () => {
    const result = validateCitations("Both apply [1, 3].", SOURCES);

    expect(result.text).toBe("Both apply [1][2].");
    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-1",
      "chunk-3",
    ]);
  });

  it("excludes sources the model never cited", () => {
    const result = validateCitations("Only one [1].", SOURCES);

    expect(result.citations).toHaveLength(1);
  });

  it("returns no citations for text without markers", () => {
    const result = validateCitations("I could not find this in the docs.", SOURCES);

    expect(result.citations).toEqual([]);
    expect(result.text).toBe("I could not find this in the docs.");
  });

  it("handles an empty source list by stripping every marker", () => {
    const result = validateCitations("Claim [1] and [2].", []);

    expect(result.text).toBe("Claim and.");
    expect(result.citations).toEqual([]);
  });

  it("tidies spacing left behind by a stripped marker", () => {
    const result = validateCitations("Text  [7]  more [1].", SOURCES);

    expect(result.text).not.toContain("  ");
    expect(result.text).toContain("[1]");
  });
});

describe("isUncited", () => {
  it("detects an answer with no resolvable citation", () => {
    expect(isUncited(validateCitations("No markers here.", SOURCES))).toBe(true);
    expect(isUncited(validateCitations("Cited [1].", SOURCES))).toBe(false);
  });
});
