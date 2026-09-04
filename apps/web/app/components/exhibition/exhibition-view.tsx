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

import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import { SOCIAL_CARD_WIDTH, WALL_IMAGE_WIDTH, atWidth } from '~/lib/share/iiif';

/**
 * The label credit, as a mark rather than a sentence.
 *
 * A museum prints who wrote its labels; it does not print it under each one.
 * The mark carries the fact and the colophon says what the mark means, once,
 * at the bottom where a credit line belongs.
 */
export const AGENT_MARK = '·⁠·';

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
    { property: 'og:url', content: page.canonicalUrl },
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
    { tagName: 'link', rel: 'canonical', href: page.canonicalUrl },
  ];
};

export const ExhibitionView = ({ page }: { page: ExhibitionPage }) => {
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
};
