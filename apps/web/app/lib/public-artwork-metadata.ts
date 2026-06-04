import type { Artwork, ArtworkSearchResult } from '~/types';
import { formatDimensions } from '~/lib/utils';

type PublicArtwork = Partial<Artwork & ArtworkSearchResult> &
  Record<string, any>;

export type PublicMetadataRow = {
  label: string;
  value: string;
  sourceLabel: string;
};

export type PublicMetadataGroup = {
  id: 'ngs' | 'roots' | 'metadata';
  label: string;
  sourceLabel: string;
  rows: PublicMetadataRow[];
};

export type PublicDescriptionDetails = {
  text: string;
  source: 'ngs' | 'roots' | 'metadata';
  sourceLabel: string;
};

export type PublicCitationParts = {
  artist: string;
  title: string;
  date: string;
  physical: string | null;
  institution: string | null;
  plainText: string;
  htmlText: string;
};

export const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const decodeHtmlEntities = (value: string) =>
  value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith('#x')) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      if (normalized.startsWith('#')) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      return NAMED_HTML_ENTITIES[normalized] ?? match;
    }
  );

const normalizePublicText = (value: string) =>
  decodeHtmlEntities(value)
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z0-9)\]][.!?])([A-Z][a-z])/g, '$1 $2')
    .trim();

export const asText = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? normalizePublicText(value)
    : null;

const asParsedRecord = (value: unknown): Record<string, any> => {
  const record = asRecord(value);
  if (Object.keys(record).length > 0) return record;

  const text = asText(value);
  if (!text) return {};

  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return null;
};

const firstMatchingText = (
  predicate: (text: string) => boolean,
  ...values: unknown[]
) => {
  for (const value of values) {
    const text = asText(value);
    if (text && predicate(text)) return text;
  }
  return null;
};

const isNgsUrl = (value: string) => /nationalgallery\.sg/i.test(value);
const isRootsUrl = (value: string) => /roots\.gov\.sg/i.test(value);

const NGS_SOURCE_LABEL = 'National Gallery Singapore';
const ROOTS_SOURCE_LABEL = 'Roots NHB';
const METADATA_SOURCE_LABEL = 'Public metadata';
const AI_SOURCE_LABEL = 'Paillette AI';

const SOURCE_LABELS: Record<string, string> = {
  ngs: NGS_SOURCE_LABEL,
  ngs_source_data: NGS_SOURCE_LABEL,
  stored_ngs_source_data: NGS_SOURCE_LABEL,
  national_gallery_singapore: NGS_SOURCE_LABEL,
  nationalgallerysingapore: NGS_SOURCE_LABEL,
  roots: ROOTS_SOURCE_LABEL,
  nhb_roots: ROOTS_SOURCE_LABEL,
  roots_nhb: ROOTS_SOURCE_LABEL,
  ngs_artplus_catalog: NGS_SOURCE_LABEL,
  artplus: NGS_SOURCE_LABEL,
  'ngs art+ catalogue': NGS_SOURCE_LABEL,
  metadata: METADATA_SOURCE_LABEL,
  ai: AI_SOURCE_LABEL,
  paillette_ai: AI_SOURCE_LABEL,
  generated_caption: AI_SOURCE_LABEL,
  generatedcaption: AI_SOURCE_LABEL,
};

const formatSourceLabel = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const cleaned = text.replace(/^from\s+/i, '').trim();
  const key = cleaned.toLowerCase().replace(/[\s-]+/g, '_');

  if (SOURCE_LABELS[cleaned] || SOURCE_LABELS[key]) {
    return SOURCE_LABELS[cleaned] || SOURCE_LABELS[key];
  }

  if (/national\s*gallery\s*singapore|^ngs\b|art\+|artplus/i.test(cleaned)) {
    return NGS_SOURCE_LABEL;
  }

  if (/roots|nhb/i.test(cleaned)) {
    return ROOTS_SOURCE_LABEL;
  }

  if (/^metadata$|^public metadata$/i.test(cleaned)) {
    return METADATA_SOURCE_LABEL;
  }

  if (/paillette|generated\s*caption|^ai$/i.test(cleaned)) {
    return AI_SOURCE_LABEL;
  }

  return null;
};

const isAiSourceLabel = (label: string | null) => label === AI_SOURCE_LABEL;

const getPublicFieldSources = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return {
    ...asRecord(meta.fieldSources),
    ...asRecord(meta.field_sources),
    ...asRecord(artwork.fieldSources),
    ...asRecord(artwork.field_sources),
  };
};

const getFieldSourceLabel = (
  fieldSources: Record<string, unknown>,
  ...keys: string[]
) => {
  for (const key of keys) {
    const label = formatSourceLabel(fieldSources[key]);
    if (label) return label;
  }
  return null;
};

const asFromSourceLabel = (label: string) =>
  label.toLowerCase().startsWith('from ') ? label : `From ${label}`;

export const isMalformedDateText = (value: unknown) => {
  const text = asText(value);
  return Boolean(text && (/^\d{1,3}$/.test(text) || /^\d{5,}$/.test(text)));
};

export const getPublicDateText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  if (shouldPreferRootsRecord(artwork)) {
    const rootsDate = getRootsRecordText(
      artwork,
      'year_period',
      'yearPeriod',
      'date_period',
      'datePeriod',
      'creation_date',
      'creationDate',
      'start_date',
      'startDate',
      'year',
      'Year/Period'
    );
    if (rootsDate && !isMalformedDateText(rootsDate)) return rootsDate;
  }

  const dateText = firstText(artwork.date_text, meta.dateText, meta.date_text);
  if (dateText && !isMalformedDateText(dateText)) return dateText;

  const year =
    typeof artwork.year === 'number' ? artwork.year : Number(meta.year);
  return Number.isFinite(year) && year >= 1000 && year <= 9999
    ? String(year)
    : null;
};

export const isInternalRecordId = (value: unknown) => {
  const text = asText(value);
  return Boolean(text && /^data_aws\d*k_/i.test(text));
};

const firstPublicText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text && !isInternalRecordId(text)) return text;
  }
  return null;
};

const isInternalCatalogueText = (value: unknown) => {
  const text = asText(value);
  return Boolean(
    text &&
      (/^DO NOT REPRODUCE$/i.test(text) ||
        /^[A-Z]{1,3}\s*-\s*copyright/i.test(text) ||
        /copyright documents received/i.test(text) ||
        /copyright denied/i.test(text))
  );
};

