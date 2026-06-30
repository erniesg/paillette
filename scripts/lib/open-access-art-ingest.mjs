export const OPEN_ACCESS_ART_COLLECTION = {
  slug: 'open-access-art',
  name: 'Open Access Art',
  rightsLabel: 'Public Domain & CC0 Art',
};

export const OPEN_ACCESS_PROVIDERS = {
  met: {
    label: 'The Metropolitan Museum of Art',
    rights: 'Public Domain / CC0',
  },
  artic: {
    label: 'Art Institute of Chicago',
    rights: 'Public Domain / CC0',
  },
  cleveland: {
    label: 'Cleveland Museum of Art',
    rights: 'CC0',
  },
  nga: {
    label: 'National Gallery of Art, Washington',
    rights: 'Open Access / Public Domain',
  },
};

export const OPEN_ACCESS_PROVIDER_PRESETS = {
  pilot: ['artic', 'nga'],
  'full-v1': ['met', 'artic', 'cleveland', 'nga'],
};

const MET_SOURCE_COLLECTION = 'The Met Open Access';
const ARTIC_IMAGE_BASE = 'https://www.artic.edu/iiif/2';
const NGA_OBJECT_URL_BASE = 'https://www.nga.gov/collection/art-object-page';

const trimText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const optionalText = (value) => {
  const text = trimText(value);
  return text || null;
};

const optionalInt = (value) => {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) ? number : null;
};

const stripHtml = (value) =>
  optionalText(
    String(value ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );

const compactObject = (record) =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
  );

export function openAccessArtworkId(provider, sourceRecordId) {
  const sourceId = trimText(sourceRecordId);
  if (!sourceId) {
    throw new Error('sourceRecordId is required for open-access artwork ids');
  }
  return `${OPEN_ACCESS_ART_COLLECTION.slug}:${trimText(provider).toLowerCase()}:${sourceId}`;
}

function captionInfo(text, sourceField) {
  const normalized = optionalText(text);
  return {
    hasInstitutionCaption: Boolean(normalized),
    text: normalized,
    sourceField: normalized ? sourceField : null,
  };
}

function baseArtwork({
  provider,
  sourceRecordId,
  title,
  artist,
  year,
  dateText,
  medium,
  classification,
  culture,
  origin,
  dimensions,
  description,
  creditLine,
  accessionNumber,
  sourceUrl,
  sourceCollection,
  imageUrl,
  thumbnailUrl,
  caption,
  providerMetadata,
}) {
  const providerConfig = OPEN_ACCESS_PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported open-access provider: ${provider}`);
  }

  const id = openAccessArtworkId(provider, sourceRecordId);

  return {
    id,
    collection_id: OPEN_ACCESS_ART_COLLECTION.slug,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl || imageUrl,
    title: optionalText(title) || 'Untitled',
    artist: optionalText(artist),
    year: optionalInt(year),
    date_text: optionalText(dateText),
    medium: optionalText(medium),
    classification: optionalText(classification),
    culture: optionalText(culture),
    origin: optionalText(origin),
    dimensions_text: optionalText(dimensions),
    description: optionalText(description),
    credit_line: optionalText(creditLine),
    rights: providerConfig.rights,
    accession_number: optionalText(accessionNumber),
    source_url: optionalText(sourceUrl),
    source_institution: providerConfig.label,
    source_collection: optionalText(sourceCollection),
    source_record_id: trimText(sourceRecordId),
    field_sources: {
      title: provider,
      artist: provider,
      date_text: provider,
      medium: provider,
      description: caption?.sourceField ? provider : undefined,
      rights: provider,
      image_url: provider,
    },
    custom_metadata: compactObject({
      provider,
      providerRecordId: trimText(sourceRecordId),
      collectionSlug: OPEN_ACCESS_ART_COLLECTION.slug,
      rightsStatus: providerConfig.rights,
      imageUse: 'public_domain_or_cc0_source',
      ...providerMetadata,
    }),
    caption: caption || captionInfo(description, 'description'),
  };
}

export function normalizeMetArtwork(record) {
  if (!record?.isPublicDomain) return null;

  const imageUrl = optionalText(record.primaryImage) || optionalText(record.primaryImageSmall);
  if (!imageUrl || record.objectID === undefined || record.objectID === null) {
    return null;
  }

  const sourceRecordId = String(record.objectID);
  const caption = captionInfo(null, null);

  return baseArtwork({
    provider: 'met',
    sourceRecordId,
    title: record.title,
    artist: record.artistDisplayName,
    year: record.objectBeginDate,
    dateText: record.objectDate,
    medium: record.medium,
    classification: record.classification,
    culture: record.culture,
    origin: record.country || record.region || record.city,
    dimensions: record.dimensions,
    description: null,
    creditLine: record.creditLine,
    accessionNumber: record.accessionNumber,
    sourceUrl:
      record.objectURL ||
      `https://www.metmuseum.org/art/collection/search/${sourceRecordId}`,
    sourceCollection: record.department || MET_SOURCE_COLLECTION,
    imageUrl,
    thumbnailUrl: record.primaryImageSmall || imageUrl,
    caption,
    providerMetadata: compactObject({
      department: record.department,
      objectName: record.objectName,
      repository: record.repository,
      tags: Array.isArray(record.tags)
        ? record.tags.map((tag) => optionalText(tag?.term)).filter(Boolean)
        : undefined,
    }),
  });
}

