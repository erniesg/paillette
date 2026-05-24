import type { Artwork, ArtworkSearchResult } from '~/types';
import { formatDimensions } from '~/lib/utils';

type PublicArtwork = Partial<Artwork & ArtworkSearchResult> &
  Record<string, any>;

export type PublicMetadataRow = {
  label: string;
  value: string;
  sourceLabel: string;
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

export const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

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

  return null;
};

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

const firstPublicCatalogueDetails = (
  ...groups: Array<{
    source: PublicDescriptionDetails['source'];
    sourceLabel: string;
    values: unknown[];
  }>
): PublicDescriptionDetails | null => {
  for (const group of groups) {
    const text = firstPublicCatalogueText(...group.values);
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

export const getPublicMetadata = (artwork: PublicArtwork) =>
  asRecord(artwork.custom_metadata || artwork.metadata);

export const getPublicImageUrl = (artwork: PublicArtwork) =>
  firstText(
    artwork.imageUrl,
    artwork.image_url,
    artwork.thumbnailUrl,
    artwork.thumbnail_url
  );

export const getPublicThumbnailUrl = (artwork: PublicArtwork) =>
  firstText(
    artwork.thumbnailUrl,
    artwork.thumbnail_url,
    artwork.imageUrl,
    artwork.image_url
  );

const getPublicMediumText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  return firstPublicCatalogueText(
    artwork.medium,
    meta.medium,
    ngsRecord.objMaterialTechniqueTxt
  );
};

const getFirstDimensionSummary = (groups: unknown) => {
  if (!Array.isArray(groups)) return null;

  for (const group of groups) {
    const record = asRecord(group);
    const summary = firstPublicCatalogueText(record.summary);
    if (summary) return summary;
  }

  return null;
};

export const getPublicDimensionsText = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);

  return firstPublicCatalogueText(
    meta.dimensions_text,
    meta.dimensionsText,
    meta.published_dimension,
    meta.publishedDimension,
    getFirstDimensionSummary(ngsRecord.objDim2DGrp),
    getFirstDimensionSummary(ngsRecord.objDim3DGrp),
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
  const meta = getPublicMetadata(artwork);
  const artist = trimCitationPart(
    firstPublicCatalogueText(artwork.artist, meta.artist)
  ) || 'Unknown artist';
  const title = trimCitationPart(
    firstPublicCatalogueText(artwork.title, meta.title)
  ) || 'Untitled';
  const date = trimCitationPart(getPublicDateText(artwork)) || 'n.d.';
  const medium = trimCitationPart(getPublicMediumText(artwork));
  const dimensions = trimCitationPart(
    normalizeCitationDimension(getPublicDimensionsText(artwork))
  );
  const institution = trimCitationPart(getCitationInstitution(artwork));

  const physical = [medium, dimensions].filter(Boolean).join(', ');
  const parts = [
    artist,
    title,
    date,
    physical || null,
    institution,
  ].filter((part): part is string => Boolean(part));

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

  if (typeof caption === 'string') return caption.trim() || null;
  return asText(getGeneratedCaptionRecord(artwork).text);
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

export const getRootsUrl = (artwork: PublicArtwork) => {
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
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const ngsRecord = asRecord(sourceRecords.ngs);
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
    'labelText',
    'caption'
  );

  return firstPublicCatalogueDetails(
    {
      source: 'ngs',
      sourceLabel: NGS_SOURCE_LABEL,
      values: [
        ngsRecord.objDescriptionClb,
        ngsRecord.ocspWebText,
        ngsRecord.description,
        ngsRecord.caption,
        ngsRecord.summary,
        ngsRecord.labelText,
        ngsRecord.label_text,
        ngsRecord.text,
      ],
    },
    {
      source: 'roots',
      sourceLabel: ROOTS_SOURCE_LABEL,
      values: [
        rootsRecord.description,
        rootsRecord.caption,
        rootsRecord.summary,
        rootsRecord.synopsis,
        rootsRecord.content,
        rootsRecord.text,
      ],
    },
    {
      source: 'metadata',
      sourceLabel: asFromSourceLabel(
        metadataTextSource || METADATA_SOURCE_LABEL
      ),
      values: [
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
        meta.caption,
      ],
    }
  );
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

export const getPublicCatalogueRows = (
  artwork: PublicArtwork
): PublicMetadataRow[] => {
  const meta = getPublicMetadata(artwork);
  const fieldSources = getPublicFieldSources(artwork);
  const inferredRecordSource =
    getFieldSourceLabel(fieldSources, 'title') ||
    (getNgsUrl(artwork)
      ? NGS_SOURCE_LABEL
      : getRootsUrl(artwork)
        ? ROOTS_SOURCE_LABEL
        : METADATA_SOURCE_LABEL);
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
