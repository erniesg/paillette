/**
 * The thing that decides whether this runs on a phone.
 *
 * A texture on the GPU is not a JPEG. It is decompressed, four bytes a pixel,
 * plus a third again for the mip chain — so a 1400 px wall image, the size the
 * flat page serves, is **7.8 MB of video memory each** at 4:3. Thirty of those
 * is 224 MiB and a phone does not have it; the tab does not warn you, it goes
 * white.
 *
 * IIIF is what makes the fix available: the size is a segment of the URL, so
 * every work can be asked for at whatever resolution it is currently worth.
 * Every work gets a small texture that stays resident for the whole visit, and
 * the handful of works that are near or focused are upgraded — and, crucially,
 * *downgraded again* when the visitor walks away. A cache that only ever grows
 * is the same bug with extra steps.
 *
 * This module is the accounting, with no WebGL in it, so the budget can be
 * asserted rather than hoped for. `room-scene` does the loading and the
 * `dispose()` calls; what to evict is decided here.
 */

/**
 * The two tiers, in IIIF width.
 *
 * 384 is chosen against the wall, not against the screen: a work hung at
 * 65 cm and seen from three metres across a 62° field is a few hundred pixels
 * tall, so a 384 px texture is already at or past the display resolution for
 * everything that is not being looked at directly.
 *
 * 1400 is the focused tier, and it is 1400 rather than 1600 because the
 * arithmetic said so. The near tier is bounded by a work's *longer* side, so
 * the worst case is a square: at 1600 that is 13.7 MB apiece, and six of them
 * plus thirty base textures plus the plates came to 102 MiB against a stated
 * ceiling of 96. Rather than leave a ceiling that only held for landscapes,
 * the tier came down to the width the flat page already serves for a wall
 * image — which puts a focused work at parity with the page it was chosen
 * from, and 1400 px across a work filling two thirds of a 900 px viewport is
 * still better than twice the resolution being displayed.
 */
export const BASE_WIDTH = 384;
export const NEAR_WIDTH = 1400;

/**
 * The width to ask for so a work of any shape costs about the same.
 *
 * Asking for a fixed width is fine for a landscape and ruinous for a tall one:
 * a 384 × 514 record asked for at 1600 px wide came back 1600 × 2144, which is
 * 18.3 MB — nearly double a landscape's, from the same request. Bounding the
 * *longer* side instead caps every near texture at `NEAR_WIDTH` square however
 * the picture is proportioned, and leaves landscapes exactly where they were.
 */
export const nearWidthFor = (aspect: number): number =>
  aspect >= 1 ? NEAR_WIDTH : Math.max(64, Math.round(NEAR_WIDTH * aspect));

export type Tier = 'base' | 'near';

/**
 * Bytes per pixel once the driver is finished with it.
 *
 * 4 for RGBA8, times 4/3 for the mip chain — the standard sum of a geometric
 * series at quarter steps. Three generates mipmaps by default and we leave it
 * on, because a picture on a wall seen at an angle without them crawls.
 */
export const BYTES_PER_PIXEL = 4 * (4 / 3);

export const textureBytes = (width: number, height: number): number =>
  Math.round(width * height * BYTES_PER_PIXEL);

/**
 * The ceiling, and where it comes from.
 *
 * 96 MB is not a round number picked for comfort: a 2018-class phone with
 * 3 GB of RAM gives a browser tab a few hundred megabytes for everything, and
 * WebGL contexts on iOS are killed well before the system runs out. 96 MiB of
 * texture leaves room for the rest of the page and is well under half of the
 * 224 MiB an unbudgeted thirty-work room would ask for. The two caps below sit
 * comfortably inside it together — thirty base textures at 0.56 MiB plus six
 * near ones at 9.8 MiB is 75 MiB — so the count is what binds in practice and
 * the byte ceiling is the backstop for a show of unusually tall works.
 * Measured numbers for a real thirty-work show are in
 * `docs/night/room-report.md`.
 */
export const TEXTURE_BUDGET_BYTES = 96 * 1024 * 1024;

/**
 * The printed label beside each work, and what one costs.
 *
 * Text drawn to a canvas is a texture like any other — 393 kB of video memory
 * apiece — so they are made on approach and thrown away on departure for the
 * same reason the pictures are. They live in their *own* budget rather than
 * sharing the pictures', which is the bug this constant exists to have fixed:
 * eight plates and six pictures competing for six slots meant the plates,
 * admitted last each cycle, evicted every high-resolution picture in the room
 * on a loop. A wall of blurry pictures with crisp labels next to them.
 */
