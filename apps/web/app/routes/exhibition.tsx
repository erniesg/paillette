/**
 * The exhibition, as a page anyone can open.
 *
 * This is the artifact. Everything else in the loop is a working surface — a
 * light table with two people's hands on it — and this is what is left when
 * they stop: a title, a statement, an ordered hang, a label per work, and an
 * honest colophon saying where the pictures came from and who wrote the words.
 *
 * Three constraints shaped it, and they are the same three a gallery's own
 * microsite has:
 *
 *  - **It has to survive being opened cold.** By someone in a new browser who
 *    has never used Paillette, from a link in a message. So the show travels
 *    in the URL (see `~/lib/exhibition-link`) and the loader re-fetches every
 *    record by id, on the server, before a single pixel is sent. There is no
 *    session to depend on and nothing to hydrate.
 *  - **The works are the only saturated thing.** Charcoal ground, one serif
 *    for the prose, one mono for catalogue data, and no colour anywhere the
 *    paintings are not.
 *  - **Credit is not a footnote to be skipped.** The collection, the
 *    open-access status and which labels an agent wrote are all on the page,
 *    and the label credit is a mark on each label rather than a claim in the
 *    small print that nobody checks against anything.
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import {
  decodeExhibitionLink,
  EXHIBITION_LINK_PARAM,
} from '~/lib/exhibition-link';
import {
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

interface HungWork {
  artworkId: string;
  title: string;
  artist: string | null;
  date: string | null;
  medium: string | null;
  accession: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  label: string | null;
  labelByAgent: boolean;
}

interface ExhibitionPage {
  title: string;
  statement: string | null;
  statementByAgent: boolean;
  works: HungWork[];
  /** Works in the link the catalogue could not resolve. Reported, not hidden. */
  missing: number;
  institution: string;
  institutionUrl: string;
  rights: string;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * The institution's own public IIIF URL, not Paillette's asset URL.
 *
 * Paillette's `/assets/:id/content` needs a session, so it renders as a broken
 * image for exactly the visitor this page exists for. Open-access records
 * carry the source URL in their provenance blob; this is the same resolution
 * `artwork-summary.ts` does for the agent, for the same reason.
 */
