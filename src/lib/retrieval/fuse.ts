/**
 * Reciprocal rank fusion. Combines independently ranked result lists using
 * only positions, never raw scores — cosine similarity and ts_rank are not on
 * comparable scales, so any attempt to blend their magnitudes is arbitrary.
 */

export type RankedList<T> = {
  name: string;
  items: T[];
};

export type FusedResult<T> = {
  item: T;
  score: number;
  /** One-based rank per source list, for explaining why something surfaced. */
  ranks: Record<string, number>;
};

/**
 * Dampening constant from the original RRF paper. Large enough that the
 * difference between rank 1 and rank 2 does not dominate agreement across
 * lists, which is the whole point of fusing.
 */
export const RRF_K = 60;

export function reciprocalRankFusion<T>(
  lists: RankedList<T>[],
  identify: (item: T) => string,
  k: number = RRF_K,
): FusedResult<T>[] {
  const fused = new Map<string, FusedResult<T>>();

  for (const list of lists) {
    list.items.forEach((item, index) => {
      const rank = index + 1;
      const id = identify(item);
      const existing = fused.get(id);

      if (existing) {
        existing.score += 1 / (k + rank);
        existing.ranks[list.name] = rank;
        return;
      }

      fused.set(id, {
        item,
        score: 1 / (k + rank),
        ranks: { [list.name]: rank },
      });
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}
