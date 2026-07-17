const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const LAB_CACHE_LIMIT = 2_048;
const CANDIDATE_TARGET_CACHE_LIMIT = 16;

type Lab = readonly [lightness: number, a: number, b: number];

const labByHex = new Map<string, Lab>();
const candidateDistanceByTargetSet = new WeakMap<object, Map<string, number>>();

const normaliseHex = (colour: string): string | null =>
  HEX_COLOUR.test(colour) ? colour.toLowerCase() : null;

const rememberLab = (hex: string, lab: Lab): Lab => {
  if (labByHex.size >= LAB_CACHE_LIMIT) {
    const oldestHex = labByHex.keys().next().value;
    if (oldestHex) labByHex.delete(oldestHex);
  }
  labByHex.set(hex, lab);
  return lab;
};

/** Converts one #rrggbb sRGB colour to CIELAB using the D50 reference white. */
const hexToLab = (hex: string): Lab => {
  const cached = labByHex.get(hex);
  if (cached) {
    // Refresh recency so frequently displayed palette values survive a long search session.
    labByHex.delete(hex);
    labByHex.set(hex, cached);
    return cached;
  }

  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const linearise = (value: number) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const [r, g, b] = [linearise(red), linearise(green), linearise(blue)];

  // Linear sRGB -> XYZ D65, then Bradford-adapt XYZ to D50. These are the
  // CSS Color / Color.js matrices, so existing distance behaviour is retained.
  const xD65 =
    0.41239079926595934 * r + 0.357584339383878 * g + 0.1804807884018343 * b;
  const yD65 =
    0.21263900587151027 * r + 0.715168678767756 * g + 0.07219231536073371 * b;
  const zD65 =
    0.01933081871559182 * r + 0.11919477979462598 * g + 0.9505321522496607 * b;
  const x =
    1.0479297925449969 * xD65 +
    0.022946870601609652 * yD65 -
    0.05019226628920524 * zD65;
  const y =
    0.02962780877005599 * xD65 +
    0.9904344267538799 * yD65 -
    0.017073799063418826 * zD65;
  const z =
    -0.009243040646204504 * xD65 +
    0.015055191490298152 * yD65 +
    0.7518742814281371 * zD65;

  const pivot = (value: number) =>
    value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116;
  const fx = pivot(x / (0.3457 / 0.3585));
  const fy = pivot(y);
  const fz = pivot(z / ((1 - 0.3457 - 0.3585) / 0.3585));

  return rememberLab(hex, [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]);
};

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degreesValue: number) => (degreesValue * Math.PI) / 180;

/** CIEDE2000 with kL/kC/kH = 1. */
const deltaE2000 = (first: Lab, second: Lab): number => {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const chroma1 = Math.hypot(a1, b1);
  const chroma2 = Math.hypot(a2, b2);
  const averageChroma = (chroma1 + chroma2) / 2;
  const averageChromaToSeventh = averageChroma ** 7;
  const g =
    0.5 *
    (1 -
      Math.sqrt(averageChromaToSeventh / (averageChromaToSeventh + 25 ** 7)));
  const adjustedA1 = (1 + g) * a1;
  const adjustedA2 = (1 + g) * a2;
  const adjustedChroma1 = Math.hypot(adjustedA1, b1);
  const adjustedChroma2 = Math.hypot(adjustedA2, b2);
  const hue1 =
    adjustedChroma1 === 0
      ? 0
      : (degrees(Math.atan2(b1, adjustedA1)) + 360) % 360;
  const hue2 =
    adjustedChroma2 === 0
      ? 0
      : (degrees(Math.atan2(b2, adjustedA2)) + 360) % 360;
  const hueDifference = hue2 - hue1;
  const absoluteHueDifference = Math.abs(hueDifference);
  const deltaHue =
    adjustedChroma1 * adjustedChroma2 === 0
      ? 0
      : absoluteHueDifference <= 180
        ? hueDifference
        : hueDifference > 180
          ? hueDifference - 360
          : hueDifference + 360;
  const deltaLightness = l2 - l1;
  const deltaChroma = adjustedChroma2 - adjustedChroma1;
  const deltaHueComponent =
    2 *
    Math.sqrt(adjustedChroma1 * adjustedChroma2) *
    Math.sin(radians(deltaHue / 2));
  const averageLightness = (l1 + l2) / 2;
  const averageAdjustedChroma = (adjustedChroma1 + adjustedChroma2) / 2;
  const averageHue =
    adjustedChroma1 * adjustedChroma2 === 0
      ? hue1 + hue2
      : absoluteHueDifference <= 180
        ? (hue1 + hue2) / 2
        : hue1 + hue2 < 360
          ? (hue1 + hue2 + 360) / 2
          : (hue1 + hue2 - 360) / 2;
  const lightnessSquare = (averageLightness - 50) ** 2;
  const lightnessWeight =
    1 + (0.015 * lightnessSquare) / Math.sqrt(20 + lightnessSquare);
  const chromaWeight = 1 + 0.045 * averageAdjustedChroma;
  const hueWeight =
    1 +
    0.015 *
      averageAdjustedChroma *
      (1 -
        0.17 * Math.cos(radians(averageHue - 30)) +
        0.24 * Math.cos(radians(2 * averageHue)) +
        0.32 * Math.cos(radians(3 * averageHue + 6)) -
        0.2 * Math.cos(radians(4 * averageHue - 63)));
  const averageAdjustedChromaToSeventh = averageAdjustedChroma ** 7;
  const rotation =
    -2 *
    Math.sqrt(
      averageAdjustedChromaToSeventh /
        (averageAdjustedChromaToSeventh + 25 ** 7)
    ) *
    Math.sin(radians(60 * Math.exp(-1 * ((averageHue - 275) / 25) ** 2)));
  const lightnessTerm = deltaLightness / lightnessWeight;
  const chromaTerm = deltaChroma / chromaWeight;
  const hueTerm = deltaHueComponent / hueWeight;

  return Math.sqrt(
    lightnessTerm ** 2 +
      chromaTerm ** 2 +
      hueTerm ** 2 +
      rotation * chromaTerm * hueTerm
  );
};