const firstPublicCatalogueText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text && !isInternalCatalogueText(text)) return text;
  }
  return null;
};

const CREDIT_LINE_TEXT_START_RE =
  /^(collection of national gallery singapore|gift of|donated by|bequest of|purchase(?:d)? (?:with|from)|acquired (?:with|from)|commissioned by)\b/i;
const CREDIT_LINE_RIGHTS_RE = /(?:©|copyright|\ball rights reserved\b)/i;
const SHORT_CREDIT_LINE_WORD_LIMIT = 18;
const SHORT_RIGHTS_LINE_WORD_LIMIT = 24;

const countWords = (value: string) =>
  value.split(/\s+/).filter(Boolean).length;

const isCreditLineOnlyCatalogueText = (value: unknown) => {
  const text = asText(value);
  if (!text || !CREDIT_LINE_TEXT_START_RE.test(text)) return false;

  const wordCount = countWords(text);
  return (
    wordCount <= SHORT_CREDIT_LINE_WORD_LIMIT ||
    (CREDIT_LINE_RIGHTS_RE.test(text) &&
      wordCount <= SHORT_RIGHTS_LINE_WORD_LIMIT)
  );
};

const firstPublicDescriptionText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (
      text &&
      !isInternalCatalogueText(text) &&
      !isCreditLineOnlyCatalogueText(text)
    ) {
      return text;
    }
  }
  return null;
};

const firstArrayText = (value: unknown) => {
  if (!Array.isArray(value)) return null;

  for (const entry of value) {
    const text = asText(entry);
    if (text) return text;
  }

  return null;
};

const normalizeComparableText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\d{4}[^)]*\)/g, ' ')
    .replace(/[\u2018\u2019\u201c\u201d"'`\[\]]/g, '')
    .replace(/\b(not titled|title unknown|sans titre)\b/g, 'untitled')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const removeComparableArticles = (value: string) =>
  value.replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

const editDistanceAtMost = (left: string, right: string, maxDistance: number) => {
  if (Math.abs(left.length - right.length) > maxDistance) return false;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0] ?? leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        (previous[rightIndex] ?? rightIndex) + 1,
        (current[rightIndex - 1] ?? leftIndex) + 1,
        (previous[rightIndex - 1] ?? rightIndex - 1) + substitutionCost
      );
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maxDistance) return false;
    previous = current;
  }

  return (previous[right.length] ?? maxDistance + 1) <= maxDistance;
};

const normalizedComparableTextMatches = (
  normalizedLeft: string,
  normalizedRight: string
) => {
  if (normalizedLeft === normalizedRight) return true;

  const [shorter, longer] =
    normalizedLeft.length <= normalizedRight.length
      ? [normalizedLeft, normalizedRight]
      : [normalizedRight, normalizedLeft];

  if (shorter.length < 8) return false;
  if (longer.includes(shorter)) return true;

  const maxDistance = Math.max(1, Math.floor(shorter.length * 0.08));
  return editDistanceAtMost(shorter, longer, maxDistance);
};

const comparableTextMatches = (left: string | null, right: string | null) => {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);

  if (!normalizedLeft || !normalizedRight) return true;
  if (normalizedComparableTextMatches(normalizedLeft, normalizedRight)) {
    return true;
  }

  const articlelessLeft = removeComparableArticles(normalizedLeft);
  const articlelessRight = removeComparableArticles(normalizedRight);
  if (!articlelessLeft || !articlelessRight) return true;
  if (
    articlelessLeft !== normalizedLeft ||
    articlelessRight !== normalizedRight
  ) {
    return normalizedComparableTextMatches(articlelessLeft, articlelessRight);
  }

  return false;
};

const hasRecordContent = (record: Record<string, any>) =>
  Object.values(record).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && typeof value === 'object');
  });

type PublicDescriptionGroup = {
  source: PublicDescriptionDetails['source'];
  sourceLabel: string;
  values: unknown[];
};

const firstPublicCatalogueDetails = (
  ...groups: PublicDescriptionGroup[]
): PublicDescriptionDetails | null => {
  for (const group of groups) {
    const text = firstPublicDescriptionText(...group.values);
    if (text) {
      return {
        text,
        source: group.source,
        sourceLabel: group.sourceLabel,
      };
    }
  }

  return null;
};

const publicCatalogueDetailsFromGroups = (
  groups: PublicDescriptionGroup[]
): PublicDescriptionDetails[] => {
  const seen = new Set<string>();
  const details: PublicDescriptionDetails[] = [];

  for (const group of groups) {
    const text = firstPublicDescriptionText(...group.values);
    if (!text) continue;

    const key = normalizeComparableText(text);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    details.push({
      text,
      source: group.source,
      sourceLabel: group.sourceLabel,
    });
  }

  return details;
};

export const getPublicMetadata = (artwork: PublicArtwork) =>
  asRecord(artwork.custom_metadata || artwork.metadata);

const getStandardImageUrl = (artwork: PublicArtwork) =>
  firstPublicText(
    artwork.imageUrl,
    artwork.image_url,
    artwork.thumbnailUrl,
    artwork.thumbnail_url
  );

const getStandardThumbnailUrl = (artwork: PublicArtwork) =>
  firstPublicText(
    artwork.thumbnailUrl,
    artwork.thumbnail_url,
    artwork.imageUrl,
    artwork.image_url
  );

// These accessions currently point at the same NGS "No image available"
// placeholder asset in staging, so treat them as metadata-only records.
const NGS_NO_IMAGE_PLACEHOLDER_ACCESSIONS = new Set([
  '2011-00892',
  '2011-00893',
  '2011-00894',
  '2011-02261',
  '2011-03007',
  '2012-00766',
  '2015-00382',
  '2015-01976',
  '2017-00534',
  '2017-00812',
  '2017-00813',
  '2017-00819',
  '2017-00864',
  '2018-01262',
  '2018-01263',
  '2018-01264',
  '2018-01273',
  '2018-01274',
  '2018-01275',
  '2018-01276',
  '2018-01277',
  '2019-00373',
  '2020-00352',
  '2020-00551',
  '2021-00063',
  '2021-00064',
  '2021-00065',
  '2021-00658',
  '2021-01066',
  'ASB-0068',
  'GI-0058',
  'GI-0146',
  'GI-0292',
  'GI-0577',
  'GI-0810-(OT)',
  'P-0282',
  'P-0285',
  'P-0606',
  'P-1089',
]);

