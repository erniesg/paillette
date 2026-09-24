/**
 * How big the thing actually is.
 *
 * A web page shows every work at the same size. A room cannot: a print is
 * small and a history painting is enormous, and hanging both at their true
 * size is the one thing the flat view is structurally unable to do. So this
 * module's only job is to turn what a catalogue records into centimetres —
 * and, much more often than is comfortable, to refuse.
 *
 * It is shared on purpose. The ingest writes what this reads into the
 * `artworks` columns, and the room reads the same text again when a record
 * carries only the string; one grammar means the wall and the database cannot
 * disagree about what a catalogue said. Plain `.mjs` for the same reason as
 * `nga-date-range.mjs`: the ingest scripts run under bare Node.
 *
 * **It refuses a lot on purpose.** A half-parsed dimension is worse than no
 * dimension, because a wrong size is indistinguishable from a right one once
 * it is on a wall. Everything this cannot read falls back to one declared
 * default size, which is visible as a default precisely because every
 * unmeasured work is identical.
 */

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

const UNIT_TO_CM = {
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
const QUALIFIER_RANK = [
  [/\b(?:overall|object)\b/i, 100],
  [/\b(?:support|canvas|panel|stretcher)\b/i, 95],
  [/\b(?:sheet|painted surface)\b/i, 90],
  [/\b(?:image|plate|block|composition)\b/i, 80],
  [/\b(?:mount|mat|frame|framed)\b/i, 10],
];

/**
 * Measurements of something that is not the work, which no rank can redeem.
 *
 * The Index of American Design records the size of the chair a watercolour
 * depicts as `original IAD object`; hanging the watercolour at the chair's
 * size is exactly the invented number this module refuses. A base, a case or
 * a weight is likewise a fact about something beside the work. These are
 * anchored to the start of the qualifier so `overall without base` — which is
 * the work — still reads.
 */
const NOT_THE_WORK =
  /^\s*(?:original iad object|gross weight|weight|base|pedestal|accessory|case|box|stand)\b/i;

/** Unlabelled text sits above a frame measurement and below a named one. */
const UNQUALIFIED_RANK = 60;

const rankOf = (qualifier) => {
  if (NOT_THE_WORK.test(qualifier)) return null;
  for (const [pattern, rank] of QUALIFIER_RANK) {
    if (pattern.test(qualifier)) return rank;
  }
  return UNQUALIFIED_RANK;
};

/**
 * One number as a catalogue writes it: `62.5`, `24 5/8`, or `5/8`.
 *
 * The mixed fraction is read whole or not at all. The danger with imperial
 * text was never the fraction itself — `24 5/8` is exactly 24.625 — but a
 * pattern that starts reading halfway through it and returns `8 × 38` from
 * `24 5/8 x 38 1/8 in.`. The lookbehind below forbids a number from starting
 * inside another one, and the lookahead forbids it from stopping inside one,
 * so the only way to match is to take every figure the catalogue wrote.
 */
const NUMBER = String.raw`(?<![\d./])(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)(?![\d./])`;
const TIMES = String.raw`\s*[x×]\s*`;
const UNIT = String.raw`(cm|cms|centimet(?:er|re)s?|mm|inches|inch|ins|in|m)\b\.?`;

/**
 * `12.5 × 30 cm`, and nothing looser than that.
 *
 * The unit has to sit immediately after the pair (or the triple), so a pair
 * with no unit is not read as centimetres. The first match in a segment wins,
 * which in the NGA form `62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)` is the metric
 * half — the museum's own figure rather than our conversion of its rounding.
 */
const MEASUREMENT = new RegExp(
  `${NUMBER}${TIMES}${NUMBER}(?:${TIMES}${NUMBER})?\\s*${UNIT}`,
  'gi'
);

const readNumber = (token) => {
  let total = 0;
  for (const part of token.trim().split(/\s+/)) {
    if (!part.includes('/')) {
      total += Number(part);
      continue;
    }
    const [numerator, denominator] = part.split('/').map(Number);
    if (!denominator) return Number.NaN;
    total += numerator / denominator;
  }
  return total;
};

/** Centimetres to the hundredth, so a conversion does not carry float noise into a column. */
const round = (value) => Math.round(value * 100) / 100;

const believable = (value) =>
  Number.isFinite(value) &&
  value >= MIN_BELIEVABLE_CM &&
  value <= MAX_BELIEVABLE_CM;

/**
 * The best measurement in a catalogue string, with depth when it was given.
 *
 * Height first, then width — the order every museum writes them in. Getting
 * this backwards is the quiet failure mode: a landscape hung as a portrait
 * looks like a rendering bug rather than a parsing one, and nobody checks the
 * parser.
 */
export const measureDimensionText = (text) => {
  if (typeof text !== 'string') return null;
  let best = null;

  for (const segment of text.split(/;|\r?\n/)) {
    if (!segment.trim()) continue;

    // Everything before the first colon is the catalogue's own name for what
    // it measured. No colon means the whole segment is unqualified.
    const colon = segment.indexOf(':');
    const qualifier = colon >= 0 ? segment.slice(0, colon).trim() : '';
    const rank = rankOf(qualifier);
    if (rank === null) continue;
    if (best && rank <= best.rank) continue;

    MEASUREMENT.lastIndex = 0;
    const match = MEASUREMENT.exec(segment);
    if (!match) continue;

    const scale = UNIT_TO_CM[match[4].toLowerCase()];
    if (!scale) continue;

    const heightCm = round(readNumber(match[1]) * scale);
    const widthCm = round(readNumber(match[2]) * scale);
    if (!believable(heightCm) || !believable(widthCm)) continue;

    // A depth is allowed to be thin — a panel is a few millimetres — but not
    // to be nonsense, and a depth that is nonsense drops only the depth.
    const depth = match[3] === undefined ? null : round(readNumber(match[3]) * scale);
    const depthCm =
      depth !== null && Number.isFinite(depth) && depth > 0 && depth <= MAX_BELIEVABLE_CM
        ? depth
        : null;

    best = { rank, size: { heightCm, widthCm, depthCm, qualifier } };
  }

  return best?.size ?? null;
};

const fromStructured = (value) => {
  const height = value.height;
  const width = value.width;
  // Both or neither: a height without a width is half a size, and half a
  // size is refused rather than squared off.
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

  const heightCm = round(height * scale);
  const widthCm = round(width * scale);
  return believable(heightCm) && believable(widthCm) ? { heightCm, widthCm } : null;
};

/**
 * The room's entry point. Null means "we do not know", and callers must treat
 * that as a fact about the record rather than an error to paper over.
 */
export const parseDimensions = (input) => {
  if (typeof input === 'string') {
    const size = measureDimensionText(input);
    return size ? { heightCm: size.heightCm, widthCm: size.widthCm } : null;
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return fromStructured(input);
  }
  return null;
};

/**
 * What the ingest writes into `artworks`: the four columns, always in
 * centimetres, or all four null. Never some of them.
 */
export const dimensionColumns = (text) => {
  const size = measureDimensionText(text);
  if (!size) {
    return {
      dimensions_height: null,
      dimensions_width: null,
      dimensions_depth: null,
      dimensions_unit: null,
    };
  }
  return {
    dimensions_height: size.heightCm,
    dimensions_width: size.widthCm,
    dimensions_depth: size.depthCm,
    dimensions_unit: 'cm',
  };
};