const normaliseTargetSet = (selectedColours: readonly string[]) =>
  [
    ...new Set(
      selectedColours
        .map(normaliseHex)
        .filter((colour): colour is string => colour !== null)
    ),
  ].sort();

const nearestPaletteDistance = (
  normalisedTargets: readonly string[],
  palette: readonly string[]
) => {
  const normalisedPalette = palette
    .map(normaliseHex)
    .filter((colour): colour is string => colour !== null);
  if (!normalisedTargets.length || !normalisedPalette.length) return Infinity;

  let nearest = Infinity;
  for (const selected of normalisedTargets) {
    const selectedLab = hexToLab(selected);
    for (const paletteColour of normalisedPalette) {
      const distance = deltaE2000(selectedLab, hexToLab(paletteColour));
      if (distance < nearest) nearest = distance;
    }
  }
  return nearest;
};

export const getNearestPaletteColourDistance = (
  selectedColours: readonly string[],
  palette: readonly string[]
) => nearestPaletteDistance(normaliseTargetSet(selectedColours), palette);

/**
 * Reuses a candidate's result for an equivalent set of selected colours. Palette
 * data is immutable search-result metadata, so a WeakMap lets cards be collected
 * when React replaces their result set.
 */
export const getCachedCandidatePaletteColourDistance = <T extends object>(
  candidate: T,
  selectedColours: readonly string[],
  palette: readonly string[]
) => {
  const targetSet = normaliseTargetSet(selectedColours);
  if (!targetSet.length) return Infinity;
  const targetSetKey = targetSet.join(',');
  let distances = candidateDistanceByTargetSet.get(candidate);
  if (!distances) {
    distances = new Map();
    candidateDistanceByTargetSet.set(candidate, distances);
  }
  const cached = distances.get(targetSetKey);
  if (cached !== undefined) {
    distances.delete(targetSetKey);
    distances.set(targetSetKey, cached);
    return cached;
  }

  const distance = nearestPaletteDistance(targetSet, palette);
  if (distances.size >= CANDIDATE_TARGET_CACHE_LIMIT) {
    const oldestTargetSet = distances.keys().next().value;
    if (oldestTargetSet) distances.delete(oldestTargetSet);
  }
  distances.set(targetSetKey, distance);
  return distance;
};

export const rankByPaletteColour = <T>(
  candidates: readonly T[],
  selectedColours: readonly string[],
  getPalette: (candidate: T) => readonly string[]
): T[] => {
  if (!normaliseTargetSet(selectedColours).length) return [...candidates];

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      distance:
        typeof candidate === 'object' && candidate !== null
          ? getCachedCandidatePaletteColourDistance(
              candidate,
              selectedColours,
              getPalette(candidate)
            )
          : getNearestPaletteColourDistance(
              selectedColours,
              getPalette(candidate)
            ),
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ candidate }) => candidate);
};

export const __resetLocalColourRefinementCachesForTest = () => {
  labByHex.clear();
};

export const __getLocalColourRefinementCacheStatsForTest = () => ({
  labEntries: labByHex.size,
});