const hasKnownNgsNoImagePlaceholder = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const accession = firstPublicText(
    artwork.accession_number,
    artwork.accessionNumber,
    artwork.source_record_id,
    artwork.sourceRecordId,
    meta.accession_number,
    meta.accessionNumber,
    meta.source_record_id,
    meta.sourceRecordId,
    artwork.id
  );

  return Boolean(
    accession && NGS_NO_IMAGE_PLACEHOLDER_ACCESSIONS.has(accession)
  );
};

const getExplicitNgsImageUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  return (
    firstPublicText(
      meta.ngs_image_url,
      meta.ngsImageUrl,
      meta.national_gallery_image_url,
      meta.nationalGalleryImageUrl,
      ngsRecord.imageUrl,
      ngsRecord.image_url,
      ngsRecord.thumbnailUrl,
      ngsRecord.thumbnail_url,
      ngsRecord.img
    ) ||
    firstMatchingText(
      isNgsUrl,
      artwork.imageUrl,
      artwork.image_url,
      artwork.thumbnailUrl,
      artwork.thumbnail_url
    )
  );
};

const getExplicitNgsThumbnailUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  return (
    firstPublicText(
      meta.ngs_thumbnail_url,
      meta.ngsThumbnailUrl,
      meta.ngs_image_url,
      meta.ngsImageUrl,
      ngsRecord.thumbnailUrl,
      ngsRecord.thumbnail_url,
      ngsRecord.imageUrl,
      ngsRecord.image_url,
      ngsRecord.img
    ) || getExplicitNgsImageUrl(artwork)
  );
};

export const getPublicImageUrl = (artwork: PublicArtwork) => {
  if (hasKnownNgsNoImagePlaceholder(artwork)) {
    return null;
  }

  if (shouldSuppressRootsRecord(artwork)) {
    return getExplicitNgsImageUrl(artwork);
  }

  return getStandardImageUrl(artwork) || getExplicitNgsImageUrl(artwork);
};

export const getPublicThumbnailUrl = (artwork: PublicArtwork) => {
  if (hasKnownNgsNoImagePlaceholder(artwork)) {
    return null;
  }

  if (shouldSuppressRootsRecord(artwork)) {
    return getExplicitNgsThumbnailUrl(artwork);
  }

  return getStandardThumbnailUrl(artwork) || getExplicitNgsThumbnailUrl(artwork);
};

const getPublicMediumText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  if (shouldPreferRootsRecord(artwork)) {
    const rootsMaterial = getRootsMaterialText(artwork);
    const rootsTechnique = getRootsTechniqueText(artwork);
    const rootsObjectType = getRootsObjectTypeText(artwork);
    const rootsMedium = [rootsMaterial, rootsTechnique]
      .filter(Boolean)
      .join('; ');

    if (rootsMedium || rootsMaterial || rootsObjectType) {
      return rootsMedium || rootsMaterial || rootsObjectType || null;
    }
  }

  return firstPublicCatalogueText(
    artwork.medium,
    meta.medium,
    ngsRecord.objMaterialTechniqueTxt
  );
};

const cleanDimensionText = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;

  const cleaned = text
    .replace(/\bnull\b/gi, ' ')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .replace(/\s+x\s+(?=(cm|mm|m|in)\b)/gi, ' ')
        .replace(/\s+x\s*$/gi, '')
        .replace(/\s+,/g, ',')
        .replace(/,\s*$/g, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n');

  return cleaned || null;
};

const getDimensionTextFromRecordValues = (
  record: Record<string, any>,
  hadNullComponent: boolean
) => {
  const values = [record.firstNum, record.secondNum, record.thirdNum]
    .map((value, index) => {
      const text = asText(value);
      if (
        index === 2 &&
        hadNullComponent &&
        text &&
        /^0(?:\.0+)?$/.test(text)
      ) {
        return null;
      }
      return text;
    })
    .filter((value): value is string => Boolean(value));
  if (values.length === 0) return null;

  const unit = asText(record.unitVoc) || asText(record.unit);
  return `${values.join(' x ')}${unit ? ` ${unit}` : ''}`;
};

const getDimensionSummaryFromRecord = (record: Record<string, any>) => {
  const summary = cleanDimensionText(record.summary);
  const type = firstPublicCatalogueText(record.type);
  const hadPlaceholder = /\bnull\b/i.test(String(record.summary ?? ''));
  const hadNullComponent = /\bx\s*null\b/i.test(String(record.summary ?? ''));
  const dimensionsFromValues = getDimensionTextFromRecordValues(
    record,
    hadNullComponent
  );

  if (hadPlaceholder && dimensionsFromValues) {
    return type ? `${type}: ${dimensionsFromValues}` : dimensionsFromValues;
  }

  if (summary) {
    return hadPlaceholder && type ? `${type}: ${summary}` : summary;
  }

  const dimensions = dimensionsFromValues;
  if (!dimensions) return null;

  return type ? `${type}: ${dimensions}` : dimensions;
};

const getFirstDimensionSummary = (groups: unknown) => {
  if (!Array.isArray(groups)) return null;

  for (const group of groups) {
    const record = asRecord(group);
    const summary = getDimensionSummaryFromRecord(record);
    if (summary) return summary;
  }

  return null;
};

export const getPublicDimensionsText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  if (shouldPreferRootsRecord(artwork)) {
    const rootsDimension = getRootsRecordText(
      artwork,
      'dimension',
      'dimensions',
      'dimension_text',
      'dimensionText',
      'published_dimension',
      'publishedDimension',
      'Dimension'
    );

    if (rootsDimension) return cleanDimensionText(rootsDimension);
  }

  return firstPublicCatalogueText(
    getFirstDimensionSummary(ngsRecord.objDim2DGrp),
    getFirstDimensionSummary(ngsRecord.objDim3DGrp),
    cleanDimensionText(meta.dimensions_text),
    cleanDimensionText(meta.dimensionsText),
    cleanDimensionText(meta.published_dimension),
    cleanDimensionText(meta.publishedDimension),
    formatDimensions(artwork.dimensions)
  );
};

