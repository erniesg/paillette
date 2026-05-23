import type { Artwork, ArtworkSearchResult } from '~/types';
import { formatDimensions } from '~/lib/utils';

type PublicArtwork = Partial<Artwork & ArtworkSearchResult> & Record<string, any>;

export type PublicMetadataRow = {
  label: string;
  value: string;
};

export const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
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
  firstText(artwork.thumbnailUrl, artwork.thumbnail_url, artwork.imageUrl, artwork.image_url);

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

export const getSourceRecords = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return asRecord(meta.source_records || meta.sourceRecords);
};

export const getRootsUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return firstText(
    meta.roots_listing_url,
    meta.rootsListingUrl,
    sourceRecords.roots_listing_url,
    sourceRecords.rootsListingUrl
  );
};

export const getNgsUrl = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return firstText(
    artwork.source_url,
    meta.ngs_detail_url,
    meta.ngsDetailUrl,
    meta.sourceUrl,
    meta.source_url,
    sourceRecords.ngs_detail_url,
    sourceRecords.ngsDetailUrl
  );
};

export const getPublicDescription = (artwork: PublicArtwork) => {
  const meta = getPublicMetadata(artwork);
  return firstText(artwork.description, meta.description, meta.catalogue_description);
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

export const getPublicCatalogueRows = (artwork: PublicArtwork): PublicMetadataRow[] => {
  const meta = getPublicMetadata(artwork);
  const rows: Array<[string, unknown]> = [
    ['Artist', artwork.artist],
    ['Date', artwork.date_text || meta.dateText || meta.date_text || artwork.year],
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
    ['Accession', artwork.accession_number || meta.accessionNumber || meta.accession_number],
    ['Credit line', artwork.credit_line || meta.creditLine || meta.credit_line],
    [
      'Source institution',
      artwork.source_institution || meta.sourceInstitution || meta.source_institution,
    ],
    ['Source collection', artwork.source_collection || meta.sourceCollection || meta.source_collection],
    ['Source record ID', artwork.source_record_id || meta.sourceRecordId || meta.source_record_id],
  ];

  return rows
    .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
    .filter((row) => row.value.length > 0);
};
