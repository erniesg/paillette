import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import {
  getGeneratedCaptionRecord,
  getNgsUrl,
  getPublicCatalogueRows,
  getPublicDescription,
  getPublicDescriptionDetails,
  getPublicImageUrl,
  getRootsUrl,
} from '~/lib/public-artwork-metadata';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const artwork = data?.artwork;
  const description = artwork ? getPublicDescription(artwork) : null;
  return [
    { title: `${artwork?.title || 'Artwork'} - Paillette` },
    {
      name: 'description',
      content: description || 'Artwork detail and source metadata',
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

const compactRows = (rows: Array<[string, unknown]>) =>
  rows.filter(
    ([, value]) => value !== null && value !== undefined && value !== ''
  );

export default function ArtworkDetailPage() {
  const { gallery, artwork, preferredRouteId } = useLoaderData<typeof loader>();
  const caption = getGeneratedCaptionRecord(artwork);
  const descriptionDetails = getPublicDescriptionDetails(artwork);
  const imageUrl = getPublicImageUrl(artwork);
  const ngsUrl = getNgsUrl(artwork);
  const rootsUrl = getRootsUrl(artwork);
  const catalogRows = getPublicCatalogueRows(artwork);

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

          {descriptionDetails && (
            <Section
              title="Catalogue text"
              eyebrow={descriptionDetails.sourceLabel}
            >
              <p className="leading-relaxed text-white/70">
                {descriptionDetails.text}
              </p>
            </Section>
          )}

          <Section
            title="Catalogue Metadata"
            eyebrow="Public National Gallery Singapore / NHB Roots fields"
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              {catalogRows.map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-md border border-white/[0.08] bg-black/20 p-3"
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm text-white/75">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {Object.keys(caption).length > 0 && (
            <Section
              title="AI caption"
              eyebrow="AI generated, not catalogue metadata"
            >
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
                    <dd className="mt-1 break-words text-xs text-white/55">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <Section
            title="Public Portal Links"
            eyebrow="National Gallery Singapore / NHB Roots"
          >
            <div className="flex flex-wrap gap-2">
              {ngsUrl && (
                <SourceLink
                  href={ngsUrl}
                  label="National Gallery Singapore record"
                />
              )}
              {rootsUrl && (
                <SourceLink href={rootsUrl} label="NHB Roots record" />
              )}
              {!ngsUrl && !rootsUrl && (
                <p className="text-sm text-white/45">
                  No public source links available.
                </p>
              )}
            </div>
          </Section>
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