const normalizeCitationDimension = (value: string | null) =>
  value
    ?.replace(/^(image|object|frame)\s+measure:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[×x]\s*/g, ' x ')
    .trim() || null;

const trimCitationPart = (value: string | null) =>
  value?.replace(/[.;,\s]+$/g, '').trim() || null;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getCitationInstitution = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const rootsCollection = shouldPreferRootsRecord(artwork)
    ? getRootsCollectionText(artwork)
    : null;
  if (shouldPreferRootsRecord(artwork)) {
    return rootsCollection || ROOTS_SOURCE_LABEL;
  }

  const institution = firstPublicCatalogueText(
    artwork.source_institution,
    meta.sourceInstitution,
    meta.source_institution
  );

  if (institution?.toLowerCase().includes('national gallery singapore')) {
    return 'National Gallery Singapore, Singapore';
  }

  return institution;
};

export const getPublicCitationParts = (
  artwork: PublicArtwork
): PublicCitationParts => {
  const artist = trimCitationPart(getPublicArtist(artwork)) || 'Unknown artist';
  const title = trimCitationPart(getPublicTitle(artwork)) || 'Untitled';
  const date = trimCitationPart(getPublicDateText(artwork)) || 'n.d.';
  const medium = trimCitationPart(getPublicMediumText(artwork));
  const dimensions = trimCitationPart(
    normalizeCitationDimension(getPublicDimensionsText(artwork))
  );
  const institution = trimCitationPart(getCitationInstitution(artwork));

  const physical = [medium, dimensions].filter(Boolean).join(', ');
  const parts = [artist, title, date, physical || null, institution].filter(
    (part): part is string => Boolean(part)
  );

  const htmlParts = [
    escapeHtml(artist),
    `<cite>${escapeHtml(title)}</cite>`,
    escapeHtml(date),
    physical ? escapeHtml(physical) : null,
    institution ? escapeHtml(institution) : null,
  ].filter((part): part is string => Boolean(part));

  return {
    artist,
    title,
    date,
    physical: physical || null,
    institution,
    plainText: `${parts.join('. ')}.`,
    htmlText: `${htmlParts.join('. ')}.`,
  };
};

export const getPublicCitation = (artwork: PublicArtwork) =>
  getPublicCitationParts(artwork).plainText;

export const getGeneratedCaptionRecord = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return asRecord(meta.generated_caption || meta.generatedCaption);
};

export const getGeneratedCaptionText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const caption = meta.generated_caption || meta.generatedCaption;
  const fieldSources = getPublicFieldSources(artwork);
  const captionSource = getFieldSourceLabel(fieldSources, 'caption');

  if (typeof caption === 'string') return caption.trim() || null;
  return (
    asText(getGeneratedCaptionRecord(artwork).text) ||
    (isAiSourceLabel(captionSource) ? asText(meta.caption) : null)
  );
};

export const getSourceRecords = (
  artwork: PublicArtwork
): Record<string, any> => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = asParsedRecord(
    meta.source_records || meta.sourceRecords
  );

  return {
    ...sourceRecords,
    ngs: asParsedRecord(
      sourceRecords.ngs ||
        sourceRecords.raw_ngs ||
        sourceRecords.rawNgs ||
        meta.raw_ngs ||
        meta.rawNgs
    ),
    roots: asParsedRecord(
      sourceRecords.roots ||
        sourceRecords.raw_roots ||
        sourceRecords.rawRoots ||
        meta.raw_roots ||
        meta.rawRoots
    ),
  };
};

const getNgsRecordTitle = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  return firstPublicCatalogueText(
    ngsRecord.objObjectTitleTxt,
    ngsRecord.title,
    ngsRecord.objectTitle,
    ngsRecord.name
  );
};

const getRootsRecordTitle = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  const rootsRecord = asRecord(sourceRecords.roots);

  return firstPublicCatalogueText(
    rootsRecord.title,
    rootsRecord.objectTitle,
    rootsRecord.object_title,
    rootsRecord.name
  );
};

const getNgsRecordArtist = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);
  const artistCfs = Array.isArray(ngsRecord.artistCfs)
    ? ngsRecord.artistCfs
    : [];

  return firstPublicCatalogueText(
    firstArrayText(ngsRecord.artistAvailableNames),
    ...artistCfs.map((artist) => asRecord(artist).availableName),
    ...artistCfs.map((artist) => asRecord(artist).perNameTxt),
    ngsRecord.creator,
    ngsRecord.artist
  );
};

const getRootsRecordArtist = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  const rootsRecord = asRecord(sourceRecords.roots);

  return firstPublicCatalogueText(
    rootsRecord.creator,
    rootsRecord.artist,
    rootsRecord.maker,
    rootsRecord.author
  );
};

const normalizeAccessionText = (value: unknown) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const rootsRecordMatchesAccession = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  const rootsRecord = asRecord(sourceRecords.roots);
  const meta = getPublicMetadata(artwork);
  const artworkAccession = firstPublicCatalogueText(
    artwork.accession_number,
    artwork.accessionNumber,
    artwork.source_record_id,
    artwork.sourceRecordId,
    meta.accession_number,
    meta.accessionNumber
  );
  const rootsAccession = firstPublicCatalogueText(
    rootsRecord.accession,
    rootsRecord.accession_number,
    rootsRecord.accessionNumber,
    rootsRecord.object_number,
    rootsRecord.objectNumber
  );

  return Boolean(
    artworkAccession &&
      rootsAccession &&
      normalizeAccessionText(artworkAccession) ===
        normalizeAccessionText(rootsAccession)
  );
};

const hasAccessionMatchedTitleVariant = (artwork: PublicArtwork) => {
  if (!rootsRecordMatchesAccession(artwork)) return false;

  const rootsTitle = getRootsRecordTitle(artwork);
  const ngsOrDisplayedTitle =
    getNgsRecordTitle(artwork) ||
    firstPublicCatalogueText(artwork.title, getPublicMetadata(artwork).title);

  return Boolean(
    rootsTitle &&
      ngsOrDisplayedTitle &&
      !comparableTextMatches(rootsTitle, ngsOrDisplayedTitle)
  );
};

export const hasNgsSourceRecord = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  return Boolean(
    hasRecordContent(asRecord(sourceRecords.ngs)) || getNgsUrl(artwork)
  );
};