export function normalizeArticArtwork(record) {
  if (record?.is_public_domain !== true) return null;

  const imageId = optionalText(record.image_id);
  if (!imageId || record.id === undefined || record.id === null) return null;

  const sourceRecordId = String(record.id);
  const description = stripHtml(record.description);
  const caption = captionInfo(description, 'description');

  return baseArtwork({
    provider: 'artic',
    sourceRecordId,
    title: record.title,
    artist: record.artist_title || record.artist_display,
    year: record.date_start,
    dateText: record.date_display,
    medium: record.medium_display,
    classification: record.classification_title,
    culture: record.culture,
    origin: record.place_of_origin,
    dimensions: record.dimensions,
    description,
    creditLine: record.credit_line,
    accessionNumber: record.main_reference_number,
    sourceUrl: `https://www.artic.edu/artworks/${sourceRecordId}`,
    sourceCollection: record.department_title || 'Open Access',
    imageUrl: `${ARTIC_IMAGE_BASE}/${imageId}/full/843,/0/default.jpg`,
    thumbnailUrl: `${ARTIC_IMAGE_BASE}/${imageId}/full/200,/0/default.jpg`,
    caption,
    providerMetadata: compactObject({
      imageId,
      apiLink: record.api_link,
      altText: record.thumbnail?.alt_text,
    }),
  });
}

const clevelandCreatorText = (record) => {
  if (Array.isArray(record.creators) && record.creators.length) {
    return record.creators
      .map((creator) => creator.description || creator.name)
      .filter(Boolean)
      .join('; ');
  }
  return record.creator || record.artist;
};

const clevelandCultureText = (record) => {
  if (Array.isArray(record.culture)) return record.culture.filter(Boolean).join('; ');
  return record.culture;
};

export function normalizeClevelandArtwork(record) {
  const sourceRecordId =
    record?.id === undefined || record?.id === null ? null : String(record.id);
  if (!sourceRecordId) return null;

  const imageUrl =
    optionalText(record.images?.print?.url) ||
    optionalText(record.image_print) ||
    optionalText(record.images?.web?.url) ||
    optionalText(record.image_web);
  const thumbnailUrl =
    optionalText(record.image_web) ||
    optionalText(record.images?.web?.url) ||
    imageUrl;
  const rights = trimText(record.share_license_status || record.share_license);

  if (!imageUrl || (rights && rights.toLowerCase() !== 'cc0')) return null;

  const description = optionalText(record.description);
  const caption = captionInfo(description || record.did_you_know, description ? 'description' : 'did_you_know');

  return baseArtwork({
    provider: 'cleveland',
    sourceRecordId,
    title: record.title,
    artist: clevelandCreatorText(record),
    year: record.creation_date_earliest,
    dateText: record.creation_date,
    medium: record.technique,
    classification: record.type,
    culture: clevelandCultureText(record),
    origin: record.current_location,
    dimensions: record.measurements,
    description: caption.text,
    creditLine: record.creditline,
    accessionNumber: record.accession_number,
    sourceUrl:
      record.url ||
      (record.accession_number
        ? `https://www.clevelandart.org/art/${record.accession_number}`
        : null),
    sourceCollection: record.department || record.collection || 'Open Access',
    imageUrl,
    thumbnailUrl,
    caption,
    providerMetadata: compactObject({
      apiUrl: record.url,
      license: rights || 'CC0',
      tombstone: record.tombstone,
    }),
  });
}

