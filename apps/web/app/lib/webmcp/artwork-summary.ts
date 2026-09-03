/**
 * Projects Paillette's search payloads into the compact records handed to an
 * agent.
 *
 * Raw results carry every field twice (camelCase and snake_case), a full
 * generated description, and a palette as `{color, rgb, percentage}` objects.
 * A 30-result page of that is ~90KB of context the model pays for and cannot
 * use. These projections keep what an agent actually reasons over — identity,
 * attribution, date, medium, palette, rights, and a citable source URL — and
 * push the long-form fields behind `lookup_artwork`.
 */

import type { ArtworkSearchResult } from '~/types';

/** What an agent gets back for each hit in a result set. */
export interface AgentArtworkSummary {
  id: string;
  title: string | null;
  artist: string | null;
  /** Numeric year where the source has one. */
  year: number | null;
  /** The source's own date phrasing, e.g. "c. 1564/1565". */
  dateText: string | null;
  medium: string | null;
  classification: string | null;
  /** Cosine similarity for search hits; null when browsing. */
  similarity: number | null;
  /** Up to six dominant hex colours, most prominent first. */
  palette: string[];
  /** Publicly fetchable image (CORS-open) — safe for an agent to read. */
  thumbnailUrl: string | null;
  imageUrl: string | null;
  /** Canonical record at the holding institution — cite this, not Paillette. */
  sourceUrl: string | null;
  sourceInstitution: string | null;
}

/** Everything in the summary, plus the long-form catalogue fields. */
export interface AgentArtworkDetail extends AgentArtworkSummary {
  description: string | null;
  creditLine: string | null;
  accessionNumber: string | null;
  sourceCollection: string | null;
  sourceRecordId: string | null;
  rights: string | null;
  /** True when the holding institution publishes the image as open access. */
  openAccess: boolean | null;
  /** Full palette with weights, for colour reasoning. */
  dominantColors: { color: string; percentage: number | null }[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Paillette's own asset URLs (`/api/v1/assets/<id>/content`) require a session,
 * so they are useless to an anonymous agent and render as broken images in the
 * activity panel. Open-access records carry the holding institution's public
 * IIIF URL in their provenance blob, which is served with
 * `Access-Control-Allow-Origin: *`. Prefer that everywhere.
 */
const readSourceImageUrl = (artwork: ArtworkSearchResult): string | null => {
  const provenance = meta(artwork).provenance;
  if (typeof provenance !== 'string') return null;
  try {
    const parsed = JSON.parse(provenance) as { source_image_url?: unknown };
    const url = asText(parsed?.source_image_url);
    return url && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    // Not every collection stores provenance as JSON.
    return null;
  }
};

/**
 * The image URL an agent (or this page's own panel) can actually read.
 * Exported because `search_by_image` needs the same resolution when it turns
 * an artworkId into a query image.
 */
export const getReadableImageUrl = (
  artwork: ArtworkSearchResult
): string | null => readSourceImageUrl(artwork) ?? artwork.imageUrl ?? null;

/** IIIF exposes size in the path; ask for a grid-sized rendering. */
const IIIF_FULL_SIZE = /\/full\/[^/]+\/0\//;

const readSourceThumbnailUrl = (sourceImageUrl: string | null) =>
  sourceImageUrl && IIIF_FULL_SIZE.test(sourceImageUrl)
    ? sourceImageUrl.replace(IIIF_FULL_SIZE, '/full/400,/0/')
    : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const meta = (artwork: ArtworkSearchResult): Record<string, unknown> =>
  (artwork.metadata as Record<string, unknown> | undefined) ?? {};

/** Reads either metadata spelling; the API emits both for back-compat. */
const field = (
  artwork: ArtworkSearchResult,
  camel: string,
  snake: string
): unknown => {
  const record = meta(artwork);
  return record[camel] ?? record[snake];
};

/**
 * Normalises the several palette encodings the API has shipped over time into
 * `{color, percentage}` pairs, weightiest first, deduplicated.
 */
export const collectDominantColors = (
  artwork: ArtworkSearchResult
): { color: string; percentage: number | null }[] => {
  const record = meta(artwork);
  const candidates = [
    record.dominantColors,
    record.dominant_colors,
    record.colorPalette,
    record.color_palette,
  ];
  const collected: { color: string; percentage: number | null }[] = [];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === 'string' && HEX.test(item)) {
          collected.push({ color: item.toUpperCase(), percentage: null });
          continue;
        }
        if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>;
          const color = asText(entry.color);
          const percentage = asNumber(entry.percentage);
          if (color && HEX.test(color) && percentage !== 0) {
            collected.push({ color: color.toUpperCase(), percentage });
          }
        }
      }
      continue;
    }
    // `{ colors: string[], percentages: number[] }`
    if (candidate && typeof candidate === 'object' && 'colors' in candidate) {
      const palette = candidate as { colors?: unknown; percentages?: unknown };
      const percentages = Array.isArray(palette.percentages)
        ? palette.percentages
        : [];
      if (Array.isArray(palette.colors)) {
        palette.colors.forEach((color, index) => {
          const percentage = asNumber(percentages[index]);
          if (
            typeof color === 'string' &&
            HEX.test(color) &&
            percentage !== 0
          ) {
            collected.push({ color: color.toUpperCase(), percentage });
          }
        });
      }
    }
  }

  const seen = new Set<string>();
  return collected
    .filter((entry) => {
      if (seen.has(entry.color)) return false;
      seen.add(entry.color);
      return true;
    })
    .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0));
};

