const ROOTS_URL_PATTERN = "https://www.roots.gov.sg/%";

export const HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS = [
  '2013-00591',
  '2013-00592',
  '2013-00593',
  '2013-00594',
  '2014-00418',
  '2014-00419',
  '2014-00420',
] as const;

const normalizeAccession = (value: string | null | undefined) =>
  value?.trim().toUpperCase() ?? '';

const isRootsUrl = (value: string | null | undefined) =>
  Boolean(value?.trim().match(/^https:\/\/www\.roots\.gov\.sg\//i));

export const isHiddenNgsPublicAccession = (
  accession: string | null | undefined,
  sourceUrl: string | null | undefined
) => {
  const normalized = normalizeAccession(accession);

  return (
    Boolean(normalized) &&
    isRootsUrl(sourceUrl) &&
    (normalized.startsWith('AB') ||
      normalized.startsWith('HP-') ||
      normalized.endsWith('-(AB)') ||
      HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS.includes(
        normalized as (typeof HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS)[number]
      ))
  );
};

const hiddenRootsOnlyAccessionSql = HIDDEN_ROOTS_ONLY_NGS_ACCESSIONS.map(
  (accession) => `'${accession}'`
).join(', ');

export const HIDDEN_NGS_PUBLIC_ARTWORK_SQL = `
        AND NOT (
          source_url LIKE '${ROOTS_URL_PATTERN}'
          AND (
            UPPER(accession_number) LIKE 'AB%'
            OR UPPER(accession_number) LIKE 'HP-%'
            OR UPPER(accession_number) LIKE '%-(AB)'
            OR UPPER(accession_number) IN (${hiddenRootsOnlyAccessionSql})
          )
        )
`;

export const PUBLIC_SOURCE_REQUIRED_SQL = `
        AND source_url IS NOT NULL
        AND trim(source_url) <> ''
        AND accession_number IS NOT NULL
        AND trim(accession_number) <> ''
        AND title IS NOT NULL
        AND trim(title) <> ''
`;

export const PUBLIC_NGS_SOURCE_LABEL_SQL = `
        AND source_institution = 'National Gallery Singapore'
        AND source_collection = 'National Collection'
`;

export const PUBLIC_ARTWORK_SQL = `
        ${PUBLIC_SOURCE_REQUIRED_SQL}
        ${HIDDEN_NGS_PUBLIC_ARTWORK_SQL}
`;

export const BACKABLE_NGS_PUBLIC_ARTWORK_SQL = `
        ${PUBLIC_ARTWORK_SQL}
        ${PUBLIC_NGS_SOURCE_LABEL_SQL}
`;
