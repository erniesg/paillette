import type { Artwork, ArtworkSearchResult } from '~/types';
import { formatDimensions } from '~/lib/utils';

type PublicArtwork = Partial<Artwork & ArtworkSearchResult> &
  Record<string, any>;

export type PublicMetadataRow = {
  label: string;
  value: string;
};

export type PublicDescriptionDetails = {
  text: string;
  source: 'ngs' | 'roots' | 'metadata';
  sourceLabel: string;
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

  return firstPublicCatalogueDetails(
    {
      source: 'ngs',
      sourceLabel: 'National Gallery Singapore source fields',
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
      sourceLabel: 'NHB Roots source fields',
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
      sourceLabel: 'Public catalogue metadata',
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
  const rows: Array<[string, unknown]> = [
    ['Artist', artwork.artist],
    ['Date', getPublicDateText(artwork)],
    ['Medium', artwork.medium || meta.medium],
    ['Classification', artwork.classification || meta.classification],
    ['Culture', artwork.culture || meta.culture],
    ['Geographic association', getGeographicAssociation(artwork)],
    [
      'Dimensions',
      meta.dimensions_text ||
        meta.dimensionsText ||
        meta.published_dimension ||
        meta.publishedDimension ||
        formatDimensions(artwork.dimensions),
    ],
    ['Accession', getPublicAccession(artwork)],
    [
      'Credit line',
      firstPublicCatalogueText(
        artwork.credit_line,
        meta.creditLine,
        meta.credit_line
      ),
    ],
    [
      'Source institution',
      artwork.source_institution ||
        meta.sourceInstitution ||
        meta.source_institution,
    ],
    [
      'Source collection',
      artwork.source_collection ||
        meta.sourceCollection ||
        meta.source_collection,
    ],
  ];

  return rows
    .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
    .filter((row) => row.value.length > 0);
};