export const hasRootsSourceRecord = (artwork: PublicArtwork) => {
  const sourceRecords = getSourceRecords(artwork);
  return Boolean(
    hasRecordContent(asRecord(sourceRecords.roots)) || getRawRootsUrl(artwork)
  );
};

export const hasPublicSourceMismatch = (artwork: PublicArtwork) => {
  if (rootsRecordMatchesAccession(artwork)) {
    return false;
  }

  const rootTitle = getRootsRecordTitle(artwork);
  const ngsOrDisplayedTitle =
    getNgsRecordTitle(artwork) ||
    firstPublicCatalogueText(artwork.title, getPublicMetadata(artwork).title);
  const rootArtist = getRootsRecordArtist(artwork);
  const ngsOrDisplayedArtist =
    getNgsRecordArtist(artwork) ||
    firstPublicCatalogueText(artwork.artist, getPublicMetadata(artwork).artist);

  const titleMismatch = Boolean(
    rootTitle &&
      ngsOrDisplayedTitle &&
      !comparableTextMatches(rootTitle, ngsOrDisplayedTitle)
  );
  const artistMismatch = Boolean(
    !rootTitle &&
      !ngsOrDisplayedTitle &&
      rootArtist &&
      ngsOrDisplayedArtist &&
      !comparableTextMatches(rootArtist, ngsOrDisplayedArtist)
  );
  const generatedCaption = getGeneratedCaptionText(artwork);
  const captionReportsMismatch = Boolean(
    generatedCaption &&
      /verified facts provided .* not related to the visual content/i.test(
        generatedCaption
      )
  );

  return titleMismatch || artistMismatch || captionReportsMismatch;
};

const shouldSuppressRootsRecord = (artwork: PublicArtwork) =>
  hasRootsSourceRecord(artwork) && hasPublicSourceMismatch(artwork);

const shouldPreferRootsRecord = (artwork: PublicArtwork) =>
  hasRootsSourceRecord(artwork) &&
  !hasNgsSourceRecord(artwork) &&
  !hasPublicSourceMismatch(artwork);

export const getPublicTitle = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const rootsTitle = shouldSuppressRootsRecord(artwork)
    ? null
    : getRootsRecordTitle(artwork);
  const ngsTitle = getNgsRecordTitle(artwork);

  if (shouldPreferRootsRecord(artwork)) {
    return (
      rootsTitle ||
      firstPublicCatalogueText(artwork.title, meta.title) ||
      'Untitled'
    );
  }

  return (
    firstPublicCatalogueText(artwork.title, meta.title, ngsTitle, rootsTitle) ||
    'Untitled'
  );
};

export const getPublicArtist = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const rootsArtist = shouldSuppressRootsRecord(artwork)
    ? null
    : getRootsRecordArtist(artwork);
  const ngsArtist = getNgsRecordArtist(artwork);

  if (shouldPreferRootsRecord(artwork)) {
    return rootsArtist || null;
  }

  return firstPublicCatalogueText(
    artwork.artist,
    meta.artist,
    ngsArtist,
    rootsArtist
  );
};

const getRootsRecordText = (artwork: PublicArtwork, ...keys: string[]) => {
  const sourceRecords = getSourceRecords(artwork);
  const rootsRecord = asRecord(sourceRecords.roots);

  return firstPublicCatalogueText(...keys.map((key) => rootsRecord[key]));
};

const getRootsMaterialText = (artwork: PublicArtwork) =>
  getRootsRecordText(
    artwork,
    'material',
    'materials_name',
    'materialsName',
    'metadata_material_0',
    'metadata_material_1',
    'Material'
  );

const getRootsTechniqueText = (artwork: PublicArtwork) =>
  getRootsRecordText(
    artwork,
    'technique',
    'techniques_name',
    'techniquesName',
    'metadata_technique_0',
    'metadata_technique_1',
    'Technique'
  );

const getRootsObjectTypeText = (artwork: PublicArtwork) =>
  getRootsRecordText(
    artwork,
    'object_type',
    'objectType',
    'object_work_type',
    'objectWorkType',
    'categories',
    'category',
    'nlb_type',
    'Object Type'
  );

const getRootsCollectionText = (artwork: PublicArtwork) =>
  getRootsRecordText(
    artwork,
    'collection_of',
    'collectionOf',
    'collection',
    'Collection of'
  );

const getRawRootsUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return firstMatchingText(
    isRootsUrl,
    artwork.source_url,
    meta.sourceUrl,
    meta.source_url,
    meta.roots_listing_url,
    meta.rootsListingUrl,
    sourceRecords.roots_listing_url,
    sourceRecords.rootsListingUrl
  );
};

export const getRootsUrl = (artwork: PublicArtwork) =>
  shouldSuppressRootsRecord(artwork) ? null : getRawRootsUrl(artwork);

export const getNgsUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return firstMatchingText(
    isNgsUrl,
    artwork.source_url,
    meta.ngs_detail_url,
    meta.ngsDetailUrl,
    meta.sourceUrl,
    meta.source_url,
    sourceRecords.ngs_detail_url,
    sourceRecords.ngsDetailUrl
  );
};

export const getPublicDescriptionDetails = (
  artwork: PublicArtwork
): PublicDescriptionDetails | null => {
  return firstPublicCatalogueDetails(...getPublicDescriptionGroups(artwork));
};

export const getPublicDescriptionDetailList = (
  artwork: PublicArtwork
): PublicDescriptionDetails[] =>
  publicCatalogueDetailsFromGroups(getPublicDescriptionGroups(artwork));

