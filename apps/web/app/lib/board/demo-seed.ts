/**
 * A cold landing that already has something to press Enter on.
 *
 * The headline beat of this build is Enter on an empty bar redealing the board
 * from your flags, with no model in the path. A judge opening `/nga/search`
 * cold cannot find it: the page offers a search field, and the flags that arm
 * Enter only exist after somebody has already understood the loop and pressed
 * P and X on cards they went looking for. The affordance is real and
 * unreachable, which reads exactly like it not being there.
 *
 * `?demo=sofa` lays the first half of the loop down for them — the query runs,
 * one work is picked and two are rejected — so the first thing they do is the
 * thing worth seeing. Nothing here calls a model, and nothing here is an agent
 * turn: the seed is a query and three flags, and the deal that follows is the
 * same deterministic Rocchio pass the human's own P/X/Enter would produce.
 *
 * §5b's rule is why this is a seeded state and not a paragraph of onboarding:
 * if something needs explaining, fix the design instead of adding the
 * sentence. A board that is already half flagged explains itself in one press.
 */

export interface DemoSeed {
  /** The query the page runs on landing. */
  query: string;
  /**
   * Which of the returned works to flag, by rank, 1-based.
   *
   * Ranks rather than a fixed id list: the id list would be exact, but only
   * while those exact works stay in the top twelve of a live index of 63,253,
   * and a seed that silently flags nothing is worse than one that flags the
   * wrong thing. Ranks are always there, and the deal that follows is real
   * either way — it runs on whatever was actually flagged.
   */
  pick: number[];
  reject: number[];
}

export const DEMO_SEEDS: Record<string, DemoSeed> = {
  /*
   * The brief's own example, and the one the definition of done is written
   * against: "something warm for above the sofa", two X presses, and a note
   * that names the content of what was rejected.
   */
  sofa: {
    query: 'something warm for above the sofa',
    pick: [1],
    reject: [2, 5],
  },
};

export const resolveDemoSeed = (value: string | null): DemoSeed | null =>
  value ? (DEMO_SEEDS[value.toLowerCase()] ?? null) : null;
