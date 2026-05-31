const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const isRootsUrl = (value: string | null) =>
  Boolean(value && /^https:\/\/www\.roots\.gov\.sg\//i.test(value));

const HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS = new Set([
  '2013-00591',
  '2013-00592',
  '2013-00593',
  '2013-00594',
  '2014-00418',
  '2014-00419',
  '2014-00420',
]);

export const isHiddenPublicNgsArtwork = (artwork: Record<string, any>) => {
  const metadata = asRecord(artwork.metadata || artwork.custom_metadata);
  const accession = firstText(
    artwork.accession_number,
    artwork.accessionNumber,
    artwork.source_record_id,
    artwork.sourceRecordId,
    metadata.accession_number,
    metadata.accessionNumber,
    metadata.source_record_id,
    metadata.sourceRecordId,
    artwork.id
  );
  const sourceUrl = firstText(
    artwork.source_url,
    artwork.sourceUrl,
    metadata.source_url,
    metadata.sourceUrl
  );
  const normalizedAccession = accession?.toUpperCase();

  return Boolean(
    normalizedAccession &&
      isRootsUrl(sourceUrl) &&
      (normalizedAccession.startsWith('AB') ||
        normalizedAccession.startsWith('HP-') ||
        normalizedAccession.endsWith('-(AB)') ||
        HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS.has(normalizedAccession))
  );
};