const getPublicDescriptionGroups = (
  artwork: PublicArtwork
): PublicDescriptionGroup[] => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const rootsRecord = asRecord(sourceRecords.roots);
  const fieldSources = getPublicFieldSources(artwork);
  const metadataTextSource = getFieldSourceLabel(
    fieldSources,
    'description',
    'catalogue_description',
    'catalogueDescription',
    'catalogue_text',
    'catalogueText',
    'source_description',
    'sourceDescription',
    'source_caption',
    'sourceCaption',
    'label_text',
    'labelText'
  );
  const metadataCaptionSource = getFieldSourceLabel(fieldSources, 'caption');
  const metadataTextIsRoots = metadataTextSource === ROOTS_SOURCE_LABEL;
  const metadataCaptionIsRoots = metadataCaptionSource === ROOTS_SOURCE_LABEL;
  const suppressRoots = shouldSuppressRootsRecord(artwork);
  const allowRootsCaption =
    !suppressRoots ||
    ((metadataTextIsRoots || metadataCaptionIsRoots) &&
      rootsRecordMatchesAccession(artwork));
  const rootsGroup = {
    source: 'roots' as const,
    sourceLabel: ROOTS_SOURCE_LABEL,
    values: allowRootsCaption
      ? [
          rootsRecord.caption,
          rootsRecord.description,
          rootsRecord.summary,
          rootsRecord.synopsis,
          rootsRecord.content,
          rootsRecord.text,
        ]
      : [],
  };
  const metadataTextValues = [
    artwork.description,
    meta.description,
    meta.catalogue_description,
    meta.catalogueDescription,
    meta.catalogue_text,
    meta.catalogueText,
    meta.source_description,
    meta.sourceDescription,
    meta.source_caption,
    meta.sourceCaption,
    meta.label_text,
    meta.labelText,
  ];
  const metadataGroup = {
    source: 'metadata' as const,
    sourceLabel: asFromSourceLabel(metadataTextSource || METADATA_SOURCE_LABEL),
    values: allowRootsCaption && metadataTextIsRoots ? metadataTextValues : [],
  };
  const metadataCaptionGroup = {
    source: 'metadata' as const,
    sourceLabel: asFromSourceLabel(
      metadataCaptionSource || METADATA_SOURCE_LABEL
    ),
    values: allowRootsCaption && metadataCaptionIsRoots ? [meta.caption] : [],
  };

  if (suppressRoots && !allowRootsCaption) {
    return [];
  }

  if (shouldPreferRootsRecord(artwork)) {
    return [rootsGroup, metadataGroup, metadataCaptionGroup];
  }

  if (metadataTextIsRoots) {
    return [rootsGroup, metadataGroup, metadataCaptionGroup];
  }

  return [rootsGroup, metadataGroup, metadataCaptionGroup];
};

export const getPublicDescription = (artwork: PublicArtwork) =>
  getPublicDescriptionDetails(artwork)?.text ?? null;

export const getPublicAccession = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return firstPublicText(
    artwork.accession_number,
    meta.accessionNumber,
    meta.accession_number
  );
};

export const getGeographicAssociation = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  if (shouldPreferRootsRecord(artwork)) {
    const rootsRegion = getRootsRecordText(
      artwork,
      'region',
      'associated_place',
      'associatedPlace',
      'creation_place_original_location',
      'creationPlaceOriginalLocation',
      'Region'
    );

    if (rootsRegion) return rootsRegion;
  }

  return firstText(
    artwork.geographic_association,
    artwork.geographicAssociation,
    artwork.geographical_association,
    artwork.geographicalAssociation,
    meta.geographic_association,
    meta.geographicAssociation,
    meta.geographical_association,
    meta.geographicalAssociation,
    meta.associated_place,
    meta.associatedPlace,
    meta.associated_country,
    meta.associatedCountry,
    meta.creation_place_original_location,
    meta.creationPlaceOriginalLocation,
    meta.documents_0_metadata_creation_place_original_location,
    ngsRecord.objAssociatedPlaceTxt,
    artwork.origin,
    meta.origin
  );
};

type PublicMetadataRowCandidate = {
  label: string;
  value: unknown;
  sourceLabel?: string | null;
};

const toPublicMetadataRows = (
  rows: PublicMetadataRowCandidate[],
  fallbackSourceLabel: string
): PublicMetadataRow[] =>
  rows
    .map(({ label, value, sourceLabel }) => ({
      label,
      value: String(value ?? '').trim(),
      sourceLabel: sourceLabel || fallbackSourceLabel,
    }))
    .filter((row) => row.value.length > 0);

const getInferredCatalogueSourceLabel = (artwork: PublicArtwork) => {
  const fieldSources = getPublicFieldSources(artwork);

  return (
    (shouldSuppressRootsRecord(artwork) ? NGS_SOURCE_LABEL : null) ||
    getFieldSourceLabel(fieldSources, 'title') ||
    (getNgsUrl(artwork)
      ? NGS_SOURCE_LABEL
      : getRootsUrl(artwork)
        ? ROOTS_SOURCE_LABEL
        : METADATA_SOURCE_LABEL)
  );
};

const getPublicImageBackfill = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return asParsedRecord(
    meta.image_backfill ||
      meta.imageBackfill ||
      artwork.image_backfill ||
      artwork.imageBackfill
  );
};

const getPublicImageSourceRow = (
  artwork: PublicArtwork
): PublicMetadataRowCandidate | null => {
  const backfill = getPublicImageBackfill(artwork);
  const source = asText(backfill.source);
  if (!source) return null;

  const selectedKind = asText(backfill.selected_kind || backfill.selectedKind);
  const selectedSource = asText(
    backfill.selected_source || backfill.selectedSource
  );

  if (source === 'ngs_dam_rendition') {
    const isExtracted =
      selectedKind === 'extracted' || /sam3|crop/i.test(selectedSource || '');

    return {
      label: 'Image source',
      value: isExtracted
        ? 'NGS DAM rendition, extracted artwork crop'
        : 'NGS DAM rendition',
      sourceLabel: NGS_SOURCE_LABEL,
    };
  }

  if (source === 'ngs_remaining_sam3_human_review') {
    return {
      label: 'Image source',
      value: 'Human-reviewed crop from NGS image',
      sourceLabel: NGS_SOURCE_LABEL,
    };
  }

  const sourceProvider = firstText(
    backfill.source_provider,
    backfill.sourceProvider,
    backfill.provider
  );
  if (/web_image|external|legacy/i.test(source) && sourceProvider) {
    return {
      label: 'Image source',
      value: `${sourceProvider} web image`,
      sourceLabel: METADATA_SOURCE_LABEL,
    };
  }

  return null;
};

