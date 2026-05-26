import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import {
  Ban,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ImageOff,
  Search,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import manifestJson from '~/generated/ngs-discrepancy-review-manifest.json';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';

type ReviewCategory =
  | 'suggested_canonical'
  | 'suggested_suffix'
  | 'duplicate_title_image_mismatch'
  | 'no_live_source_match'
  | 'no_title_orphan_image';

type ReviewVerdict =
  | 'approve_mapping'
  | 'reject_mapping'
  | 'needs_manual_research'
  | 'exclude_from_v2';

type ReviewMode = 'active' | 'research' | 'exclude' | 'resolved' | 'all';

type Candidate = {
  source?: string;
  accession?: string;
  title?: string;
  artist?: string;
  dateText?: string;
  classification?: string;
  medium?: string;
  dimensions?: string;
  creditLine?: string;
  description?: string;
  descriptionSource?: string;
  sourceUrl?: string;
  rootsSourceUrl?: string;
  collectionOf?: string;
  collectionVerdict?: string;
  imageUrl?: string;
  matchBasis?: string;
  note?: string;
  imageEvidence?: {
    method?: string;
    meanAbsDiffRgb?: number;
    verdict?: string;
    note?: string;
  };
};

type CaptionEvidence = {
  kind: string;
  label: string;
  source: string;
  text: string;
  sourceUrl?: string;
  rootsTitle?: string;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
  sources?: string[];
  sourceLabels?: string[];
  rootsSourceUrl?: string;
  note?: string;
};

type CaptionPolicy = {
  requestedCaption?: boolean;
  requestedRootsCaption?: boolean;
  approvedForV2?: boolean;
  status?: string;
  source?: string | null;
  sourceUrl?: string;
  rootsTitle?: string;
  note?: string;
};

type WebImageSource = {
  status?: string;
  sourceProvider?: string;
  sourceType?: string;
  pageUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  sourceTitle?: string;
  sourceArtist?: string;
  sourceDate?: string;
  sourceInstitution?: string;
  rights?: string;
  corroboratingUrl?: string;
  matchBasis?: string;
  note?: string;
};

type ReviewRow = {
  staleId: string;
  category: ReviewCategory;
  categoryLabel: string;
  proposedStatus: string;
  targetAccession?: string;
  explanation: string;
  stale: Candidate & {
    id: string;
    image?: {
      thumbKey?: string;
      originalKey?: string;
      thumbPath?: string;
      originalPath?: string;
    };
  };
  currentAppMatch?: Candidate & { id?: string; thumbnailUrl?: string };
  ngsCandidates?: Candidate[];
  rootsCandidates?: Candidate[];
  relatedRecords?: Array<{
    accession: string;
    currentAppMatch?: Candidate & { id?: string; thumbnailUrl?: string };
    sourceRecord?: Candidate;
  }>;
  componentResolution?: {
    status?: string;
    approvedAccessions?: string[];
    note?: string;
  };
  legacyImageResolution?: {
    status?: string;
    sourceRecordRef?: string;
    sourceProvider?: string;
    sourceType?: string;
    sourceUrl?: string;
    originalAssetId?: string;
    originalKey?: string;
    thumbAssetId?: string;
    thumbKey?: string;
    note?: string;
  };
  webImageSource?: WebImageSource;
  captionEvidence?: CaptionEvidence[];
  captionPolicy?: CaptionPolicy;
  resolutionState?: 'active' | 'resolved_approved';
  defaultVerdict?: string;
};

type RootsCollectionAuditEntry = {
  accession?: string;
  rootsAccession?: string;
  title?: string;
  rootsTitle?: string;
  creditLine?: string;
  ngsDetailUrl?: string;
  rootsUrl?: string;
  rootsCollectionOf?: string;
  rootsCollectionSource?: string;
  collectionVerdict?: string;
  inSourceDb?: boolean;
  fetchError?: string | null;
};

type RootsCollectionAudit = {
  auditedAt?: string | null;
  rule?: string | null;
  summary?: {
    sourceRowsWithRootsUrl?: number;
    csvMatched?: number;
    csvMissing?: number;
    liveFetched?: number;
    ngsRoots?: number;
    nonNgsRoots?: number;
    unknownRoots?: number;
    extraUrls?: number;
  } | null;
  nonNgsRoots?: RootsCollectionAuditEntry[];
  extraUrls?: RootsCollectionAuditEntry[];
};

type ReviewManifest = {
  generatedAt: string;
  source: {
    sourceDbName: string;
    appDbName: string;
    rule: string;
  };
  categoryLabels: Record<ReviewCategory, string>;
  summary: {
    total: number;
    activeRows?: number;
    resolvedApproved?: number;
    activeNeedsResearch?: number;
    activeExcludeFromV2?: number;
    suggestedCanonical: number;
    suggestedSuffix: number;
    unresolvedQuarantined: number;
    countsByCategory: Record<ReviewCategory, number>;
  };
  rootsCollectionAudit?: RootsCollectionAudit;
  regressionChecks: Array<{
    id: string;
    expected: string;
    actual?: string;
  }>;
  rows: ReviewRow[];
};

const manifest = manifestJson as unknown as ReviewManifest;

export const meta: MetaFunction = () => [
  { title: 'NGS / Roots discrepancy review | Paillette' },
];

export const loader = ({ context }: LoaderFunctionArgs) => {
  const env = getServerEnv(context);
  const appEnv = env.APP_ENV || env.NODE_ENV || 'development';

  if (appEnv === 'production' && env.ENABLE_NGS_REVIEW !== 'true') {
    throw new Response('Not found', { status: 404 });
  }

  const apiBaseUrl = getApiBaseUrl(env);
  const apiOrigin = apiBaseUrl.replace(/\/api\/v1$/, '');

  return json({
    manifest,
    apiOrigin,
  });
};

const categoryOrder: Array<ReviewCategory | 'all'> = [
  'all',
  'suggested_canonical',
  'suggested_suffix',
  'duplicate_title_image_mismatch',
  'no_live_source_match',
  'no_title_orphan_image',
];

const categoryTone: Record<ReviewCategory, string> = {
  suggested_canonical:
    'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
  suggested_suffix: 'border-sky-500/35 bg-sky-500/10 text-sky-200',
  duplicate_title_image_mismatch:
    'border-amber-500/40 bg-amber-500/10 text-amber-200',
  no_live_source_match: 'border-zinc-600 bg-zinc-900 text-zinc-300',
  no_title_orphan_image: 'border-rose-500/35 bg-rose-500/10 text-rose-200',
};

const verdictOptions: Array<{
  value: ReviewVerdict;
  label: string;
  icon: typeof CheckCircle2;
}> = [
  { value: 'approve_mapping', label: 'Approve mapping', icon: CheckCircle2 },
  { value: 'reject_mapping', label: 'Reject mapping', icon: XCircle },
  {
    value: 'needs_manual_research',
    label: 'Needs manual research',
    icon: Search,
  },
  { value: 'exclude_from_v2', label: 'Exclude from v2', icon: Ban },
];

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const verdictLabels: Record<ReviewVerdict, string> = {
  approve_mapping: 'Approve mapping',
  reject_mapping: 'Reject mapping',
  needs_manual_research: 'Needs manual research',
  exclude_from_v2: 'Exclude from v2',
};

const verdictTone: Record<ReviewVerdict, string> = {
  approve_mapping: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
  reject_mapping: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  needs_manual_research: 'border-sky-500/35 bg-sky-500/10 text-sky-200',
  exclude_from_v2: 'border-rose-500/35 bg-rose-500/10 text-rose-200',
};

const reviewModeLabels: Record<ReviewMode, string> = {
  active: 'Active queue',
  research: 'Research',
  exclude: 'Exclude',
  resolved: 'Resolved done',
  all: 'All audit',
};

const decisionLabelForRow = (row: ReviewRow) => {
  if (row.resolutionState === 'resolved_approved') return 'Include';
  if (row.defaultVerdict === 'approve_mapping') return 'Include';
  if (row.defaultVerdict === 'needs_manual_research') return 'Research';
  if (row.defaultVerdict === 'exclude_from_v2') return 'Exclude';
  return 'Review';
};

const decisionToneForRow = (row: ReviewRow) => {
  const decision = decisionLabelForRow(row);
  if (decision === 'Include') {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  if (decision === 'Research') {
    return 'border-sky-500/35 bg-sky-500/10 text-sky-200';
  }
  if (decision === 'Exclude') {
    return 'border-rose-500/35 bg-rose-500/10 text-rose-200';
  }
  return 'border-zinc-700 bg-zinc-900 text-zinc-300';
};

const captionPolicyLabel = (policy?: CaptionPolicy) => {
  if (!policy) return null;
  if (policy.status === 'roots_caption_verified') return 'Roots caption';
  if (policy.status === 'roots_caption_in_app') return 'Roots text in app';
  if (policy.status === 'legacy_v1_caption_approved') return 'V1 caption';
  if (policy.status === 'generated_caption_approved')
    return 'Generated caption';
  if (policy.status === 'ngs_catalogue_caption_approved')
    return 'NGS catalogue text';
  if (policy.status === 'roots_page_has_no_caption')
    return 'Roots page, no caption';
  if (policy.status === 'no_roots_listing_found') return 'No Roots listing';
  return policy.status || null;
};

const sourceDisplayLabel = (source?: string) => {
  const normalized = source || 'unknown';
  if (normalized === 'roots') return 'Roots';
  if (normalized === 'ngs') return 'NGS public';
  if (normalized === 'ngs_artplus_catalog') return 'NGS catalogue API';
  if (normalized === 'generated') return 'Generated';
  if (normalized === 'source_db') return 'Source DB';
  if (normalized === 'legacy_corpus_unverified') return 'Legacy corpus';
  return normalized;
};

const evidenceSourceLinkLabel = (item: CaptionEvidence) => {
  if (item.source === 'roots') return 'Roots source';
  if (item.source === 'ngs_artplus_catalog') return 'NGS record URL';
  if (item.source === 'ngs') return 'NGS source';
  return 'Primary source';
};

const generatedCaptionCount = (row: ReviewRow) =>
  row.captionEvidence?.filter((item) => item.source === 'generated').length ||
  0;

const hasCatalogueApiText = (row: ReviewRow) =>
  Boolean(
    row.captionEvidence?.some((item) => item.source === 'ngs_artplus_catalog')
  );

const repairDisplayText = (value: string) =>
  value
    .replace(/â€™/g, '’')
    .replace(/â€˜/g, '‘')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€¦/g, '…')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/Â©/g, '©')
    .replace(/Â®/g, '®')
    .replace(/Â /g, ' ');

