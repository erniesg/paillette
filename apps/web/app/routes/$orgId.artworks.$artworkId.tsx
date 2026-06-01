import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { CaptionSourceToggle } from '~/components/artwork/caption-source-toggle';
import { CitationPanel } from '~/components/artwork/citation-panel';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';
import { MetadataSourceToggle } from '~/components/artwork/metadata-source-toggle';
import { NoImagePlaceholder } from '~/components/artwork/no-image-placeholder';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import { isHiddenPublicNgsArtwork } from '~/lib/public-ngs-visibility';
import { getSafeSearchReturnPath } from '~/lib/search-result-sections';
import {
  getGeneratedCaptionText,
  getNgsUrl,
  getPublicArtist,
  getPublicCatalogueRowGroups,
  getPublicDescription,
  getPublicDescriptionDetailList,
  getPublicImageUrl,
  getPublicThumbnailUrl,
  getPublicTitle,
  getRootsUrl,
} from '~/lib/public-artwork-metadata';
import { trackPublicUsageEvent } from '~/lib/usage-events';

export const shouldHidePublicArtworkDetail = (
  _requestedOrgId: string,
  preferredRouteId: string,
  artwork: Record<string, any>
) => preferredRouteId === 'ngs' && isHiddenPublicNgsArtwork(artwork);

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const artwork = data?.artwork;
  const description = artwork ? getPublicDescription(artwork) : null;
  const title = artwork ? getPublicTitle(artwork) : 'Artwork';
  return [
    { title: `${title} - Paillette` },
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
    const preferredRouteId = getPreferredOrgRouteId(orgId, gallery.slug);
    if (shouldHidePublicArtworkDetail(orgId, preferredRouteId, artwork)) {
      throw new Response('Artwork not found', { status: 404 });
    }
    const url = new URL(request.url);

    return {
      gallery,
      artwork,
      preferredRouteId,
      returnToSearchPath: getSafeSearchReturnPath(
        url.searchParams.get('from'),
        preferredRouteId
      ),
    };
  } catch {
    throw new Response('Artwork not found', { status: 404 });
  }
}

const clickableCatalogueLabels = new Set([
  'artist',
  'date',
  'medium',
  'geographic association',
  'credit line',
]);

const getCatalogueRowSearchQuery = (label: string, value: string) => {
  if (!clickableCatalogueLabels.has(label.toLowerCase())) return null;
  return value.trim() || null;
};

export default function ArtworkDetailPage() {
  const { gallery, artwork, preferredRouteId, returnToSearchPath } =
    useLoaderData<typeof loader>();
  const descriptionDetailsList = getPublicDescriptionDetailList(artwork);
  const rootsDescriptionDetails = descriptionDetailsList[0] || null;
  const generatedCaptionText = getGeneratedCaptionText(artwork);
  const imageUrl = getPublicImageUrl(artwork);
  const thumbnailUrl = getPublicThumbnailUrl(artwork);
  const ngsUrl = getNgsUrl(artwork);
  const rootsUrl = getRootsUrl(artwork);
  const catalogueGroups = getPublicCatalogueRowGroups(artwork);
  const title = getPublicTitle(artwork);
  const artist = getPublicArtist(artwork);

  const trackArtworkInteraction = (
    type: 'view' | 'click' | 'citation_copy',
    action: string,
    metadata: Record<string, unknown> = {}
  ) => {
    trackPublicUsageEvent(preferredRouteId, {
      queryType:
        type === 'citation_copy'
          ? 'public_citation_copy'
          : 'public_artwork_interaction',
      orgId: gallery.id,
      interaction: {
        type,
        action,
        artworkId: artwork.id,
        orgId: artwork.orgId || artwork.galleryId || gallery.id,
        metadata: {
          title,
          artist,
          accessionNumber:
            artwork.metadata?.accessionNumber ||
            artwork.metadata?.accession_number ||
            null,
          sourceUrl: getNgsUrl(artwork) || getRootsUrl(artwork) || undefined,
          ...metadata,
        },
      },
      metadata: {
        routeOrgId: preferredRouteId,
        surface: 'artwork_detail',
      },
    });
  };

  useEffect(() => {
    trackArtworkInteraction('view', 'artwork_page_open', {
      referrer: document.referrer || null,
      pagePath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
  }, [artwork.id]);

  return (
    <div className="themeable-surface min-h-screen bg-[#0b0b0e] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0b0e]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link
            to={returnToSearchPath || `/${preferredRouteId}/search`}
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
              <ImageWithFallback
                src={imageUrl}
                fallbackSrc={thumbnailUrl}
                alt={title}
                className="max-h-[76vh] w-full object-contain"
                fallback={
                  <NoImagePlaceholder className="h-80 rounded-md text-white/25" />
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/35">
              Artwork
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-tight text-white">
              {title}
            </h1>
            {artist && <p className="mt-2 text-lg text-white/65">{artist}</p>}
          </div>

          {(rootsDescriptionDetails || generatedCaptionText) && (
            <Section title="Captions">
              <CaptionSourceToggle
                rootsCaption={
                  rootsDescriptionDetails
                    ? {
                        text: rootsDescriptionDetails.text,
                        sourceLabel: rootsDescriptionDetails.sourceLabel,
                      }
                    : null
                }
                generatedCaption={
                  generatedCaptionText
                    ? {
                        text: generatedCaptionText,
                        sourceLabel: 'Generated by Paillette AI',
                      }
                    : null
                }
              />
            </Section>
          )}

          {catalogueGroups.length > 0 && (
            <MetadataSourceToggle
              className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-5"
              groups={catalogueGroups}
              getSearchHref={(label, value) => {
                const searchQuery = getCatalogueRowSearchQuery(label, value);
                return searchQuery
                  ? `/${preferredRouteId}/search?q=${encodeURIComponent(
                      searchQuery
                    )}`
                  : null;
              }}
            />
          )}

          <CitationPanel
            artwork={artwork}
            onCopyCitation={(copyMetadata) =>
              trackArtworkInteraction(
                'citation_copy',
                'citation_copy',
                copyMetadata
              )
            }
          />

          <Section
            title="Public Portal Links"
            eyebrow="National Gallery Singapore / Roots NHB"
          >
            <div className="flex flex-wrap gap-2">
              {ngsUrl && (
                <SourceLink
                  href={ngsUrl}
                  label="National Gallery Singapore record"
                  onClick={() =>
                    trackArtworkInteraction('click', 'source_record_open', {
                      source: 'ngs',
                    })
                  }
                />
              )}
              {rootsUrl && (
                <SourceLink
                  href={rootsUrl}
                  label="Roots NHB record"
                  onClick={() =>
                    trackArtworkInteraction('click', 'source_record_open', {
                      source: 'roots',
                    })
                  }
                />
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
  eyebrow?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-5">
      {eyebrow ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={
          eyebrow
            ? 'mt-1 text-lg font-semibold text-white'
            : 'text-lg font-semibold text-white'
        }
      >
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SourceLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-cyan-200/75 transition-colors hover:bg-white/[0.08] hover:text-cyan-200"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