/** Just the hex values, for palette matching and for the summary projection. */
export const collectPalette = (artwork: ArtworkSearchResult): string[] =>
  collectDominantColors(artwork).map((entry) => entry.color);

/** Similarity is a float with more precision than is meaningful; round it. */
const roundSimilarity = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed * 1000) / 1000;
};

export const toAgentArtworkSummary = (
  artwork: ArtworkSearchResult
): AgentArtworkSummary => {
  const sourceImageUrl = readSourceImageUrl(artwork);
  return {
    id: artwork.id,
    title: asText(artwork.title),
    artist: asText(artwork.artist),
    year: asNumber(artwork.year),
    dateText: asText(field(artwork, 'dateText', 'date_text')),
    medium: asText(meta(artwork).medium),
    classification: asText(meta(artwork).classification),
    similarity: roundSimilarity(artwork.similarity),
    palette: collectPalette(artwork).slice(0, 6),
    thumbnailUrl:
      readSourceThumbnailUrl(sourceImageUrl) ??
      sourceImageUrl ??
      asText(artwork.thumbnailUrl),
    imageUrl: sourceImageUrl ?? asText(artwork.imageUrl),
    sourceUrl: asText(field(artwork, 'sourceUrl', 'source_url')),
    sourceInstitution: asText(
      field(artwork, 'sourceInstitution', 'source_institution')
    ),
  };
};

/** Long descriptions are useful but not worth 2KB each; cap them. */
const DESCRIPTION_LIMIT = 900;

export const toAgentArtworkDetail = (
  artwork: ArtworkSearchResult
): AgentArtworkDetail => {
  const description = asText(meta(artwork).description);
  return {
    ...toAgentArtworkSummary(artwork),
    description:
      description && description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT)}…`
        : description,
    creditLine: asText(field(artwork, 'creditLine', 'credit_line')),
    accessionNumber: asText(
      field(artwork, 'accessionNumber', 'accession_number')
    ),
    sourceCollection: asText(
      field(artwork, 'sourceCollection', 'source_collection')
    ),
    sourceRecordId: asText(
      field(artwork, 'sourceRecordId', 'source_record_id')
    ),
    rights: asText(meta(artwork).rights),
    openAccess:
      typeof meta(artwork).openAccess === 'boolean'
        ? (meta(artwork).openAccess as boolean)
        : null,
    dominantColors: collectDominantColors(artwork),
  };
};