const text = (value?: string | number | null) =>
  value === null || value === undefined || value === ''
    ? '-'
    : repairDisplayText(String(value));

function DefaultVerdictBadge({ verdict }: { verdict?: string }) {
  if (!verdict || !(verdict in verdictLabels)) return null;

  const typedVerdict = verdict as ReviewVerdict;
  return (
    <span
      className={cx(
        'rounded-md border px-2 py-1 text-xs font-medium',
        verdictTone[typedVerdict]
      )}
    >
      default: {verdictLabels[typedVerdict]}
    </span>
  );
}

function rowDecisionText(row: ReviewRow) {
  if (row.legacyImageResolution) {
    if (row.webImageSource) {
      return 'Resolved and approved for v2 as a titled legacy image row. Use the old image asset for display, keep the legacy provenance, and record the web image/source reference as enrichment metadata.';
    }
    return 'Resolved and approved for v2 as a titled legacy image row. Use the old image asset for display and keep the recorded legacy source provenance with the metadata.';
  }
  if (row.resolutionState === 'resolved_approved') {
    return 'Resolved and approved for v2. This row is hidden from the active discrepancy queue; keep the verified accession/source mapping and any caption provenance shown here.';
  }
  if (row.category === 'suggested_canonical') {
    return 'Manual review required. Stale ID normalizes to a current app accession and image evidence looks like the same work.';
  }
  if (row.category === 'suggested_suffix') {
    return 'Manual review required. Stale ID likely maps to the suffixed NGS accession; accept only when accession/source evidence or image evidence backs the canonical record.';
  }
  if (row.category === 'duplicate_title_image_mismatch') {
    return 'Excluded by default. Title/artist candidates exist, but the image evidence rejects the match.';
  }
  if (row.category === 'no_title_orphan_image') {
    return 'Excluded by default. This is an old R2 image-only row with no trusted title, artist, or source URL; generated captions are audit hints only.';
  }
  if (row.relatedRecords?.length) {
    return 'Excluded by default as a stale parent placeholder. The referenced component accessions are shown below and should be reviewed separately.';
  }
  if (row.stale.descriptionSource === 'legacy_corpus_unverified') {
    return 'Excluded by default. It has legacy corpus metadata, including a description, but no accession-backed live NGS or trusted Roots source in this manifest.';
  }
  return 'Excluded by default. It has old metadata, but no exact live NGS accession match or trusted Roots source in this manifest.';
}