export function normalizeNgaArtwork({ object, image }) {
  if (String(image?.openaccess ?? '').trim() !== '1') return null;

  const sourceRecordId =
    optionalText(image?.depictstmsobjectid) || optionalText(object?.objectid);
  const iiifUrl = optionalText(image?.iiifurl);
  if (!sourceRecordId || !iiifUrl) return null;

  const description = optionalText(image.assistivetext);
  const caption = captionInfo(description, 'assistivetext');

  return baseArtwork({
    provider: 'nga',
    sourceRecordId,
    title: object?.title,
    artist: object?.attribution,
    year: object?.beginyear,
    dateText: object?.displaydate,
    medium: object?.medium,
    classification: object?.classification,
    culture: null,
    origin: null,
    dimensions: object?.dimensions,
    description,
    creditLine: object?.creditline,
    accessionNumber: object?.accessionnum,
    sourceUrl: `${NGA_OBJECT_URL_BASE}.${sourceRecordId}.html`,
    sourceCollection: object?.departmentabbr || 'Open Access',
    imageUrl: `${iiifUrl}/full/843,/0/default.jpg`,
    thumbnailUrl: image.iiifthumburl || `${iiifUrl}/full/200,/0/default.jpg`,
    caption,
    providerMetadata: compactObject({
      imageUuid: image.uuid,
      iiifUrl,
      viewType: image.viewtype,
      openAccess: true,
    }),
  });
}

export function summarizeCaptionCoverage(records) {
  const total = records.length;
  const withInstitutionCaption = records.filter(
    (record) => record?.caption?.hasInstitutionCaption === true
  ).length;

  return {
    total,
    withInstitutionCaption,
    missingInstitutionCaption: total - withInstitutionCaption,
  };
}

const gibibytesFromKilobytes = (kilobytes) => kilobytes / 1024 / 1024;
const paidAfterFree = (value, included) => Math.max(0, value - included);