const getNgsCatalogueRows = (
  artwork: PublicArtwork,
  fallbackSourceLabel: string
) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);
  const fieldSources = getPublicFieldSources(artwork);
  const sourceLabel =
    hasNgsSourceRecord(artwork) || fallbackSourceLabel === NGS_SOURCE_LABEL
      ? NGS_SOURCE_LABEL
      : fallbackSourceLabel;
  const dateText = firstText(artwork.date_text, meta.dateText, meta.date_text);
  const year =
    typeof artwork.year === 'number' ? artwork.year : Number(meta.year);
  const dimensionsText = firstPublicCatalogueText(
    getFirstDimensionSummary(ngsRecord.objDim2DGrp),
    getFirstDimensionSummary(ngsRecord.objDim3DGrp),
    cleanDimensionText(meta.dimensions_text),
    cleanDimensionText(meta.dimensionsText),
    cleanDimensionText(meta.published_dimension),
    cleanDimensionText(meta.publishedDimension),
    formatDimensions(artwork.dimensions)
  );
  const rows: PublicMetadataRowCandidate[] = [
    {
      label: 'Title',
      value: firstPublicCatalogueText(
        artwork.title,
        meta.title,
        getNgsRecordTitle(artwork)
      ),
      sourceLabel: getFieldSourceLabel(fieldSources, 'title') || sourceLabel,
    },
    {
      label: 'Artist',
      value: firstPublicCatalogueText(
        artwork.artist,
        meta.artist,
        getNgsRecordArtist(artwork)
      ),
      sourceLabel: getFieldSourceLabel(fieldSources, 'artist') || sourceLabel,
    },
    {
      label: 'Date',
      value:
        dateText && !isMalformedDateText(dateText)
          ? dateText
          : Number.isFinite(year) && year >= 1000 && year <= 9999
            ? String(year)
            : null,
      sourceLabel:
        getFieldSourceLabel(fieldSources, 'date_text', 'dateText') ||
        sourceLabel,
    },
    {
      label: 'Medium',
      value: firstPublicCatalogueText(
        artwork.medium,
        meta.medium,
        ngsRecord.objMaterialTechniqueTxt
      ),
      sourceLabel: getFieldSourceLabel(fieldSources, 'medium') || sourceLabel,
    },
    {
      label: 'Geographic association',
      value: firstText(
        artwork.geographic_association,
        artwork.geographicAssociation,
        artwork.geographical_association,
        artwork.geographicalAssociation,
        meta.geographic_association,
        meta.geographicAssociation,
        meta.geographical_association,
        meta.geographicalAssociation,
        meta.associated_place,
        meta.associatedPlace,
        meta.associated_country,
        meta.associatedCountry,
        meta.creation_place_original_location,
        meta.creationPlaceOriginalLocation,
        meta.documents_0_metadata_creation_place_original_location,
        ngsRecord.objAssociatedPlaceTxt,
        artwork.origin,
        meta.origin
      ),
      sourceLabel:
        getFieldSourceLabel(
          fieldSources,
          'geographic_association',
          'geographicAssociation',
          'geographical_association',
          'geographicalAssociation',
          'associated_place',
          'associatedPlace',
          'creation_place_original_location',
          'creationPlaceOriginalLocation'
        ) || sourceLabel,
    },
    {
      label: 'Dimensions',
      value: dimensionsText,
      sourceLabel:
        getFieldSourceLabel(
          fieldSources,
          'dimensions',
          'dimensions_text',
          'dimensionsText',
          'published_dimension',
          'publishedDimension'
        ) || sourceLabel,
    },
    {
      label: 'Accession',
      value: getPublicAccession(artwork),
      sourceLabel:
        getFieldSourceLabel(
          fieldSources,
          'accession_number',
          'accessionNumber'
        ) || sourceLabel,
    },
    {
      label: 'Credit line',
      value: firstPublicCatalogueText(
        artwork.credit_line,
        meta.creditLine,
        meta.credit_line
      ),
      sourceLabel:
        getFieldSourceLabel(fieldSources, 'credit_line', 'creditLine') ||
        sourceLabel,
    },
  ];
  const imageSourceRow = getPublicImageSourceRow(artwork);
  if (imageSourceRow) rows.push(imageSourceRow);

  return toPublicMetadataRows(rows, sourceLabel);
};

