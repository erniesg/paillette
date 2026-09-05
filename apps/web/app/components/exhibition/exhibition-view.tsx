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
 *    has never used Paillette, from a link in a message. Every record is
 *    re-fetched on the server before a pixel is sent (see
 *    `~/lib/exhibition-page.server`); there is no session to depend on and
 *    nothing to hydrate.
 *  - **The works are the only saturated thing.** Charcoal ground, one serif
 *    for the prose, one mono for catalogue data, and no colour anywhere the
 *    paintings are not.
 *  - **Credit is not a footnote to be skipped.** The collection, the
 *    open-access status and which labels an agent wrote are all on the page,
 *    and the label credit is a mark on each label rather than a claim in the
 *    small print that nobody checks against anything.
 *
 * One renderer, two routes. `/e/:code` and `/exhibition?e=…` name the same
 * object in different ways and must not drift into two different pages.
 */

import { Suspense, lazy } from 'react';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import {
  DEFAULT_TEMPLATE,
  stripTemplate,
  type ExhibitionTemplate,
} from '~/lib/room/template';
import { SOCIAL_CARD_WIDTH, WALL_IMAGE_WIDTH, atWidth } from '~/lib/share/iiif';
import {
  TemplateSwitch,
  useRoomAvailable,
} from './room/template-switch';

/**
 * The room is fetched, not bundled.
 *
 * `import()` rather than a plain import so that the flat page — the default,
 * and what every cold shared link opens — carries none of it. Three is already
 * behind a second `import()` inside the scene, and this is the layer above it:
 * the planner, the dimension parser and the focused view are code the page
 * view never runs, and a page whose whole argument is that it opens fast
 * should not ship them. Measured: the difference is 3.4 kB gzipped on the
 * critical path, and 181 kB behind it.
 *
 * Never rendered on the server — `available` is false until the capability
 * check has run — so `React.lazy` has nothing to hydrate and needs no
 * fallback beyond the charcoal ground it appears against.
 */
const RoomView = lazy(() =>
  import('./room/room-view').then((module) => ({ default: module.RoomView }))
);

/**
 * Who wrote a label is **ink**, not a mark and certainly not a tooltip.
 *
 * This page used to hang a `··` glyph off every agent-written label with
 * `title` and `aria-label` both reading "Label written by an agent" — a
 * tooltip restating a mark that existed only to need the tooltip. Two pieces
 * of chrome for one bit of information.
 *
 * The rule down the left of each label carries it instead, in the same two
 * inks the statement, the wall label and the board already use, switched by
 * the same `data-provenance` attribute. Nothing to hover, nothing to read, and
 * the convention is already learned by the time anyone reaches this page. The
 * colophon still prints the count once at the bottom, which is where a museum
 * puts "labels written by…" and is also the non-colour statement of the fact.
 */

/**
 * What a link looks like when it is pasted.
 *
 * The title, the statement as the description, the lead work as the image —
 * which is most of what makes a link feel shareable rather than like a URL
 * somebody is asking you to trust. `summary_large_image` because the picture
 * is the point; a `summary` card crops it to a thumbnail beside the text.
 */
export const exhibitionMeta = (page: ExhibitionPage | undefined) => {
  if (!page) return [{ title: 'Exhibition — Paillette' }];

  const image = atWidth(
    page.works.find((work) => work.imageUrl)?.imageUrl ?? null,
    SOCIAL_CARD_WIDTH
  );

  return [
    { title: `${page.title} — Paillette` },
    ...(page.statement ? [{ name: 'description', content: page.statement }] : []),
    { property: 'og:type', content: 'article' },
    { property: 'og:site_name', content: 'Paillette' },
    { property: 'og:title', content: page.title },
    ...(page.statement
      ? [{ property: 'og:description', content: page.statement }]
      : []),
    // One show is one document however it is being drawn, so the template
    // never reaches a canonical URL or an unfurl card.
    { property: 'og:url', content: stripTemplate(page.canonicalUrl) },
    ...(image
      ? [
          { property: 'og:image', content: image },
          // Crawlers that will not fetch the image still lay out the card if
          // they are told its shape, and the alt text is what a screen reader
          // in Slack reads out.
          { property: 'og:image:width', content: String(SOCIAL_CARD_WIDTH) },
          { property: 'og:image:alt', content: page.title },
          { name: 'twitter:image', content: image },
        ]
      : []),
    {
      name: 'twitter:card',
      content: image ? 'summary_large_image' : 'summary',
    },
    { name: 'twitter:title', content: page.title },
    ...(page.statement
      ? [{ name: 'twitter:description', content: page.statement }]
      : []),
    { tagName: 'link', rel: 'canonical', href: stripTemplate(page.canonicalUrl) },
  ];
};

/**
 * One show, two ways of standing in front of it.
 *
 * The template is read from the URL by the route and arrives here as a prop,
 * so both `/e/:code` and `/exhibition?e=…` pick it up without either of them
 * knowing how a room is drawn. The default is the page and stays the default:
 * a link opened cold on an unknown device lands here.
 *
 * `available` is false on the server and for one frame after hydration, which
 * is why a `?v=room` link renders the page first and swaps. On a device that
 * cannot draw a room it simply never swaps, and the word ROOM is never
 * offered — the degradation is that there is nothing to degrade.
 */
export const ExhibitionView = ({
  page,
  template = DEFAULT_TEMPLATE,
}: {
  page: ExhibitionPage;
  template?: ExhibitionTemplate;
}) => {
  const agentWritten = page.works.filter((work) => work.labelByAgent).length;
  const available = useRoomAvailable();

  if (template === 'room' && available) {
    return (
      <Suspense fallback={<main className="exhibition-room" />}>
        <RoomView page={page} template={template} available={available} />
      </Suspense>
    );
  }

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
        {/*
          The count and the way of looking share a line. Two words in the same
          ink the count is set in, and no third layer of chrome: the page had
          no controls at all before this, and it now has the fewest it can
          have and still let somebody choose.
        */}
        <div className="exhibition-count-line">
          <p className="exhibition-count lt-catalogue">
            {page.works.length} {page.works.length === 1 ? 'work' : 'works'}
          </p>
          <TemplateSwitch template={template} available={available} />
        </div>
      </header>

      <ol className="exhibition-hang">
        {page.works.map((work, index) => (
          <li key={work.artworkId} className="exhibition-work">
            <figure>
              {work.imageUrl ? (
                <img
                  src={atWidth(work.imageUrl, WALL_IMAGE_WIDTH) ?? work.imageUrl}
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
                  <p
                    className="exhibition-label"
                    data-provenance={work.labelByAgent ? 'agent' : 'human'}
                  >
                    {work.label}
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
        The colophon. Every line is a fact somebody could check, and nothing
        here explains the page to itself. The rights sentence stays long
        because it is the institution's own credit line rather than our
        chrome — the licence is the part a reuser acts on.
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
            {agentWritten} of {page.works.length}{' '}
            {page.works.length === 1 ? 'label' : 'labels'} written by an agent
          </p>
        )}
        {/*
          Was "N works in this link could not be resolved in the catalogue" —
          a sentence narrating a mechanism the visitor cannot act on and did
          not ask about. They need the count, not the cause.
        */}
        {page.missing > 0 && (
          <p>
            {page.missing} {page.missing === 1 ? 'work' : 'works'} unavailable
          </p>
        )}
        <p>
          <a href="/nga/search">Assembled in Paillette</a>
        </p>
      </footer>
    </main>
  );
};
