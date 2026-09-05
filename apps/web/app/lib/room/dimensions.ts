/**
 * How big the thing actually is.
 *
 * A web page shows every work at the same size. A room cannot: a print is
 * small and a history painting is enormous, and hanging both at their true
 * size is the one thing the flat view is structurally unable to do. So this
 * module's only job is to turn what a catalogue records into metres — and,
 * much more often than is comfortable, to refuse.
 *
 * **It refuses a lot on purpose.** A half-parsed dimension is worse than no
 * dimension, because a wrong size is indistinguishable from a right one once
 * it is on a wall. `24 5/8 x 38 1/8 in.` does not parse here, and that is the
 * correct outcome: a regex that grabbed `8 x 38` out of it would hang a
 * drawing at three metres and nothing on screen would say so. Everything this
 * cannot read falls back to one declared default size, which is visible as a
 * default precisely because every unmeasured work is identical.
 *
 * Two input shapes, because the catalogue has two. The API returns a
 * structured `{ height, width, unit }` on every artwork; the ingested NGA
 * records fill it with nulls, so in practice the string path is the one that
 * would fire if a collection carried dimension text. Both are handled and both
 * are tested — see `docs/night/room-report.md` for how many of the demo set
 * actually parsed, which is a smaller number than the handoff assumed.
 */

/** Centimetres, always. The room converts once, at the edge. */
export interface PhysicalSize {
  heightCm: number;
  widthCm: number;
}

/**
 * Bounds that make a measurement believable rather than merely numeric.
 *
 * Under a centimetre is a unit error or a typo; over twenty metres is not a
 * wall-hung work and is far more likely a record that put millimetres in a
 * field labelled centimetres. Both are refused rather than clamped: clamping
 * would produce a plausible-looking wrong size, which is the failure this
 * whole module exists to avoid.
 */
export const MIN_BELIEVABLE_CM = 1;
export const MAX_BELIEVABLE_CM = 2000;

const UNIT_TO_CM: Record<string, number> = {
  cm: 1,
  cms: 1,
  centimeters: 1,
  centimetres: 1,
  mm: 0.1,
  m: 100,
  in: 2.54,
  ins: 2.54,
  inch: 2.54,
  inches: 2.54,
};

/**
 * Which measurement to believe when a record gives several.
 *
 * Catalogues routinely list the sheet, the image, the support and the framed
 * size in one string. They are different objects and only one of them is what
 * hangs: `overall` is the museum's own answer to "how big is it", and a framed
 * measurement is the last thing to reach for because a frame we are not
 * rendering would inflate every work by ten centimetres a side.
 */
const QUALIFIER_RANK: [RegExp, number][] = [
  [/\b(?:overall|object)\b/i, 100],
  [/\b(?:support|canvas|panel|stretcher)\b/i, 95],
  [/\b(?:sheet|painted surface)\b/i, 90],
  [/\b(?:image|plate|block|composition)\b/i, 80],
  [/\b(?:mount|mat|frame|framed)\b/i, 10],
];

/** Unlabelled text sits above a frame measurement and below a named one. */
const UNQUALIFIED_RANK = 60;

const rankOf = (qualifier: string): number => {
  for (const [pattern, rank] of QUALIFIER_RANK) {
    if (pattern.test(qualifier)) return rank;
  }
  return UNQUALIFIED_RANK;
};

/**
 * `12.5 × 30 cm`, and nothing looser than that.
 *
 * The unit has to sit immediately after the pair, which is what makes the
 * imperial half of `62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)` unreadable rather
 * than half-readable. An optional third number is consumed so a depth does not
 * leave a trailing figure that some later pass might mistake for a unit.
 */
const MEASUREMENT =
  /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(cm|cms|centimet(?:er|re)s?|mm|inches|inch|ins|in|m)\b\.?/gi;

const believable = (value: number): boolean =>
  Number.isFinite(value) &&
  value >= MIN_BELIEVABLE_CM &&
  value <= MAX_BELIEVABLE_CM;

const fromStructured = (value: Record<string, unknown>): PhysicalSize | null => {
  const height = value.height;
  const width = value.width;
  if (typeof height !== 'number' || typeof width !== 'number') return null;

  /*
   * A missing unit is refused as firmly as an unrecognised one, and this is
   * the assertion that caught the first version assuming centimetres for a
   * null. Two numbers whose unit nobody recorded are two numbers: read as
   * centimetres they hang a 62 × 96 *inch* canvas at a third of its size, and
   * a wall of quietly wrong sizes is the exact failure this file exists to
   * prevent.
   */
  const unit = typeof value.unit === 'string' ? value.unit.trim().toLowerCase() : '';
  const scale = UNIT_TO_CM[unit];
  if (!scale) return null;

  const heightCm = height * scale;
  const widthCm = width * scale;
  return believable(heightCm) && believable(widthCm) ? { heightCm, widthCm } : null;
};

/**
 * Height first, then width — the order every museum writes them in.
 *
 * Getting this backwards is the quiet failure mode: a landscape hung as a
 * portrait looks like a rendering bug rather than a parsing one, and nobody
 * checks the parser.
 */
const fromString = (text: string): PhysicalSize | null => {
  let best: { rank: number; size: PhysicalSize } | null = null;

  for (const segment of text.split(/;|\r?\n/)) {
    if (!segment.trim()) continue;

    // Everything before the first colon is the catalogue's own name for what
    // it measured. No colon means the whole segment is unqualified.
    const colon = segment.indexOf(':');
    const qualifier = colon >= 0 ? segment.slice(0, colon) : '';
    const rank = rankOf(qualifier);
    if (best && rank <= best.rank) continue;

    MEASUREMENT.lastIndex = 0;
    const match = MEASUREMENT.exec(segment);
    if (!match) continue;

    const scale = UNIT_TO_CM[match[3].toLowerCase().replace(/\.$/, '')];
    if (!scale) continue;

    const heightCm = Number(match[1]) * scale;
    const widthCm = Number(match[2]) * scale;
    if (!believable(heightCm) || !believable(widthCm)) continue;

    best = { rank, size: { heightCm, widthCm } };
  }

  return best?.size ?? null;
};

/**
 * The one entry point. Null means "we do not know", and callers must treat
 * that as a fact about the record rather than an error to paper over.
 */
export const parseDimensions = (input: unknown): PhysicalSize | null => {
  if (typeof input === 'string') return fromString(input);
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return fromStructured(input as Record<string, unknown>);
  }
  return null;
};