function hasTrustedRootsEvidence(row: ReviewRow) {
  return Boolean(
    row.rootsCandidates?.length ||
      row.currentAppMatch?.descriptionSource === 'roots' ||
      row.captionEvidence?.some(
        (item) => item.kind === 'verified_roots_caption'
      )
  );
}

function hasGeneratedCaptionRootsContext(row: ReviewRow) {
  return Boolean(
    row.captionEvidence?.some(
      (item) =>
        item.kind === 'generated_caption' &&
        item.sourceLabels?.includes('roots')
    )
  );
}

function ImagePanel({
  src,
  alt,
  label,
}: {
  src?: string | null;
  alt: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </span>
      </div>
      <div className="flex aspect-[4/5] min-h-[220px] items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
        {src && !failed ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-600">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
            <span className="text-xs">No image</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function MetadataList({ item }: { item?: Candidate | null }) {
  const fields: Array<[string, string | number | undefined]> = [
    ['Accession', item?.accession],
    ['Title', item?.title],
    ['Artist', item?.artist],
    ['Date', item?.dateText],
    ['Medium', item?.medium],
    ['Dimensions', item?.dimensions],
    ['Credit line', item?.creditLine],
  ];

  return (
    <dl className="grid grid-cols-1 gap-2 text-sm">
      {fields.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[108px_1fr] gap-3">
          <dt className="text-xs uppercase tracking-[0.12em] text-zinc-600">
            {label}
          </dt>
          <dd className="min-w-0 text-zinc-200">{text(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DescriptionBlock({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </div>
      <p className="max-h-36 overflow-auto rounded-md border border-zinc-800 bg-black/30 p-3 text-sm leading-6 text-zinc-300">
        {repairDisplayText(value)}
      </p>
    </div>
  );
}

function SourcePill({ source }: { source?: string }) {
  const normalized = source || 'unknown';

  return (
    <span
      className={cx(
        'rounded-md border px-2 py-1 text-xs font-medium',
        normalized === 'roots'
          ? 'border-teal-500/35 bg-teal-500/10 text-teal-200'
          : normalized === 'ngs' || normalized === 'ngs_artplus_catalog'
            ? 'border-sky-500/35 bg-sky-500/10 text-sky-200'
            : normalized === 'generated'
              ? 'border-violet-500/35 bg-violet-500/10 text-violet-200'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300'
      )}
    >
      {sourceDisplayLabel(normalized)}
    </span>
  );
}

function CaptionEvidencePanel({ evidence }: { evidence?: CaptionEvidence[] }) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <section className="mt-6 space-y-4 border-t border-zinc-800 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-zinc-100">
          Caption / text provenance
        </h3>
        <p className="text-xs text-zinc-500">
          Catalogue descriptions and generated image captions are shown
          separately.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {evidence.map((item, index) => (
          <div
            key={`${item.kind}-${index}`}
            className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SourcePill source={item.source} />
              <span className="font-medium text-zinc-100">{item.label}</span>
              {item.sourceLabels?.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500"
                >
                  cites {label}
                </span>
              ))}
            </div>
            <p className="max-h-40 overflow-auto text-sm leading-6 text-zinc-300">
              {repairDisplayText(item.text)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {item.model ? <span>{item.model}</span> : null}
              {item.promptVersion ? <span>{item.promptVersion}</span> : null}
              {item.rootsTitle ? (
                <span>Roots title: {item.rootsTitle}</span>
              ) : null}
            </div>
            {item.note ? (
              <p className="text-xs leading-5 text-zinc-500">
                {repairDisplayText(item.note)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <SourceLink
                href={item.sourceUrl}
                label={evidenceSourceLinkLabel(item)}
              />
              {item.rootsSourceUrl && item.rootsSourceUrl !== item.sourceUrl ? (
                <SourceLink href={item.rootsSourceUrl} label="Roots source" />
              ) : null}
              {item.sources?.map((source) => (
                <SourceLink
                  key={source}
                  href={source}
                  label={
                    /roots\.gov\.sg/i.test(source)
                      ? 'Roots source'
                      : /nationalgallery\.sg/i.test(source)
                        ? 'NGS source'
                        : 'Source'
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceBadge({ candidate }: { candidate: Candidate }) {
  const evidence = candidate.imageEvidence;
  if (!evidence) return null;
  const label =
    evidence.verdict === 'image_match'
      ? 'Image match'
      : evidence.verdict === 'separate_same_title_candidate'
        ? 'Separate same-title'
        : 'Image mismatch';

  return (
    <div
      className={cx(
        'inline-flex items-center rounded-md border px-2 py-1 text-xs',
        evidence.verdict === 'image_match'
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      )}
    >
      {label}
      {typeof evidence.meanAbsDiffRgb === 'number'
        ? ` · diff ${evidence.meanAbsDiffRgb.toFixed(2)}`
        : ''}
    </div>
  );
}

function reviewThumbnailUrl(row: ReviewRow, apiOrigin: string) {
  const ngsImage = row.ngsCandidates?.find(
    (candidate) => candidate.imageUrl
  )?.imageUrl;
  const rootsImage = row.rootsCandidates?.find(
    (candidate) => candidate.imageUrl
  )?.imageUrl;

  if (row.currentAppMatch?.thumbnailUrl)
    return row.currentAppMatch.thumbnailUrl;
  if (row.currentAppMatch?.imageUrl) return row.currentAppMatch.imageUrl;
  if (ngsImage) return ngsImage;
  if (rootsImage) return rootsImage;
  if (row.stale.image?.thumbPath)
    return `${apiOrigin}${row.stale.image.thumbPath}`;
  return row.stale.imageUrl;
}

function rowSearchText(row: ReviewRow) {
  return [
    row.staleId,
    row.targetAccession,
    row.categoryLabel,
    row.defaultVerdict,
    row.currentAppMatch?.accession,
    row.currentAppMatch?.title,
    row.currentAppMatch?.artist,
    row.stale.accession,
    row.stale.title,
    row.stale.artist,
    row.ngsCandidates?.map((candidate) =>
      [
        candidate.accession,
        candidate.title,
        candidate.artist,
        candidate.matchBasis,
      ].join(' ')
    ),
    row.rootsCandidates?.map((candidate) =>
      [candidate.accession, candidate.title, candidate.artist].join(' ')
    ),
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function OverviewThumbnail({
  row,
  apiOrigin,
}: {
  row: ReviewRow;
  apiOrigin: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = reviewThumbnailUrl(row, apiOrigin);

  return (
    <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-black">
      {src && !failed ? (
        <img
          src={src}
          alt={`${row.currentAppMatch?.title || row.stale.title || row.staleId} thumbnail`}
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageOff className="h-5 w-5 text-zinc-700" aria-hidden="true" />
      )}
    </div>
  );
}

function CandidateColumn({
  title,
  candidates,
  fallback,
}: {
  title: string;
  candidates?: Candidate[];
  fallback: string;
}) {
  if (!candidates || candidates.length === 0) {
    return (
      <section className="space-y-3">
        <h3 className="font-semibold text-zinc-100">{title}</h3>
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          {fallback}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h3 className="font-semibold text-zinc-100">{title}</h3>
      {candidates.map((candidate, index) => (
        <div
          key={`${candidate.accession || candidate.title || title}-${index}`}
          className="space-y-3 border-t border-zinc-800 pt-4 first:border-t-0 first:pt-0"
        >
          <ImagePanel
            src={candidate.imageUrl}
            alt={`${candidate.title || title} candidate image`}
            label={candidate.accession || title}
          />
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceBadge candidate={candidate} />
            {candidate.matchBasis ? (
              <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500">
                {candidate.matchBasis}
              </span>
            ) : null}
          </div>
          <MetadataList item={candidate} />
          <DescriptionBlock
            label={`Description / caption${
              candidate.descriptionSource
                ? ` (${sourceDisplayLabel(candidate.descriptionSource)})`
                : ''
            }`}
            value={candidate.description}
          />
          {candidate.collectionOf ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-400">
              Roots collection:{' '}
              <span className="text-zinc-200">{candidate.collectionOf}</span>
              {candidate.collectionVerdict ? (
                <span className="ml-2 rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-400">
                  {candidate.collectionVerdict}
                </span>
              ) : null}
            </div>
          ) : null}
          {candidate.note ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
              {candidate.note}
            </p>
          ) : null}
          <SourceLink href={candidate.sourceUrl} label={`${title} source`} />
        </div>
      ))}
    </section>
  );
}

function RelatedRecordsPanel({
  records,
}: {
  records?: ReviewRow['relatedRecords'];
}) {
  if (!records || records.length === 0) return null;

  return (
    <section className="mt-5 space-y-4 border-t border-zinc-800 pt-4">
      <div>
        <h3 className="font-semibold text-zinc-100">
          Referenced component records
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          These are linked from the stale placeholder title. They are evidence
          that the parent row is a placeholder and the child records should be
          used for v2 when source-backed.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {records.map((record) => {
          const appRecord = record.currentAppMatch;
          const sourceRecord = record.sourceRecord;
          return (
            <div
              key={record.accession}
              className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-zinc-300">
                  {record.accession}
                </span>
                {appRecord ? (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                    in app DB
                  </span>
                ) : null}
                {sourceRecord ? (
                  <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
                    source row
                  </span>
                ) : null}
              </div>

              {appRecord ? (
                <div className="space-y-3">
                  <ImagePanel
                    src={appRecord.thumbnailUrl || appRecord.imageUrl}
                    alt={`${appRecord.title || record.accession} app image`}
                    label="current app"
                  />
                  <MetadataList item={appRecord} />
                  <SourceLink href={appRecord.sourceUrl} label="App source" />
                </div>
              ) : null}

              {sourceRecord && !appRecord ? (
                <div className="space-y-3">
                  <ImagePanel
                    src={sourceRecord.imageUrl}
                    alt={`${sourceRecord.title || record.accession} source image`}
                    label="source image"
                  />
                  <MetadataList item={sourceRecord} />
                </div>
              ) : null}

              {sourceRecord ? (
                <div className="flex flex-wrap gap-2">
                  <SourceLink
                    href={sourceRecord.sourceUrl}
                    label="NGS source"
                  />
                  <SourceLink
                    href={sourceRecord.rootsSourceUrl}
                    label="Roots source"
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionQueue({
  rows,
  apiOrigin,
  selectedStaleId,
  onSelect,
}: {
  rows: ReviewRow[];
  apiOrigin: string;
  selectedStaleId?: string;
  onSelect: (staleId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-500">
        No rows in this view.
      </div>
    );
  }

  return (
    <section
      data-testid="review-overview-grid"
      className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3"
    >
      {rows.map((row) => {
        const selected = selectedStaleId === row.staleId;
        const captionLabel = captionPolicyLabel(row.captionPolicy);
        const generatedCount = generatedCaptionCount(row);
        const primaryTitle = row.currentAppMatch?.title || row.stale.title;
        const artist = row.currentAppMatch?.artist || row.stale.artist;
        const imageVerdict =
          row.ngsCandidates?.find((candidate) => candidate.imageEvidence)
            ?.imageEvidence?.verdict ||
          row.currentAppMatch?.imageEvidence?.verdict;

        return (
          <button
            key={row.staleId}
            type="button"
            data-testid="review-card"
            data-stale-id={row.staleId}
            onClick={() => onSelect(row.staleId)}
            className={cx(
              'grid min-h-[156px] grid-cols-[80px_minmax(0,1fr)] gap-3 rounded-md border bg-zinc-950 p-3 text-left text-sm transition',
              selected
                ? 'border-cyan-300 bg-cyan-300/10 ring-1 ring-cyan-300/50'
                : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900'
            )}
          >
            <OverviewThumbnail row={row} apiOrigin={apiOrigin} />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cx(
                    'rounded-md border px-2 py-0.5 text-[11px] font-medium',
                    decisionToneForRow(row)
                  )}
                >
                  {decisionLabelForRow(row)}
                </span>
                {row.resolutionState === 'resolved_approved' ? (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                    done
                  </span>
                ) : null}
              </div>

              <div className="min-h-[44px] overflow-hidden">
                <div className="max-h-10 overflow-hidden font-medium leading-5 text-zinc-100">
                  {text(primaryTitle)}
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">
                  {text(artist)}
                </div>
              </div>

              <div className="grid gap-1 font-mono text-[11px] leading-4">
                <span className="truncate text-zinc-500">{row.staleId}</span>
                <span className="truncate text-zinc-300">
                  {row.targetAccession || row.currentAppMatch?.accession || '-'}
                </span>
              </div>

              <div className="flex max-h-12 flex-wrap gap-1 overflow-hidden">
                <span
                  className={cx(
                    'rounded-md border px-2 py-0.5 text-[11px]',
                    categoryTone[row.category]
                  )}
                >
                  {row.categoryLabel}
                </span>
                {imageVerdict === 'image_match' ? (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                    image match
                  </span>
                ) : imageVerdict === 'image_mismatch' ? (
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                    image mismatch
                  </span>
                ) : null}
                {row.ngsCandidates?.length ? (
                  <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                    NGS
                  </span>
                ) : null}
                {hasCatalogueApiText(row) ? (
                  <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                    API text
                  </span>
                ) : null}
                {captionLabel ? (
                  <span
                    className={cx(
                      'rounded-md border px-2 py-0.5 text-[11px]',
                      row.captionPolicy?.source === 'roots'
                        ? 'border-teal-500/30 bg-teal-500/10 text-teal-200'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                    )}
                  >
                    {captionLabel}
                  </span>
                ) : null}
                {generatedCount ? (
                  <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200">
                    cap {generatedCount}
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function ReviewRowCard({
  row,
  apiOrigin,
  verdict,
  note,
  onVerdict,
  onNote,
  onClose,
}: {
  row: ReviewRow;
  apiOrigin: string;
  verdict?: ReviewVerdict;
  note: string;
  onVerdict: (verdict: ReviewVerdict) => void;
  onNote: (note: string) => void;
  onClose: () => void;
}) {
  const staleImageUrl = row.stale.image?.thumbPath
    ? `${apiOrigin}${row.stale.image.thumbPath}`
    : row.stale.imageUrl;
  const hasRootsEvidence = hasTrustedRootsEvidence(row);
  const hasRootsCaptionContext = hasGeneratedCaptionRootsContext(row);

  return (
    <article className="rounded-md border border-zinc-800 bg-[#101012] p-5 shadow-xl shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-zinc-500">
              {row.staleId}
            </span>
            <span
              className={cx(
                'rounded-md border px-2 py-1 text-xs font-medium',
                categoryTone[row.category]
              )}
            >
              {row.categoryLabel}
            </span>
            {row.targetAccession ? (
              <span className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                maps to {row.targetAccession}
              </span>
            ) : null}
            <DefaultVerdictBadge verdict={row.defaultVerdict} />
            {row.resolutionState === 'resolved_approved' ? (
              <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200">
                resolved done
              </span>
            ) : null}
          </div>
          <h2 className="text-xl font-semibold text-zinc-50">
            {text(row.stale.title || row.currentAppMatch?.title)}
          </h2>
          <p className="max-w-4xl text-sm leading-6 text-zinc-400">
            {row.explanation}
          </p>
        </div>
        <div className="flex min-w-[280px] flex-wrap justify-end gap-2">
          {verdictOptions.map((option) => {
            const Icon = option.icon;
            const selected = verdict === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onVerdict(option.value)}
                className={cx(
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition',
                  selected
                    ? 'border-cyan-400 bg-cyan-400 text-black'
                    : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-900"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Close detail
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm lg:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Source / v2 decision
          </div>
          <p className="leading-6 text-zinc-300">{rowDecisionText(row)}</p>
          {row.captionPolicy?.note ? (
            <p className="text-xs leading-5 text-zinc-500">
              {row.captionPolicy.note}
            </p>
          ) : null}
          {row.legacyImageResolution ? (
            <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs leading-5 text-emerald-100">
              <div className="font-semibold text-emerald-200">
                Legacy image source approved
              </div>
              <div className="mt-1 text-emerald-100/80">
                {row.legacyImageResolution.note}
              </div>
              <div className="mt-2 space-y-1 font-mono text-[11px] text-emerald-100/70">
                {row.legacyImageResolution.sourceRecordRef ? (
                  <div>{row.legacyImageResolution.sourceRecordRef}</div>
                ) : null}
                {row.legacyImageResolution.sourceUrl ? (
                  <div>{row.legacyImageResolution.sourceUrl}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {row.webImageSource ? (
            <div className="mt-3 rounded-md border border-cyan-500/25 bg-cyan-500/5 p-3 text-xs leading-5 text-cyan-100">
              <div className="font-semibold text-cyan-200">
                Web image source found
              </div>
              {row.webImageSource.note ? (
                <div className="mt-1 text-cyan-100/80">
                  {row.webImageSource.note}
                </div>
              ) : null}
              {row.webImageSource.matchBasis ? (
                <div className="mt-1 text-cyan-100/80">
                  {row.webImageSource.matchBasis}
                </div>
              ) : null}
              <div className="mt-2 space-y-1 font-mono text-[11px] text-cyan-100/70">
                {row.webImageSource.sourceProvider ? (
                  <div>{row.webImageSource.sourceProvider}</div>
                ) : null}
                {row.webImageSource.pageUrl ? (
                  <div>{row.webImageSource.pageUrl}</div>
                ) : null}
                {row.webImageSource.imageUrl ? (
                  <div>{row.webImageSource.imageUrl}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          {row.stale.descriptionSource ? (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
              stale text: {sourceDisplayLabel(row.stale.descriptionSource)}
            </span>
          ) : null}
          {row.captionPolicy ? (
            <span
              className={cx(
                'rounded-md border px-2 py-1 text-xs',
                row.captionPolicy.source === 'roots'
                  ? 'border-teal-500/30 bg-teal-500/10 text-teal-200'
                  : 'border-zinc-800 text-zinc-400'
              )}
            >
              {captionPolicyLabel(row.captionPolicy)}
            </span>
          ) : null}
          {row.ngsCandidates?.length ? (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
              NGS candidates: {row.ngsCandidates.length}
            </span>
          ) : (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500">
              no NGS candidate
            </span>
          )}
          {row.rootsCandidates?.length ? (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
              Roots candidates: {row.rootsCandidates.length}
            </span>
          ) : hasRootsEvidence ? (
            <span className="rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-xs text-teal-200">
              trusted Roots text present
            </span>
          ) : hasRootsCaptionContext ? (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
              generated caption cites Roots
            </span>
          ) : (
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500">
              no trusted Roots candidate
            </span>
          )}
        </div>
      </div>

      <CaptionEvidencePanel evidence={row.captionEvidence} />

      <div className="grid gap-6 pt-5 xl:grid-cols-2">
        <section className="space-y-4">
          <h3 className="font-semibold text-zinc-100">Stale v1 record</h3>
          <ImagePanel
            src={staleImageUrl}
            alt={`${row.stale.title || row.staleId} stale v1 image`}
            label="old R2 image"
          />
          <MetadataList item={row.stale} />
          <DescriptionBlock
            label={`Old source description / caption${
              row.stale.descriptionSource
                ? ` (${sourceDisplayLabel(row.stale.descriptionSource)})`
                : ''
            }`}
            value={row.stale.description}
          />
          <div className="flex flex-wrap gap-2">
            <SourceLink href={row.stale.sourceUrl} label="Old source" />
            {row.stale.image?.originalPath ? (
              <SourceLink
                href={`${apiOrigin}${row.stale.image.originalPath}`}
                label="Old original"
              />
            ) : null}
          </div>
        </section>

        {row.webImageSource ? (
          <section className="space-y-4">
            <h3 className="font-semibold text-zinc-100">Web image source</h3>
            <ImagePanel
              src={
                row.webImageSource.thumbnailUrl || row.webImageSource.imageUrl
              }
              alt={`${row.webImageSource.sourceTitle || row.staleId} web image source`}
              label={row.webImageSource.sourceProvider || 'web source'}
            />
            <MetadataList
              item={{
                accession: row.targetAccession || row.staleId,
                title: row.webImageSource.sourceTitle,
                artist: row.webImageSource.sourceArtist,
                dateText: row.webImageSource.sourceDate,
                creditLine: row.webImageSource.sourceInstitution,
              }}
            />
            <DescriptionBlock
              label="Web source basis"
              value={row.webImageSource.matchBasis || row.webImageSource.note}
            />
            {row.webImageSource.rights || row.webImageSource.sourceType ? (
              <dl className="grid grid-cols-1 gap-2 text-sm">
                {row.webImageSource.rights ? (
                  <div className="grid grid-cols-[108px_1fr] gap-3">
                    <dt className="text-xs uppercase tracking-[0.12em] text-zinc-600">
                      Rights
                    </dt>
                    <dd className="min-w-0 text-zinc-200">
                      {row.webImageSource.rights}
                    </dd>
                  </div>
                ) : null}
                {row.webImageSource.sourceType ? (
                  <div className="grid grid-cols-[108px_1fr] gap-3">
                    <dt className="text-xs uppercase tracking-[0.12em] text-zinc-600">
                      Source type
                    </dt>
                    <dd className="min-w-0 text-zinc-200">
                      {row.webImageSource.sourceType}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <SourceLink href={row.webImageSource.pageUrl} label="Web page" />
              <SourceLink
                href={row.webImageSource.imageUrl}
                label="Direct image"
              />
              <SourceLink
                href={row.webImageSource.corroboratingUrl}
                label="Corroborating source"
              />
            </div>
          </section>
        ) : null}

        <section className="space-y-4">
          <h3 className="font-semibold text-zinc-100">Current app match</h3>
          {row.currentAppMatch ? (
            <>
              <ImagePanel
                src={
                  row.currentAppMatch.thumbnailUrl ||
                  row.currentAppMatch.imageUrl
                }
                alt={`${row.currentAppMatch.title || row.staleId} app image`}
                label={row.currentAppMatch.accession || 'current app'}
              />
              <MetadataList item={row.currentAppMatch} />
              <DescriptionBlock
                label={`Current app description${
                  row.currentAppMatch.descriptionSource
                    ? ` (${sourceDisplayLabel(
                        row.currentAppMatch.descriptionSource
                      )})`
                    : ''
                }`}
                value={row.currentAppMatch.description}
              />
              <SourceLink
                href={row.currentAppMatch.sourceUrl}
                label="App source"
              />
            </>
          ) : (
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
              No current app row is proposed for this stale image.
            </div>
          )}
        </section>

        <CandidateColumn
          title="NGS"
          candidates={row.ngsCandidates}
          fallback="No accession-safe NGS candidate is in the manifest."
        />

        <CandidateColumn
          title="Roots"
          candidates={row.rootsCandidates}
          fallback="No trusted Roots candidate is in the manifest."
        />
      </div>

      <RelatedRecordsPanel records={row.relatedRecords} />

      <div className="mt-5 border-t border-zinc-800 pt-4">
        <label className="grid gap-2 text-sm text-zinc-300">
          Reviewer note
          <textarea
            value={note}
            onChange={(event) => onNote(event.target.value)}
            rows={2}
            className="min-h-20 rounded-md border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
            placeholder="Record why this row was approved, rejected, researched, or excluded."
          />
        </label>
      </div>
    </article>
  );
}

export default function NgsReviewDiscrepanciesRoute() {
  const { manifest, apiOrigin } = useLoaderData<typeof loader>();
  const [reviewMode, setReviewMode] = useState<ReviewMode>('active');
  const [activeCategory, setActiveCategory] = useState<ReviewCategory | 'all'>(
    'all'
  );
  const [query, setQuery] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedStaleId, setSelectedStaleId] = useState<string | undefined>();
  const [verdicts, setVerdicts] = useState<Record<string, ReviewVerdict>>(() =>
    Object.fromEntries(
      manifest.rows
        .filter((row) =>
          verdictOptions.some((option) => option.value === row.defaultVerdict)
        )
        .map((row) => [row.staleId, row.defaultVerdict as ReviewVerdict])
    )
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const modeRows = useMemo(() => {
    if (reviewMode === 'all') return manifest.rows;
    if (reviewMode === 'resolved') {
      return manifest.rows.filter(
        (row) => row.resolutionState === 'resolved_approved'
      );
    }
    if (reviewMode === 'research') {
      return manifest.rows.filter(
        (row) =>
          row.resolutionState !== 'resolved_approved' &&
          row.defaultVerdict === 'needs_manual_research'
      );
    }
    if (reviewMode === 'exclude') {
      return manifest.rows.filter(
        (row) =>
          row.resolutionState !== 'resolved_approved' &&
          row.defaultVerdict === 'exclude_from_v2'
      );
    }
    return manifest.rows.filter(
      (row) => row.resolutionState !== 'resolved_approved'
    );
  }, [manifest.rows, reviewMode]);

  const categoryRows = useMemo(
    () =>
      activeCategory === 'all'
        ? modeRows
        : modeRows.filter((row) => row.category === activeCategory),
    [activeCategory, modeRows]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      normalizedQuery
        ? categoryRows.filter((row) =>
            rowSearchText(row).includes(normalizedQuery)
          )
        : categoryRows,
    [categoryRows, normalizedQuery]
  );

  const selectedRow = detailOpen
    ? rows.find((row) => row.staleId === selectedStaleId) || rows[0]
    : undefined;
  const selectRow = (staleId: string) => {
    setSelectedStaleId(staleId);
    setDetailOpen(true);
    window.setTimeout(() => {
      if (window.matchMedia('(min-width: 1280px)').matches) return;
      const detail = document.getElementById('selected-review-detail');
      const header = document.querySelector('header');
      if (!detail) return;

      const headerHeight = header?.getBoundingClientRect().height || 0;
      const top = detail.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, top - headerHeight - 48),
        behavior: 'smooth',
      });
    }, 50);
  };

  const exportPayload = useMemo(
    () => ({
      exportedAt: new Date().toISOString(),
      manifestGeneratedAt: manifest.generatedAt,
      sourceDbName: manifest.source.sourceDbName,
      appDbName: manifest.source.appDbName,
      totalRows: manifest.summary.total,
      verdicts: manifest.rows.map((row) => ({
        staleId: row.staleId,
        category: row.category,
        resolutionState: row.resolutionState || 'active',
        targetAccession: row.targetAccession || null,
        captionPolicy: row.captionPolicy || null,
        proposedStatus: row.proposedStatus,
        verdict: verdicts[row.staleId] || row.defaultVerdict || 'unreviewed',
        note: notes[row.staleId] || '',
      })),
    }),
    [manifest, notes, verdicts]
  );

  const exportJson = JSON.stringify(exportPayload, null, 2);
  const defaultVerdictCounts = useMemo(
    () =>
      manifest.rows.reduce<Record<string, number>>((counts, row) => {
        const verdict = row.defaultVerdict || 'unreviewed';
        counts[verdict] = (counts[verdict] || 0) + 1;
        return counts;
      }, {}),
    [manifest.rows]
  );
  const resolvedApproved =
    manifest.summary.resolvedApproved ||
    manifest.rows.filter((row) => row.resolutionState === 'resolved_approved')
      .length;
  const activeQueueRows =
    manifest.summary.activeRows || manifest.summary.total - resolvedApproved;
  const excludedByDefault =
    manifest.summary.activeExcludeFromV2 ||
    defaultVerdictCounts.exclude_from_v2 ||
    0;
  const reviewByDefault =
    manifest.summary.activeNeedsResearch ||
    defaultVerdictCounts.needs_manual_research ||
    0;
  const legacyMetadataRows =
    manifest.summary.countsByCategory.no_live_source_match || 0;
  const imageOnlyRows =
    manifest.summary.countsByCategory.no_title_orphan_image || 0;
  const rootsAudit = manifest.rootsCollectionAudit;
  const rootsAuditSummary = rootsAudit?.summary;
  const nonNgsRootsCount =
    rootsAuditSummary?.nonNgsRoots || rootsAudit?.nonNgsRoots?.length || 0;
  const extraNonNgsRoots = (rootsAudit?.extraUrls || []).filter(
    (entry) => entry.collectionVerdict === 'not_ngs'
  );
  const modeCounts: Record<ReviewMode, number> = {
    active: activeQueueRows,
    research: reviewByDefault,
    exclude: excludedByDefault,
    resolved: resolvedApproved,
    all: manifest.summary.total,
  };
  const activeCategoryLabel =
    activeCategory === 'all'
      ? 'All categories'
      : manifest.categoryLabels[activeCategory];

  const copyExport = async () => {
    await navigator.clipboard.writeText(exportJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const downloadExport = () => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ngs-discrepancy-verdicts-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[#080809] text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-4 lg:px-6">
        <header className="sticky top-0 z-20 -mx-4 border-b border-zinc-800 bg-[#080809]/95 px-4 py-2 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Internal review
              </p>
              <h1 className="text-2xl font-semibold tracking-normal text-zinc-50">
                NGS / Roots discrepancy review
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyExport}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-zinc-500 hover:bg-zinc-900"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy verdict JSON'}
              </button>
              <button
                type="button"
                onClick={downloadExport}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-300 px-3 text-sm font-semibold text-black hover:bg-cyan-200"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Export verdict JSON
              </button>
            </div>
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <SummaryMetric label="Active" value={activeQueueRows} />
            <SummaryMetric label="Resolved" value={resolvedApproved} />
            <SummaryMetric label="Research" value={reviewByDefault} />
            <SummaryMetric label="Exclude" value={excludedByDefault} />
            <SummaryMetric label="Total" value={manifest.summary.total} />
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-1">
            {(Object.keys(reviewModeLabels) as ReviewMode[]).map((mode) => {
              const selected = reviewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setReviewMode(mode);
                    setActiveCategory('all');
                    setSelectedStaleId(undefined);
                    setDetailOpen(false);
                  }}
                  className={cx(
                    'h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium transition',
                    selected
                      ? 'border-cyan-300 bg-cyan-300 text-black'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900'
                  )}
                >
                  {reviewModeLabels[mode]}{' '}
                  <span className="font-mono">{modeCounts[mode]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {categoryOrder.map((category) => {
              const selected = activeCategory === category;
              const label =
                category === 'all' ? 'All' : manifest.categoryLabels[category];
              const count =
                category === 'all'
                  ? modeRows.length
                  : modeRows.filter((row) => row.category === category).length;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setActiveCategory(category);
                    setSelectedStaleId(undefined);
                    setDetailOpen(false);
                  }}
                  className={cx(
                    'h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium transition',
                    selected
                      ? 'border-cyan-300 bg-cyan-300 text-black'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900'
                  )}
                >
                  {label} <span className="font-mono">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2">
            <label className="relative block min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                aria-hidden="true"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setDetailOpen(false);
                  setSelectedStaleId(undefined);
                }}
                aria-label="Search review rows"
                placeholder="Search accession, title, artist, source"
                className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-10 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-300"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setDetailOpen(false);
                    setSelectedStaleId(undefined);
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>
        </header>

        <section
          className={cx(
            'grid gap-5',
            selectedRow
              ? 'xl:grid-cols-[minmax(0,1fr)_minmax(520px,0.78fr)]'
              : ''
          )}
        >
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-50">
                  {reviewModeLabels[reviewMode]} / {activeCategoryLabel}
                </h2>
                <p className="text-sm text-zinc-500">
                  Showing{' '}
                  <span className="font-mono text-zinc-200">{rows.length}</span>{' '}
                  of{' '}
                  <span className="font-mono text-zinc-200">
                    {categoryRows.length}
                  </span>
                </p>
              </div>
            </div>
            <DecisionQueue
              rows={rows}
              apiOrigin={apiOrigin}
              selectedStaleId={selectedRow?.staleId}
              onSelect={selectRow}
            />
          </div>

          {selectedRow ? (
            <div
              id="selected-review-detail"
              className="order-first min-w-0 scroll-mt-56 xl:order-none xl:sticky xl:top-56 xl:max-h-[calc(100vh-15rem)] xl:overflow-auto"
            >
              <ReviewRowCard
                key={selectedRow.staleId}
                row={selectedRow}
                apiOrigin={apiOrigin}
                verdict={verdicts[selectedRow.staleId]}
                note={notes[selectedRow.staleId] || ''}
                onVerdict={(verdict) =>
                  setVerdicts((current) => ({
                    ...current,
                    [selectedRow.staleId]: verdict,
                  }))
                }
                onNote={(note) =>
                  setNotes((current) => ({
                    ...current,
                    [selectedRow.staleId]: note,
                  }))
                }
                onClose={() => setDetailOpen(false)}
              />
            </div>
          ) : null}
        </section>

        <details className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Audit details
          </summary>
          <div className="mt-3 space-y-4">
            <p className="text-sm leading-6 text-zinc-400">
              {manifest.source.rule}
            </p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric
                label="Legacy metadata"
                value={legacyMetadataRows}
              />
              <SummaryMetric label="Image-only" value={imageOnlyRows} />
            </div>

            {rootsAudit ? (
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                  Roots NGS-only audit: {nonNgsRootsCount} non-NGS Roots links,{' '}
                  {rootsAuditSummary?.unknownRoots || 0} unknown
                </div>
                <p className="text-sm leading-6 text-zinc-400">
                  {rootsAudit.rule ||
                    'Only Roots pages whose Collection of field is National Gallery Singapore are trusted for NGS enrichment.'}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryMetric
                    label="Roots links"
                    value={rootsAuditSummary?.sourceRowsWithRootsUrl || 0}
                  />
                  <SummaryMetric
                    label="CSV matched"
                    value={rootsAuditSummary?.csvMatched || 0}
                  />
                  <SummaryMetric label="Non-NGS" value={nonNgsRootsCount} />
                  <SummaryMetric
                    label="Unknown"
                    value={rootsAuditSummary?.unknownRoots || 0}
                  />
                  <SummaryMetric
                    label="Live checks"
                    value={rootsAuditSummary?.liveFetched || 0}
                  />
                </div>
                {extraNonNgsRoots.length ? (
                  <div className="flex flex-wrap gap-2">
                    {extraNonNgsRoots.map((entry) => (
                      <SourceLink
                        key={entry.rootsUrl || entry.rootsAccession}
                        href={entry.rootsUrl}
                        label={`${entry.rootsAccession || 'extra Roots'} not NGS`}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="grid gap-3 lg:grid-cols-3">
              {manifest.regressionChecks.map((check) => (
                <div
                  key={check.id}
                  className="rounded-md border border-zinc-800 bg-black/30 p-3 text-sm"
                >
                  <div className="font-mono text-xs text-zinc-500">
                    {check.id}
                  </div>
                  <div className="mt-1 text-zinc-200">{check.expected}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    manifest: {text(check.actual)}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </details>
      </div>
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </div>
      <div className="font-mono text-lg text-zinc-50">{value}</div>
    </div>
  );
}