const getRootsCatalogueRows = (artwork: PublicArtwork) => {
  const rootsYearPeriod = getRootsRecordText(
    artwork,
    'yearPeriod',
    'year_period',
    'date_period',
    'metadata_year_period_0',
    'date',
    'creation_date',
    'creationDate'
  );
  const rootsDimension = cleanDimensionText(
    getRootsRecordText(
      artwork,
      'dimension',
      'dimensions',
      'dimension_text',
      'dimensionText',
      'published_dimension',
      'publishedDimension',
      'metadata_dimension',
      'metadata_dimension_0',
      'Dimension'
    )
  );
  const rows: PublicMetadataRowCandidate[] = [
    {
      label: 'Title',
      value: getRootsRecordTitle(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Creator',
      value: getRootsRecordArtist(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Year/Period',
      value: rootsYearPeriod,
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Region',
      value: getRootsRecordText(
        artwork,
        'region',
        'associated_place',
        'associatedPlace',
        'creation_place_original_location',
        'creationPlaceOriginalLocation',
        'Region'
      ),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Object type',
      value: getRootsObjectTypeText(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Material',
      value: getRootsMaterialText(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Technique',
      value: getRootsTechniqueText(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Dimension',
      value: rootsDimension,
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Accession',
      value:
        getRootsRecordText(
          artwork,
          'accession',
          'accession_number',
          'accessionNumber',
          'object_number',
          'objectNumber'
        ) || getPublicAccession(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
    {
      label: 'Collection of',
      value: getRootsCollectionText(artwork),
      sourceLabel: ROOTS_SOURCE_LABEL,
    },
  ];

  return toPublicMetadataRows(rows, ROOTS_SOURCE_LABEL);
};

const getCatalogueGroupId = (
  sourceLabel: string
): PublicMetadataGroup['id'] => {
  if (sourceLabel === NGS_SOURCE_LABEL) return 'ngs';
  if (sourceLabel === ROOTS_SOURCE_LABEL) return 'roots';
  return 'metadata';
};

const getCatalogueGroupLabel = (sourceLabel: string) => {
  if (sourceLabel === NGS_SOURCE_LABEL) return 'NGS';
  if (sourceLabel === ROOTS_SOURCE_LABEL) return 'Roots';
  return 'Metadata';
};

export const getPublicCatalogueRowGroups = (
  artwork: PublicArtwork
): PublicMetadataGroup[] => {
  const inferredSourceLabel = getInferredCatalogueSourceLabel(artwork);
  const ngsRows = getNgsCatalogueRows(artwork, inferredSourceLabel);
  const ngsSourceLabel =
    getPublicRecordSourceLabel(getDominantSourceLabel(ngsRows)) ||
    inferredSourceLabel;
  const canShowRootsGroup =
    hasRootsSourceRecord(artwork) && !shouldSuppressRootsRecord(artwork);
  const groups: PublicMetadataGroup[] = [];

  if (
    ngsRows.length > 0 &&
    !(ngsSourceLabel === ROOTS_SOURCE_LABEL && canShowRootsGroup)
  ) {
    groups.push({
      id: getCatalogueGroupId(ngsSourceLabel),
      label: getCatalogueGroupLabel(ngsSourceLabel),
      sourceLabel: ngsSourceLabel,
      rows: ngsRows,
    });
  }

  if (canShowRootsGroup) {
    const rootsRows = getRootsCatalogueRows(artwork);
    if (rootsRows.length > 0) {
      groups.push({
        id: 'roots',
        label: 'Roots',
        sourceLabel: ROOTS_SOURCE_LABEL,
        rows: rootsRows,
      });
    }
  }

  if (
    shouldPreferRootsRecord(artwork) &&
    !hasAccessionMatchedTitleVariant(artwork)
  ) {
    groups.sort((left, right) => {
      if (left.id === 'roots') return -1;
      if (right.id === 'roots') return 1;
      return 0;
    });
  }

  return groups;
};

export const getPublicCatalogueRows = (
  artwork: PublicArtwork
): PublicMetadataRow[] => {
  const meta = getPublicMetadata(artwork);
  const fieldSources = getPublicFieldSources(artwork);
  const inferredRecordSource = getInferredCatalogueSourceLabel(artwork);

  if (shouldPreferRootsRecord(artwork)) {
    const rootsYearPeriod = getRootsRecordText(
      artwork,
      'yearPeriod',
      'year_period',
      'date_period',
      'metadata_year_period_0',
      'date',
      'creation_date',
      'creationDate'
    );
    const rootsMaterial = getRootsMaterialText(artwork);
    const rootsDimension = getRootsRecordText(
      artwork,
      'dimension',
      'dimensions',
      'metadata_dimension',
      'metadata_dimension_0'
    );
    const rows: Array<{
      label: string;
      value: unknown;
      sourceLabel?: string | null;
    }> = [
      {
        label: 'Creator',
        value: getPublicArtist(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Year/Period',
        value: rootsYearPeriod || getPublicDateText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Region',
        value: getGeographicAssociation(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Object type',
        value: getRootsObjectTypeText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Material',
        value: rootsMaterial || getPublicMediumText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Technique',
        value: getRootsTechniqueText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Dimension',
        value: rootsDimension || getPublicDimensionsText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Accession',
        value: getPublicAccession(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
      {
        label: 'Collection of',
        value: getRootsCollectionText(artwork),
        sourceLabel: ROOTS_SOURCE_LABEL,
      },
    ];
    const imageSourceRow = getPublicImageSourceRow(artwork);
    if (imageSourceRow) rows.push(imageSourceRow);

    return rows
      .map(({ label, value, sourceLabel }) => ({
        label,
        value: String(value ?? '').trim(),
        sourceLabel: sourceLabel || ROOTS_SOURCE_LABEL,
      }))
      .filter((row) => row.value.length > 0);
  }

  const rows: Array<{
    label: string;
    value: unknown;
    sourceLabel?: string | null;
  }> = [
    {
      label: 'Artist',
      value: artwork.artist,
      sourceLabel: getFieldSourceLabel(fieldSources, 'artist'),
    },
    {
      label: 'Date',
      value: getPublicDateText(artwork),
      sourceLabel: getFieldSourceLabel(fieldSources, 'date_text', 'dateText'),
    },
    {
      label: 'Medium',
      value: getPublicMediumText(artwork),
      sourceLabel: getFieldSourceLabel(fieldSources, 'medium'),
    },
    {
      label: 'Geographic association',
      value: getGeographicAssociation(artwork),
      sourceLabel: getFieldSourceLabel(
        fieldSources,
        'geographic_association',
        'geographicAssociation',
        'geographical_association',
        'geographicalAssociation',
        'associated_place',
        'associatedPlace',
        'creation_place_original_location',
        'creationPlaceOriginalLocation'
      ),
    },
    {
      label: 'Dimensions',
      value: getPublicDimensionsText(artwork),
      sourceLabel: getFieldSourceLabel(
        fieldSources,
        'dimensions',
        'dimensions_text',
        'dimensionsText',
        'published_dimension',
        'publishedDimension'
      ),
    },
    {
      label: 'Accession',
      value: getPublicAccession(artwork),
      sourceLabel: getFieldSourceLabel(
        fieldSources,
        'accession_number',
        'accessionNumber'
      ),
    },
    {
      label: 'Credit line',
      value: firstPublicCatalogueText(
        artwork.credit_line,
        meta.creditLine,
        meta.credit_line
      ),
      sourceLabel: getFieldSourceLabel(
        fieldSources,
        'credit_line',
        'creditLine'
      ),
    },
  ];
  const imageSourceRow = getPublicImageSourceRow(artwork);
  if (imageSourceRow) rows.push(imageSourceRow);

  return rows
    .map(({ label, value, sourceLabel }) => ({
      label,
      value: String(value ?? '').trim(),
      sourceLabel: sourceLabel || inferredRecordSource,
    }))
    .filter((row) => row.value.length > 0);
};

export const getDominantSourceLabel = (rows: PublicMetadataRow[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.sourceLabel, (counts.get(row.sourceLabel) || 0) + 1);
  }

  let dominant: string | null = null;
  let dominantCount = 0;
  for (const [sourceLabel, count] of counts) {
    if (count > dominantCount) {
      dominant = sourceLabel;
      dominantCount = count;
    }
  }

  return dominant;
};

export const getPublicRecordSourceLabel = (sourceLabel?: string | null) => {
  const label = formatSourceLabel(sourceLabel);
  return label === NGS_SOURCE_LABEL || label === ROOTS_SOURCE_LABEL
    ? label
    : null;
};