export function estimateOpenAccessCosts({
  artworkCount,
  captionVectorCount = 0,
  monthlyVectorQueries = 100_000,
  thumbnailKilobytes = 100,
  webImageKilobytes = 500,
  jinaTilesPerImage = 1,
  d1RowsPerArtwork = 1,
  d1WriteMultiplier = 4,
} = {}) {
  const count = Math.max(0, Number(artworkCount || 0));
  const captionCount = Math.max(0, Number(captionVectorCount || 0));
  const imageVectorDimensions = 1024;
  const captionVectorDimensions = 768;
  const imageStoredDimensions = count * imageVectorDimensions;
  const captionStoredDimensions = captionCount * captionVectorDimensions;
  const totalStoredDimensions = imageStoredDimensions + captionStoredDimensions;
  const monthlyQueriedDimensions =
    (Math.max(0, Number(monthlyVectorQueries || 0)) + count) *
    imageVectorDimensions;
  const totalImageKilobytes =
    count * (Number(thumbnailKilobytes || 0) + Number(webImageKilobytes || 0));
  const totalGigabytes = gibibytesFromKilobytes(totalImageKilobytes);
  const d1Rows = count * Number(d1RowsPerArtwork || 1);
  const d1Writes = d1Rows * Number(d1WriteMultiplier || 1);
  const jinaTokensPerImage = 4000 * Math.max(1, Number(jinaTilesPerImage || 1));

  const vectorStoredMonthlyUsd =
    (paidAfterFree(totalStoredDimensions, 10_000_000) / 100_000_000) * 0.05;
  const vectorQueryMonthlyUsd =
    (paidAfterFree(monthlyQueriedDimensions, 50_000_000) / 1_000_000) * 0.01;
  const r2StorageMonthlyUsd = paidAfterFree(totalGigabytes, 10) * 0.015;
  const r2ClassAWriteUsd = (paidAfterFree(count * 2, 1_000_000) / 1_000_000) * 4.5;
  const d1WriteUsd = (paidAfterFree(d1Writes, 50_000_000) / 1_000_000) * 1;
  const d1StorageGigabytes = (d1Rows * 2) / 1024 / 1024;
  const d1StorageMonthlyUsd = paidAfterFree(d1StorageGigabytes, 5) * 0.75;

  return {
    assumptions: {
      artworkCount: count,
      captionVectorCount: captionCount,
      monthlyVectorQueries,
      thumbnailKilobytes,
      webImageKilobytes,
      jinaTilesPerImage,
      d1RowsPerArtwork,
      d1WriteMultiplier,
    },
    jina: {
      model: 'jina-clip-v2',
      tokensPerImage: jinaTokensPerImage,
      imageEmbeddingTokens: count * jinaTokensPerImage,
      note:
        'Local embeddings avoid this API token cost but still require local compute time.',
    },
    vectorize: {
      imageStoredDimensions,
      captionStoredDimensions,
      totalStoredDimensions,
      monthlyQueriedDimensions,
      estimatedStoredMonthlyUsd: vectorStoredMonthlyUsd,
      estimatedQueryMonthlyUsd: vectorQueryMonthlyUsd,
      estimatedMonthlyUsd: vectorStoredMonthlyUsd + vectorQueryMonthlyUsd,
    },
    r2: {
      totalGigabytes,
      estimatedStorageMonthlyUsd: r2StorageMonthlyUsd,
      estimatedInitialWriteUsd: r2ClassAWriteUsd,
    },
    d1: {
      rows: d1Rows,
      estimatedInitialWrites: d1Writes,
      estimatedInitialWriteUsd: d1WriteUsd,
      estimatedStorageGigabytes: d1StorageGigabytes,
      estimatedStorageMonthlyUsd: d1StorageMonthlyUsd,
    },
    estimatedMonthlyCloudflareUsd:
      vectorStoredMonthlyUsd +
      vectorQueryMonthlyUsd +
      r2StorageMonthlyUsd +
      d1StorageMonthlyUsd,
    estimatedInitialCloudflareWriteUsd: r2ClassAWriteUsd + d1WriteUsd,
  };
}

export function buildDryRunManifest({
  generatedAt = new Date().toISOString(),
  providers = [],
  costOptions = {},
} = {}) {
  const providerSummaries = {};
  let candidateCount = 0;
  let captionCoverageTotal = 0;
  let withInstitutionCaption = 0;
  let missingInstitutionCaption = 0;
  const allSamples = [];

  for (const provider of providers) {
    candidateCount += provider.candidateCount || 0;
    const normalizedSamples = provider.normalizedSamples || [];
    const sampleCaptionCoverage = summarizeCaptionCoverage(normalizedSamples);
    const captionCoverage = provider.captionCoverage || sampleCaptionCoverage;
    captionCoverageTotal += captionCoverage.total || 0;
    withInstitutionCaption += captionCoverage.withInstitutionCaption || 0;
    missingInstitutionCaption += captionCoverage.missingInstitutionCaption || 0;
    allSamples.push(...normalizedSamples);
    providerSummaries[provider.provider] = {
      candidateCount: provider.candidateCount || 0,
      skippedCount: provider.skipped?.length || 0,
      skipped: provider.skipped || [],
      captionCoverage,
      sampleCaptionCoverage,
      normalizedSamples,
      notes: provider.notes || [],
    };
  }

  const sampleCaptionCoverage = summarizeCaptionCoverage(allSamples);
  const exactCaptionCoverage =
    captionCoverageTotal > 0
      ? {
          total: captionCoverageTotal,
          withInstitutionCaption,
          missingInstitutionCaption,
        }
      : sampleCaptionCoverage;

  return {
    version: 'open-access-art-dry-run-v1',
    generatedAt,
    collection: OPEN_ACCESS_ART_COLLECTION,
    providers: providerSummaries,
    totals: {
      candidateCount,
      captionCoverage: exactCaptionCoverage,
      sampleCaptionCoverage,
    },
    costs: estimateOpenAccessCosts({
      artworkCount: candidateCount,
      captionVectorCount: exactCaptionCoverage.missingInstitutionCaption,
      ...costOptions,
    }),
  };
}
