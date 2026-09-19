import { describe, expect, it } from "vitest";

import {
  chunkSections,
  formatHeadingPath,
  splitBlocks,
  type DocSection,
} from "./chunk";
import { countTokens } from "./tokens";

/**
 * Prose of approximately `tokens` length, tagged with `marker` so a chunk's
 * origin can be asserted. Uses a single-token filler word: numbered words like
 * `word0` cost two tokens each and would silently double the intended size.
 */
function prose(tokens: number, marker: string): string {
  const filler = Array.from({ length: Math.max(tokens - 2, 1) }, () => "data");
  return `${marker} ${filler.join(" ")}.`;
}

const CODE_WITH_BLANK_LINES = [
  "```ts",
  "const client = createClient();",
  "",
  "await client.connect();",
  "```",
].join("\n");

describe("splitBlocks", () => {
  it("splits on blank lines", () => {
    expect(splitBlocks("first para\n\nsecond para")).toEqual([
      "first para",
      "second para",
    ]);
  });

  it("keeps a fenced code block whole despite internal blank lines", () => {
    const blocks = splitBlocks(`intro\n\n${CODE_WITH_BLANK_LINES}\n\noutro`);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toBe(CODE_WITH_BLANK_LINES);
  });

  it("keeps a table as a single block", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(splitBlocks(`lead in\n\n${table}`)).toEqual(["lead in", table]);
  });

  it("does not lose content from an unterminated fence", () => {
    const blocks = splitBlocks("```ts\nconst x = 1;");
    expect(blocks.join("\n")).toContain("const x = 1;");
  });
});

describe("formatHeadingPath", () => {
  it("joins the trail and drops empty levels", () => {
    expect(formatHeadingPath(["Guides", "", "Auth"])).toBe("Guides › Auth");
  });
});

describe("chunkSections", () => {
  const options = { maxTokens: 60, minTokens: 10, overlapTokens: 15 };

  it("keeps every prose chunk within the token budget", () => {
    const sections: DocSection[] = [
      {
        headingPath: ["Guides", "Auth"],
        anchor: "auth",
        content: Array.from({ length: 8 }, (_, i) => prose(20, `p${i}`)).join("\n\n"),
      },
    ];

    const chunks = chunkSections(sections, options);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(options.maxTokens);
    }
  });

  it("never splits a fenced code block across chunks", () => {
    const sections: DocSection[] = [
      {
        headingPath: ["Reference"],
        anchor: null,
        content: [prose(40, "before"), CODE_WITH_BLANK_LINES, prose(40, "after")].join(
          "\n\n",
        ),
      },
    ];

    const chunks = chunkSections(sections, options);
    const containing = chunks.filter((chunk) => chunk.content.includes("client.connect"));

    expect(containing).toHaveLength(1);
    expect(containing[0].content).toContain("```ts");
    // A fence that opens must close inside the same chunk.
    const fences = containing[0].content.match(/```/g) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it("emits an oversized code block as its own chunk rather than truncating it", () => {
    const longCode = ["```ts", prose(200, "code"), "```"].join("\n");
    const chunks = chunkSections(
      [{ headingPath: ["API"], anchor: null, content: longCode }],
      options,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(longCode);
    expect(chunks[0].tokenCount).toBeGreaterThan(options.maxTokens);
  });

  it("carries a prose overlap into the following chunk", () => {
    const tail = "See also the migration guide.";
    const sections: DocSection[] = [
      {
        headingPath: ["Guides"],
        anchor: null,
        content: [prose(45, "head"), tail, prose(45, "next")].join("\n\n"),
      },
    ];

    const chunks = chunkSections(sections, options);
    const withTail = chunks.filter((chunk) => chunk.content.includes(tail));

    expect(countTokens(tail)).toBeLessThanOrEqual(options.overlapTokens);
    expect(withTail).toHaveLength(2);
  });

  it("does not repeat a single-block chunk as the next chunk's overlap", () => {
    const sections: DocSection[] = [
      {
        headingPath: ["Guides"],
        anchor: null,
        content: [prose(55, "first"), prose(55, "second")].join("\n\n"),
      },
    ];

    const chunks = chunkSections(sections, options);

    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).not.toContain("first");
  });

  it("stamps the heading trail and anchor onto every chunk", () => {
    const chunks = chunkSections(
      [
        {
          headingPath: ["Guides", "Auth"],
          anchor: "refresh-tokens",
          content: prose(30, "only"),
        },
      ],
      options,
    );

    expect(chunks[0].headingPath).toBe("Guides › Auth");
    expect(chunks[0].anchor).toBe("refresh-tokens");
  });

  it("merges an undersized chunk into its predecessor within the same section", () => {
    const sections: DocSection[] = [
      { headingPath: ["A"], anchor: null, content: prose(20, "body") },
      { headingPath: ["A"], anchor: null, content: "tiny" },
    ];

    const chunks = chunkSections(sections, options);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("tiny");
  });

  it("does not merge across different heading trails", () => {
    const sections: DocSection[] = [
      { headingPath: ["A"], anchor: null, content: prose(20, "body") },
      { headingPath: ["B"], anchor: null, content: "tiny" },
    ];

    expect(chunkSections(sections, options)).toHaveLength(2);
  });

  it("numbers chunks sequentially from zero", () => {
    const sections: DocSection[] = Array.from({ length: 4 }, (_, i) => ({
      headingPath: [`H${i}`],
      anchor: null,
      content: prose(30, `s${i}`),
    }));

    const chunks = chunkSections(sections, options);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3]);
  });

  it("reports token counts that match the tokeniser", () => {
    const chunks = chunkSections(
      [{ headingPath: ["A"], anchor: null, content: prose(25, "x") }],
      options,
    );

    expect(chunks[0].tokenCount).toBe(countTokens(chunks[0].content));
  });
});