export const PLATE_TEXTURE_WIDTH = 384;
export const PLATE_TEXTURE_HEIGHT = 192;
export const MAX_PLATES = 8;
export const PLATE_BUDGET_BYTES =
  textureBytes(PLATE_TEXTURE_WIDTH, PLATE_TEXTURE_HEIGHT) * MAX_PLATES;

/** What is left for the pictures, so the two together honour the ceiling. */
export const PICTURE_BUDGET_BYTES = TEXTURE_BUDGET_BYTES - PLATE_BUDGET_BYTES;

/**
 * How many works may hold a high-resolution texture at once.
 *
 * The byte budget alone would allow around twenty, which is not a budget so
 * much as a bet that no phone is worse than the one being tested on. Six is
 * the focused work plus its neighbours, and it is the constraint that actually
 * binds.
 */
export const MAX_NEAR_TEXTURES = 6;

export interface BudgetEntry {
  id: string;
  tier: Tier;
  bytes: number;
}

/**
 * Least-recently-wanted, not least-recently-used.
 *
 * `touch` is called every frame for whatever is near enough to deserve
 * resolution, so the ordering tracks where the visitor is standing rather than
 * what happened to render. Walking back the way you came should reinstate the
 * works behind you, and it does.
 */
export class TextureBudget {
  private readonly entries = new Map<string, BudgetEntry>();
  private readonly order: string[] = [];

  constructor(
    private readonly budgetBytes: number = TEXTURE_BUDGET_BYTES,
    private readonly maxNear: number = MAX_NEAR_TEXTURES
  ) {}

  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  get nearCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.tier === 'near') count += 1;
    return count;
  }

  has(id: string, tier: Tier): boolean {
    return this.entries.get(id)?.tier === tier;
  }

  touch(id: string): void {
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
    this.order.push(id);
  }

  /**
   * Make room for `bytes` at `tier`, and say what has to go.
   *
   * Only `near` entries are ever returned for eviction. The base tier is the
   * floor of the experience — dropping it leaves a blank rectangle on a wall,
   * which looks like a bug rather than like a budget — and it is small enough
   * that thirty of them fit inside the ceiling with the near tier's whole
   * allowance still spare.
   */
  admit(id: string, tier: Tier, bytes: number): string[] {
    const evict: string[] = [];
    const existing = this.entries.get(id);
    if (existing?.tier === tier) {
      this.touch(id);
      return evict;
    }

    let projected = this.bytes - (existing?.bytes ?? 0) + bytes;
    let near = this.nearCount - (existing?.tier === 'near' ? 1 : 0);

    if (tier === 'near') {
      for (const candidate of this.order) {
        if (candidate === id) continue;
        const entry = this.entries.get(candidate);
        if (!entry || entry.tier !== 'near') continue;
        if (projected <= this.budgetBytes && near < this.maxNear) break;
        evict.push(candidate);
        projected -= entry.bytes;
        near -= 1;
      }
    }

    for (const candidate of evict) this.release(candidate);
    this.entries.set(id, { id, tier, bytes });
    this.touch(id);
    return evict;
  }

  release(id: string): void {
    this.entries.delete(id);
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
  }

  clear(): void {
    this.entries.clear();
    this.order.length = 0;
  }

  snapshot(): BudgetEntry[] {
    return this.order
      .map((id) => this.entries.get(id))
      .filter((entry): entry is BudgetEntry => Boolean(entry));
  }
}

/**
 * Which works deserve resolution from where the visitor is standing.
 *
 * Distance, nearest first, with the focused work forced to the front however
 * far away it is — clicking a picture across the room and having it stay
 * blurry because six nearer ones held the budget would be the feature failing
 * at exactly the moment it is being used.
 */
export const nearestIds = (
  positions: { id: string; x: number; z: number }[],
  from: { x: number; z: number },
  limit: number,
  focusedId?: string | null
): string[] => {
  const ranked = positions
    .map((position) => ({
      id: position.id,
      distance:
        position.id === focusedId
          ? -1
          : Math.hypot(position.x - from.x, position.z - from.z),
    }))
    .sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, limit).map((entry) => entry.id);
};
