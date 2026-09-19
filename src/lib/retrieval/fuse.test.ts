import { describe, expect, it } from "vitest";

import { reciprocalRankFusion, RRF_K } from "./fuse";

type Doc = { id: string };

const doc = (id: string): Doc => ({ id });
const identify = (item: Doc) => item.id;
const ids = (results: { item: Doc }[]) => results.map((result) => result.item.id);

describe("reciprocalRankFusion", () => {
  it("ranks a result appearing in both lists above one leading a single list", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "vector", items: [doc("a"), doc("b")] },
        { name: "lexical", items: [doc("c"), doc("b")] },
      ],
      identify,
    );

    // b is second in both lists; a and c each lead one list.
    expect(ids(fused)[0]).toBe("b");
  });

  it("records the rank each list assigned", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "vector", items: [doc("a"), doc("b")] },
        { name: "lexical", items: [doc("b")] },
      ],
      identify,
    );

    const b = fused.find((result) => result.item.id === "b");
    expect(b?.ranks).toEqual({ vector: 2, lexical: 1 });
  });

  it("scores a single first place as 1/(k+1)", () => {
    const fused = reciprocalRankFusion(
      [{ name: "vector", items: [doc("a")] }],
      identify,
    );

    expect(fused[0].score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("sums contributions across lists", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "vector", items: [doc("a")] },
        { name: "lexical", items: [doc("a")] },
      ],
      identify,
    );

    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(2 / (RRF_K + 1), 10);
  });

  it("deduplicates the same result across lists", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "vector", items: [doc("a"), doc("b")] },
        { name: "lexical", items: [doc("b"), doc("a")] },
      ],
      identify,
    );

    expect(fused).toHaveLength(2);
  });

  it("handles empty and missing lists", () => {
    expect(reciprocalRankFusion<Doc>([], identify)).toEqual([]);
    expect(
      reciprocalRankFusion([{ name: "vector", items: [] }], identify),
    ).toEqual([]);
  });

  it("returns results in descending score order", () => {
    const fused = reciprocalRankFusion(
      [{ name: "vector", items: [doc("a"), doc("b"), doc("c")] }],
      identify,
    );

    expect(ids(fused)).toEqual(["a", "b", "c"]);
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it("preserves the original item, not just its id", () => {
    const rich = { id: "a", content: "hello" };
    const fused = reciprocalRankFusion(
      [{ name: "vector", items: [rich] }],
      (item) => item.id,
    );

    expect(fused[0].item).toBe(rich);
  });

  it("lets a smaller k sharpen the advantage of top ranks", () => {
    const lists = [
      { name: "vector", items: [doc("a"), doc("b")] },
      { name: "lexical", items: [doc("b"), doc("a")] },
    ];

    const sharp = reciprocalRankFusion(lists, identify, 1);
    const flat = reciprocalRankFusion(lists, identify, 1000);

    const spread = (results: { score: number }[]) =>
      results[0].score - results[1].score;

    // Perfectly disagreeing lists tie regardless of k, so compare a case
    // where one result leads both.
    const leaning = [
      { name: "vector", items: [doc("a"), doc("b")] },
      { name: "lexical", items: [doc("a"), doc("b")] },
    ];

    expect(
      spread(reciprocalRankFusion(leaning, identify, 1)),
    ).toBeGreaterThan(spread(reciprocalRankFusion(leaning, identify, 1000)));
    expect(sharp).toHaveLength(2);
    expect(flat).toHaveLength(2);
  });
});
