import { deriveNgaDisplayDateRange } from '@paillette/types/nga-date-range';

const CLASSIFICATION_ALIASES = new Map([
  ['painting', 'Painting'],
  ['paintings', 'Painting'],
  ['drawing', 'Drawing'],
  ['drawings', 'Drawing'],
  ['print', 'Print'],
  ['prints', 'Print'],
  ['sculpture', 'Sculpture'],
  ['sculptures', 'Sculpture'],
  ['photograph', 'Photograph'],
  ['photographs', 'Photograph'],
  ['photography', 'Photograph'],
  ['decorative art', 'Decorative Art'],
  ['decorative arts', 'Decorative Art'],
]);

const MEDIUM_FAMILIES = [
  ['watercolor', /\bwatercolou?r\b/i],
  ['oil', /\boil\b/i],
  ['ink', /\bink\b/i],
  ['graphite', /\b(?:graphite|pencils?)\b/i],
  ['charcoal', /\bcharcoal\b/i],
  ['etching', /\betchings?\b/i],
  ['engraving', /\bengravings?\b/i],
  ['woodcut', /\b(?:woodcuts?|woodblocks?)\b/i],
  ['bronze', /\bbronze\b/i],
  ['marble', /\bmarble\b/i],
];

const clean = (value) => String(value || '').trim();

export function canonicalClassification(visualClassification, classification) {
  if (clean(classification).toLowerCase() === 'index of american design') {
    return 'Drawing';
  }
  for (const value of [visualClassification, classification]) {
    const canonical = CLASSIFICATION_ALIASES.get(clean(value).toLowerCase());
    if (canonical) return canonical;
  }
  return clean(visualClassification || classification) || null;
}

export function mergeAuthoritativeRecords(freshRecords, fallbackRecords) {
  const merged = [...freshRecords];
  const ids = new Set(freshRecords.map((record) => record.id));
  for (const record of fallbackRecords) {
    if (!ids.has(record.id)) merged.push(record);
  }
  return merged;
}

const deriveYearRange = (record) =>
  deriveNgaDisplayDateRange(record.date_text) || {
    startYear: null,
    endYear: null,
  };

export function deriveMediumFamily(mediumFamily, medium) {
  const explicit = clean(mediumFamily).toLowerCase();
  if (explicit) return explicit;
  const text = clean(medium);
  return MEDIUM_FAMILIES.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

export function enrichVectorLine(line, record) {
  const vector = JSON.parse(line);
  const { startYear, endYear } = deriveYearRange(record);
  const classification = canonicalClassification(
    record.visual_classification,
    record.classification
  );
  vector.metadata = {
    ...(vector.metadata || {}),
    catalogueClassification: clean(record.classification),
    classification: classification || '',
    yearStart: startYear ?? 0,
    yearEnd: endYear ?? 0,
    mediumFamily: deriveMediumFamily(record.medium_family, record.medium) || '',
    primaryArtistId: clean(record.primary_artist_id),
  };
  return JSON.stringify(vector);
}

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const sqlJsonLiteral = (value) => sqlString(JSON.stringify(value));
const sqlNullableString = (value) => {
  const normalized = clean(value);
  return normalized ? sqlString(normalized) : 'NULL';
};
const sqlNullableNumber = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value))
    ? String(Number(value))
    : 'NULL';

export function buildStructuredMetadataUpdateSql(record) {
  const { startYear, endYear } = deriveYearRange(record);
  const classification = canonicalClassification(
    record.visual_classification,
    record.classification
  );
  const mediumFamily = deriveMediumFamily(record.medium_family, record.medium);
  return `UPDATE artworks SET
  year_start = ${sqlNullableNumber(startYear)},
  year_end = ${sqlNullableNumber(endYear)},
  subclassification = ${sqlNullableString(record.subclassification)},
  visual_classification = ${sqlNullableString(classification)},
  medium_family = ${sqlNullableString(mediumFamily)},
  primary_artist_id = ${sqlNullableString(record.primary_artist_id)}
WHERE id = ${sqlString(record.id)};`;
}

export function buildNgaArtistUpdateSql(record, expectedOrgId) {
  const id = String(record?.id || '');
  const primaryArtistId = String(record?.primaryArtistId || '');
  const orgId = String(expectedOrgId || '');
  if (!/^open-access-art:nga:\d+$/.test(id)) {
    throw new Error('artist update requires an exact NGA artwork ID');
  }
  if (!/^\d+$/.test(primaryArtistId)) {
    throw new Error('artist update requires a decimal primaryArtistId');
  }
  if (!/^[a-f0-9-]{36}$/i.test(orgId)) {
    throw new Error('artist update requires an expected organization ID');
  }
  const ngaArtists = record?.customMetadata?.ngaArtists;
  if (!ngaArtists || typeof ngaArtists !== 'object') {
    throw new Error('artist update requires customMetadata.ngaArtists');
  }
  if (record?.fieldSources?.primary_artist_id !== 'nga.objects_constituents') {
    throw new Error('artist update requires authoritative field provenance');
  }
  const ngaArtistsLiteral = sqlJsonLiteral(ngaArtists);

  return `UPDATE artworks SET
  primary_artist_id = ${sqlString(primaryArtistId)},
  custom_metadata = json_patch(coalesce(custom_metadata, '{}'), json(${sqlJsonLiteral({ ngaArtists })})),
  field_sources = json_patch(coalesce(field_sources, '{}'), json(${sqlJsonLiteral({ primary_artist_id: 'nga.objects_constituents' })})),
  updated_at = CURRENT_TIMESTAMP
WHERE org_id = ${sqlString(orgId)}
  AND json_extract(custom_metadata, '$.provider') = 'nga'
  AND id LIKE 'open-access-art:nga:%'
  AND id = ${sqlString(id)}
  AND (
    primary_artist_id IS NOT ${sqlString(primaryArtistId)}
    OR json_extract(custom_metadata, '$.ngaArtists') IS NOT json(${ngaArtistsLiteral})
    OR json_extract(field_sources, '$.primary_artist_id') IS NOT 'nga.objects_constituents'
  );`;
}
