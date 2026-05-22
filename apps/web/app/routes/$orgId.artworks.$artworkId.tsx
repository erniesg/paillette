import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import { formatDimensions } from '~/lib/utils';
import type { Artwork } from '~/types';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const artwork = data?.artwork;
  return [
    { title: `${artwork?.title || 'Artwork'} - Paillette` },
    {
      name: 'description',
      content: artwork?.description || 'Artwork detail and source metadata',
    },
  ];
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { orgId, artworkId } = params;
  if (!orgId || !artworkId) {
    throw new Response('Org ID and artwork ID are required', { status: 400 });
  }

  try {
    const api = getApiClientForRequest(request);
    const gallery = await api.getGallery(orgId);
    const artwork = await api.getArtwork(gallery.id, artworkId);

    return {
      gallery,
      artwork,
      preferredRouteId: getPreferredOrgRouteId(orgId, gallery.slug),
    };
  } catch {
    throw new Response('Artwork not found', { status: 404 });
  }
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const getCustomMetadata = (artwork: Artwork) =>
  asRecord((artwork as Artwork & Record<string, any>).custom_metadata || artwork.metadata);

const getImageUrl = (artwork: Artwork) =>
  artwork.imageUrl || artwork.image_url || artwork.thumbnailUrl || artwork.thumbnail_url || null;

const getGeneratedCaption = (artwork: Artwork) => {
  const custom = getCustomMetadata(artwork);
  return asRecord(custom.generated_caption || custom.generatedCaption);
};

const getSourceRecords = (artwork: Artwork) => {
  const custom = getCustomMetadata(artwork);
  return asRecord(custom.source_records || custom.sourceRecords);
};

const getRootsUrl = (artwork: Artwork) => {
  const custom = getCustomMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return (
    asText(custom.roots_listing_url) ||
    asText(sourceRecords.roots_listing_url) ||
    asText(sourceRecords.rootsListingUrl)
  );
};

const getNgsUrl = (artwork: Artwork) => {
  const custom = getCustomMetadata(artwork);
  const sourceRecords = getSourceRecords(artwork);
  return (
    artwork.source_url ||
    asText(custom.ngs_detail_url) ||
    asText(sourceRecords.ngs_detail_url) ||
    asText(sourceRecords.ngsDetailUrl)
  );
};

const compactRows = (rows: Array<[string, unknown]>) =>
  rows.filter(([, value]) => value !== null && value !== undefined && value !== '');

const previewJson = (value: unknown) => JSON.stringify(value, null, 2);

export default function ArtworkDetailPage() {
  const { gallery, artwork, preferredRouteId } = useLoaderData<typeof loader>();
  const custom = getCustomMetadata(artwork);
  const caption = getGeneratedCaption(artwork);
  const sourceRecords = getSourceRecords(artwork);
  const fieldSources = asRecord(artwork.field_sources || custom.field_sources);
  const imageUrl = getImageUrl(artwork);
  const ngsUrl = getNgsUrl(artwork);
  const rootsUrl = getRootsUrl(artwork);
  const additionalMetadata = Object.entries(custom).filter(
    ([key]) => !['generated_caption', 'generatedCaption', 'source_records', 'sourceRecords'].includes(key)
  );

  const catalogRows = compactRows([
    ['Artist', artwork.artist],
    ['Date', artwork.date_text || artwork.year],
    ['Medium', artwork.medium],
    ['Classification', artwork.classification],
    ['Culture', artwork.culture],
    ['Origin', artwork.origin],
    ['Dimensions', formatDimensions(artwork.dimensions)],
    ['Accession', artwork.accession_number],
    ['Rights', artwork.rights],
    ['Credit line', artwork.credit_line],
    ['Source institution', artwork.source_institution],
    ['Source collection', artwork.source_collection],
    ['Source record ID', artwork.source_record_id],
  ]);

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0b0e]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link
            to={`/${preferredRouteId}/search`}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Search
          </Link>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            {gallery.name}
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:px-8">
        <section>
          <div className="sticky top-20">
            <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.025] p-4">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={artwork.title || 'Artwork'}
                  className="max-h-[76vh] w-full rounded-md object-contain"
                />
              ) : (
                <div className="flex h-80 w-full items-center justify-center rounded-md bg-white/[0.03] text-white/35">
                  <ImageIcon className="mr-2 h-5 w-5" />
                  No image
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ngsUrl && <SourceLink href={ngsUrl} label="Open NGS record" />}
              {rootsUrl && <SourceLink href={rootsUrl} label="Open Roots record" />}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/35">
              Artwork
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-tight text-white">
              {artwork.title || 'Untitled'}
            </h1>
            {artwork.artist && (
              <p className="mt-2 text-lg text-white/65">{artwork.artist}</p>
            )}
          </div>

          {artwork.description && (
            <Section title="Description" eyebrow="Catalogue text">
              <p className="leading-relaxed text-white/70">{artwork.description}</p>
            </Section>
          )}

          <Section title="Catalogue Metadata" eyebrow="NGS / source fields">
            <dl className="grid gap-3 sm:grid-cols-2">
              {catalogRows.map(([label, value]) => (
                <div key={label} className="rounded-md border border-white/[0.08] bg-black/20 p-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm text-white/75">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {Object.keys(caption).length > 0 && (
            <Section title="Generated Caption" eyebrow="AI generated, not catalogue metadata">
              <p className="leading-relaxed text-white/70">
                {caption.text || 'No caption text available.'}
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                {compactRows([
                  ['Model', caption.model],
                  ['Prompt', caption.prompt_version],
                  ['Generated', caption.generated_at],
                ]).map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-xs text-white/55">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {Object.keys(fieldSources).length > 0 && (
            <Section title="Field Sources" eyebrow="Per-field attribution">
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(fieldSources).map(([field, source]) => (
                  <div
                    key={field}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                      {field}
                    </span>
                    <span className="text-right text-xs text-white/65">
                      {typeof source === 'string' ? source : previewJson(source)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {additionalMetadata.length > 0 && (
            <Section title="Additional Metadata" eyebrow="Ingested custom fields">
              <div className="space-y-2">
                {additionalMetadata.map(([key, value]) => (
                  <details
                    key={key}
                    className="rounded-md border border-white/[0.08] bg-black/20 px-3 py-2"
                  >
                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                      {key}
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-white/60">
                      {typeof value === 'string' ? value : previewJson(value)}
                    </pre>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {(sourceRecords.ngs || sourceRecords.roots) && (
            <Section title="Raw Source Records" eyebrow="NGS and Roots payloads">
              <div className="space-y-3">
                {sourceRecords.ngs && (
                  <RawRecord label="NGS raw record" value={sourceRecords.ngs} />
                )}
                {sourceRecords.roots && (
                  <RawRecord label="Roots raw record" value={sourceRecords.roots} />
                )}
              </div>
            </Section>
          )}
        </section>
      </main>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-cyan-200/75 transition-colors hover:bg-white/[0.08] hover:text-cyan-200"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function RawRecord({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-md border border-white/[0.08] bg-black/20 p-3">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
        {label}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-white/60">
        {previewJson(value)}
      </pre>
    </details>
  );
}
