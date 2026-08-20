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
  for (const value of [visualClassification, classification]) {
    const canonical = CLASSIFICATION_ALIASES.get(clean(value).toLowerCase());
    if (canonical) return canonical;
  }
  return clean(visualClassification || classification) || null;
}

export function deriveMediumFamily(mediumFamily, medium) {
  const explicit = clean(mediumFamily).toLowerCase();
  if (explicit) return explicit;
  const text = clean(medium);
  return MEDIUM_FAMILIES.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

export function enrichVectorLine(line, record) {
  const vector = JSON.parse(line);
  const classification = canonicalClassification(
    record.visual_classification,
    record.classification
  );
  vector.metadata = {
    ...(vector.metadata || {}),
    catalogueClassification: clean(record.classification),
    classification: classification || '',
    yearStart: record.year_start ?? record.year ?? 0,
    yearEnd: record.year_end ?? record.year_start ?? record.year ?? 0,
    mediumFamily: deriveMediumFamily(record.medium_family, record.medium) || '',
    primaryArtistId: clean(record.primary_artist_id),
  };
  return JSON.stringify(vector);
}

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNullableString = (value) => {
  const normalized = clean(value);
  return normalized ? sqlString(normalized) : 'NULL';
};
const sqlNullableNumber = (value) =>
  Number.isFinite(Number(value)) ? String(Number(value)) : 'NULL';

export function buildStructuredMetadataUpdateSql(record) {
  const classification = canonicalClassification(
    record.visual_classification,
    record.classification
  );
  const mediumFamily = deriveMediumFamily(record.medium_family, record.medium);
  return `UPDATE artworks SET
  year_start = ${sqlNullableNumber(record.year_start ?? record.year)},
  year_end = ${sqlNullableNumber(record.year_end ?? record.year_start ?? record.year)},
  subclassification = ${sqlNullableString(record.subclassification)},
  visual_classification = ${sqlNullableString(classification)},
  medium_family = ${sqlNullableString(mediumFamily)},
  primary_artist_id = ${sqlNullableString(record.primary_artist_id)}
WHERE id = ${sqlString(record.id)};`;
}
