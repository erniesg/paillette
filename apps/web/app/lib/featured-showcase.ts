import type { ArtworkSearchResult } from '~/types';
import {
  CHUNG_CHENG_FEATURE_ACCESSION,
  CHUNG_CHENG_FEATURE_LABEL,
  CHUNG_CHENG_FEATURE_QUERY,
  type EvalSuggestion,
} from './search-suggestions';

const CHUNG_CHENG_ROOTS_URL =
  'https://www.roots.gov.sg/Collection-Landing/listing/1454646';
const CHUNG_CHENG_NGS_URL =
  'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/yeo-hwee-bin/2019/2019-00754_cropped.tif.html';
export const CHUNG_CHENG_ROOTS_IMAGE_URL =
  'https://www.roots.gov.sg/CollectionImages/1454646.jpg';
export const CHUNG_CHENG_STATUE_MASK_IMAGE_URL =
  'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/yeo-hwee-bin/2019/2019-00754_cropped.tif/_jcr_content/renditions/cq5dam.zoom.2048.2048.jpeg';

export const isChungChengFeatureSuggestion = (
  suggestion: EvalSuggestion | null | undefined
) => suggestion?.query === CHUNG_CHENG_FEATURE_QUERY;

const normalizeMatchText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKC');

const getArtworkMatchText = (artwork: ArtworkSearchResult) => {
  const metadata = artwork.metadata || {};
  return [
    artwork.id,
    artwork.title,
    metadata.title,
    metadata.accessionNumber,
    metadata.accession_number,
    metadata.sourceRecordId,
    metadata.source_record_id,
  ]
    .map(normalizeMatchText)
    .join(' ');
};

export const isChungChengArtwork = (artwork: ArtworkSearchResult) => {
  const matchText = getArtworkMatchText(artwork);
  return (
    matchText.includes(CHUNG_CHENG_FEATURE_ACCESSION.toLowerCase()) ||
    matchText.includes('zhong zheng ren') ||
    matchText.includes('中正人')
  );
};

export const CHUNG_CHENG_FEATURED_ARTWORK: ArtworkSearchResult = {
  id: CHUNG_CHENG_FEATURE_ACCESSION,
  galleryId: 'ngs',
  orgId: 'ngs',
  title: CHUNG_CHENG_FEATURE_LABEL,
  artist: 'Yeo Hwee Bin',
  year: 1969,
  imageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
  thumbnailUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
  similarity: 1,
  metadata: {
    accessionNumber: CHUNG_CHENG_FEATURE_ACCESSION,
    dateText: '1969',
    medium: 'Stone',
    classification: 'sculpture (visual works)',
    dimensions: {
      height: 251,
      width: 90,
      depth: 52,
      unit: 'cm',
    },
    geographic_association: 'Singapore',
    creditLine:
      'Gift of Chung Cheng High School (Main). Collection of National Gallery Singapore.',
    description:
      'Yeo Hwee Bin made this upright, hollow-centred sculpture for Chung Cheng High School (Main). The form evokes the character 中, using the figure as a reminder of grounded values, learning, leadership, and service.',
    rootsListingUrl: CHUNG_CHENG_ROOTS_URL,
    rootsImageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    maskImageUrl: CHUNG_CHENG_STATUE_MASK_IMAGE_URL,
    ngsDetailUrl: CHUNG_CHENG_NGS_URL,
    source_records: {
      roots_listing_url: CHUNG_CHENG_ROOTS_URL,
      roots_image_url: CHUNG_CHENG_ROOTS_IMAGE_URL,
      ngs_detail_url: CHUNG_CHENG_NGS_URL,
      roots: {
        title: CHUNG_CHENG_FEATURE_LABEL,
        creator: 'Yeo Hwee Bin',
        accession: CHUNG_CHENG_FEATURE_ACCESSION,
        yearPeriod: '1969',
        region: 'Singapore',
        objectType: 'sculpture (visual works)',
        material: 'cement, concrete',
        technique: 'stone-working, casting (process)',
        dimensions:
          'Object size: 251.0 x 90.0 x 52.0 cm; 265.0 cm height after construction of cement base',
        collectionOf: 'National Gallery Singapore',
        creditLine: 'Gift of Chung Cheng High School (Main)',
        caption:
          'Yeo Hwee Bin made this work for Chung Cheng High School (Main). Its hollow centre signifies the Chinese character 中 and points to the school values associated with learning, leadership, and service.',
      },
      ngs: {
        objObjectTitleTxt: CHUNG_CHENG_FEATURE_LABEL,
        artistAvailableNames: ['Yeo Hwee Bin'],
        objObjectNumberTxt: CHUNG_CHENG_FEATURE_ACCESSION,
        objDateDatingTxt: '1969',
        objMaterialTechniqueTxt: 'Stone',
        objAssociatedPlaceTxt: 'Singapore',
        objCreditLineTxt:
          'Gift of Chung Cheng High School (Main). Collection of National Gallery Singapore.',
      },
    },
    fieldSources: {
      description: 'roots',
      medium: 'ngs_artplus_catalog',
      dimensions: 'roots',
      creditLine: 'ngs',
    },
  },
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const getChungChengImageMetadata = (
  metadata: ArtworkSearchResult['metadata']
) => {
  const fallbackMetadata = asRecord(CHUNG_CHENG_FEATURED_ARTWORK.metadata);
  const existingMetadata = asRecord(metadata);
  const fallbackSourceRecords = asRecord(fallbackMetadata.source_records);
  const existingSourceRecords = asRecord(
    existingMetadata.source_records || existingMetadata.sourceRecords
  );
  const fallbackRootsRecord = asRecord(fallbackSourceRecords.roots);
  const existingRootsRecord = asRecord(existingSourceRecords.roots);

  return {
    ...fallbackMetadata,
    ...existingMetadata,
    rootsImageUrl:
      existingMetadata.rootsImageUrl ||
      existingMetadata.roots_image_url ||
      CHUNG_CHENG_ROOTS_IMAGE_URL,
    roots_image_url:
      existingMetadata.roots_image_url ||
      existingMetadata.rootsImageUrl ||
      CHUNG_CHENG_ROOTS_IMAGE_URL,
    source_records: {
      ...fallbackSourceRecords,
      ...existingSourceRecords,
      roots: {
        ...fallbackRootsRecord,
        ...existingRootsRecord,
        imageUrl:
          existingRootsRecord.imageUrl ||
          existingRootsRecord.image_url ||
          CHUNG_CHENG_ROOTS_IMAGE_URL,
        thumbnailUrl:
          existingRootsRecord.thumbnailUrl ||
          existingRootsRecord.thumbnail_url ||
          CHUNG_CHENG_ROOTS_IMAGE_URL,
      },
    },
  };
};

export const getChungChengFeaturedArtwork = (
  artworks: ArtworkSearchResult[]
) => {
  const indexedArtwork = artworks.find(isChungChengArtwork);
  const artwork = indexedArtwork ?? CHUNG_CHENG_FEATURED_ARTWORK;

  return {
    ...CHUNG_CHENG_FEATURED_ARTWORK,
    ...artwork,
    imageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    thumbnailUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    metadata: getChungChengImageMetadata(artwork.metadata),
  };
};