const readImageUrl = (artwork: Record<string, unknown>): string | null => {
  const provenance = artwork.provenance;
  if (typeof provenance === 'string') {
    try {
      const parsed = JSON.parse(provenance) as { source_image_url?: unknown };
      const url = asText(parsed?.source_image_url);
      if (url && /^https?:\/\//i.test(url)) return url;
    } catch {
      // Not every collection stores provenance as JSON.
    }
  }
  const fallback = asText(artwork.image_url);
  return fallback && /^https?:\/\//i.test(fallback) ? fallback : null;
};

/** IIIF puts the size in the path; a wall does not need the master file. */
const IIIF_FULL_SIZE = /\/full\/[^/]+\/0\//;
const atWidth = (url: string | null, width: number) =>
  url && IIIF_FULL_SIZE.test(url)
    ? url.replace(IIIF_FULL_SIZE, `/full/${width},/0/`)
    : url;

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const encoded = url.searchParams.get(EXHIBITION_LINK_PARAM);
  if (!encoded) throw new Response('Not found', { status: 404 });

  const payload = await decodeExhibitionLink(encoded);
  if (!payload) throw new Response('Not found', { status: 404 });
  if (!isAllowedPublicSearchRouteId(payload.collectionId)) {
    throw new Response('Not found', { status: 404 });
  }

  const env = getServerEnv(context);
  const orgId = resolvePublicSearchOrgId(payload.collectionId);
  const apiBase = getApiBaseUrl(env);

  // Every record is fetched by id, on the server, before anything is rendered.
  // Ids are session-resolvable in the app; on a cold URL there is no session,
  // so the catalogue is the only thing that can say what these pictures are.
  const records = await Promise.all(
    payload.works.map(async (work) => {
      // Ids go in the path raw, deliberately. NGA ids look like
      // `open-access-art:nga:43632`, and the API's anonymous-read allowlist
      // matches `[^/%]+` — so a percent-encoded colon takes the request off
      // the public path and gets a 401 instead of the record. A slash or a
      // percent in an id would break the route, so those are refused here
      // rather than sent.
      if (/[/%]/.test(work.artworkId)) return null;
      try {
        const response = await fetch(
          `${apiBase}/orgs/${orgId}/artworks/${work.artworkId}`,
          { signal: request.signal }
        );
        if (!response.ok) return null;
        const body = (await response.json()) as {
          success?: boolean;
          data?: Record<string, unknown>;
        };
        return body?.success && body.data ? body.data : null;
      } catch {
        // One unresolvable work must not take the exhibition down with it.
        return null;
      }
    })
  );

  const works: HungWork[] = [];
  payload.works.forEach((work, index) => {
    const record = records[index];
    if (!record) return;
    works.push({
      artworkId: work.artworkId,
      title: asText(record.title) ?? 'Untitled',
      artist: asText(record.artist),
      date: asText(record.date_text) ?? (record.year ? String(record.year) : null),
      medium: asText(record.medium) ?? asText(record.classification),
      accession: asText(record.accession_number),
      sourceUrl: asText(record.source_url),
      imageUrl: readImageUrl(record),
      label: work.label,
      labelByAgent: work.labelByAgent,
    });
  });

  if (!works.length) throw new Response('Not found', { status: 404 });

  const page: ExhibitionPage = {
    title: payload.title ?? 'Untitled',
    statement: payload.statement,
    statementByAgent: payload.statementByAgent,
    works,
    missing: payload.works.length - works.length,
    institution: 'National Gallery of Art, Washington',
    institutionUrl: 'https://www.nga.gov/open-access-images.html',
    rights:
      'CC0 open access. The Gallery believes these works are in the public domain in the United States.',
  };

  return json(page, {
    headers: {
      // The link is the record, so the answer for a given link never changes.
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
    },
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Exhibition — Paillette' }];
  return [
    { title: `${data.title} — Paillette` },
    ...(data.statement
      ? [{ name: 'description', content: data.statement }]
      : []),
    { property: 'og:title', content: data.title },
    ...(data.statement
      ? [{ property: 'og:description', content: data.statement }]
      : []),
    ...(data.works[0]?.imageUrl
      ? [{ property: 'og:image', content: atWidth(data.works[0].imageUrl, 1200) }]
      : []),
  ];
};

/**
 * The label credit, as a mark rather than a sentence.
 *
 * A museum prints who wrote its labels; it does not print it under each one.
 * The mark carries the fact and the colophon says what the mark means, once,
 * at the bottom where a credit line belongs.
 */
const AGENT_MARK = '·⁠·';

export default function ExhibitionPage() {
  const page = useLoaderData<typeof loader>();
  const agentWritten = page.works.filter((work) => work.labelByAgent).length;

  return (
    <main className="exhibition-page">
      <header className="exhibition-masthead">
        <h1 className="exhibition-title">{page.title}</h1>
        {page.statement && (
          <p
            className="exhibition-statement"
            data-provenance={page.statementByAgent ? 'agent' : 'human'}
          >
            {page.statement}
          </p>
        )}
        <p className="exhibition-count lt-catalogue">
          {page.works.length} {page.works.length === 1 ? 'work' : 'works'}
        </p>
      </header>

      <ol className="exhibition-hang">
        {page.works.map((work, index) => (
          <li key={work.artworkId} className="exhibition-work">
            <figure>
              {work.imageUrl ? (
                <img
                  src={atWidth(work.imageUrl, 1400) ?? work.imageUrl}
                  alt={work.label ?? work.title}
                  loading={index < 2 ? 'eager' : 'lazy'}
                  className="exhibition-image"
                />
              ) : (
                <div className="exhibition-image exhibition-image-missing" />
              )}

              <figcaption className="exhibition-caption">
                {/* Catalogue first, the way a wall label is set: who, what,
                    when, in what — and then the sentence about why it is here. */}
                <p className="exhibition-line">
                  <span className="exhibition-work-title">{work.title}</span>
                  {work.artist && <span>{work.artist}</span>}
                  {work.date && <span>{work.date}</span>}
                  {work.medium && <span>{work.medium}</span>}
                </p>

                {work.label && (
                  <p className="exhibition-label">
                    {work.label}
                    {work.labelByAgent && (
                      <span
                        className="exhibition-mark"
                        aria-label="Label written by an agent"
                        title="Label written by an agent"
                      >
                        {' '}
                        {AGENT_MARK}
                      </span>
                    )}
                  </p>
                )}

                <p className="exhibition-accession lt-catalogue">
                  {work.accession && <span>{work.accession}</span>}
                  {work.sourceUrl && (
                    <a href={work.sourceUrl} rel="noreferrer noopener">
                      Catalogue record
                    </a>
                  )}
                </p>
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>

      {/*
        The colophon. Terse, and every line in it is a fact somebody could
        check: where the pictures came from, what the rights are, how many of
        the labels a machine wrote, and — when the catalogue could not resolve
        something the link asked for — that it happened.
      */}
      <footer className="exhibition-colophon lt-catalogue">
        <p>
          <a href={page.institutionUrl} rel="noreferrer noopener">
            {page.institution}
          </a>
        </p>
        <p>{page.rights}</p>
        {agentWritten > 0 && (
          <p>
            {AGENT_MARK} {agentWritten} of {page.works.length}{' '}
            {page.works.length === 1 ? 'label' : 'labels'} written by an agent
          </p>
        )}
        {page.missing > 0 && (
          <p>
            {page.missing} {page.missing === 1 ? 'work' : 'works'} in this link
            could not be resolved in the catalogue
          </p>
        )}
        <p>
          <a href="/nga/search">Assembled in Paillette</a>
        </p>
      </footer>
    </main>
  );
}
