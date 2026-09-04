/**
 * The document a link-unfurler gets.
 *
 * Two things are worth holding down here and they pull in opposite directions.
 * The tags have to be *right*, because a card with no image is most of the
 * difference between a link that looks like a place and a link that looks like
 * a risk. And the statement is prose a stranger typed which lands inside
 * `content="…"`, so it has to be *escaped*, because a single quote there ends
 * the attribute and everything after it becomes markup.
 */

import { describe, expect, it } from 'vitest';
import {
  isSocialCrawler,
  sharePreviewHtml,
  wantsJson,
  type SharePreview,
} from '../preview';

const withAgent = (agent?: string) =>
  new Request('https://paillette-stg.berlayar.ai/e/aB3xk9m', {
    headers: agent ? { 'User-Agent': agent } : {},
  });

const withAccept = (accept?: string) =>
  new Request('https://paillette-stg.berlayar.ai/e/aB3xk9m', {
    headers: accept ? { Accept: accept } : {},
  });

const preview = (overrides: Partial<SharePreview> = {}): SharePreview => ({
  title: 'Leaving',
  description: 'A show about the moment before departure.',
  imageUrl: 'https://api.nga.gov/iiif/abc-123/full/full/0/default.jpg',
  canonicalUrl: 'https://paillette-stg.berlayar.ai/e/aB3xk9m',
  works: [
    {
      title: 'Lumber Schooners at Evening',
      artist: 'Fitz Henry Lane',
      imageUrl: 'https://api.nga.gov/iiif/abc-123/full/full/0/default.jpg',
    },
  ],
  institution: 'National Gallery of Art, Washington',
  ...overrides,
});

describe('spotting a crawler', () => {
  it.each([
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['WhatsApp', 'WhatsApp/2.23.20.0'],
    ['X', 'Twitterbot/1.0'],
    ['Facebook', 'facebookexternalhit/1.1'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)'],
    ['Signal', 'SignalProxy/1.0'],
  ])('recognises %s', (_name, agent) => {
    expect(isSocialCrawler(withAgent(agent))).toBe(true);
  });

  it.each([
    [
      'Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    ],
    [
      'Safari on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ],
    ['Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'],
  ])('leaves %s alone', (_name, agent) => {
    expect(isSocialCrawler(withAgent(agent))).toBe(false);
  });

  it('treats a missing user-agent as a human, not a bot', () => {
    // Guessing at absence is how a real visitor with an odd client gets served
    // a stub instead of the app.
    expect(isSocialCrawler(withAgent())).toBe(false);
  });
});

describe('spotting a probe', () => {
  it('answers a client that asked only for JSON', () => {
    expect(wantsJson(withAccept('application/json'))).toBe(true);
  });

  it('never captures a browser navigation', () => {
    expect(
      wantsJson(
        withAccept('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
      )
    ).toBe(false);
    // Some clients ask for both. Both means the page.
    expect(wantsJson(withAccept('text/html,application/json'))).toBe(false);
    expect(wantsJson(withAccept())).toBe(false);
  });
});

describe('the preview document', () => {
  it('carries the title, the statement and the lead work', () => {
    const html = sharePreviewHtml(preview());
    expect(html).toContain('<meta property="og:title" content="Leaving"/>');
    expect(html).toContain(
      '<meta property="og:description" content="A show about the moment before departure."/>'
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://paillette-stg.berlayar.ai/e/aB3xk9m"/>'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://paillette-stg.berlayar.ai/e/aB3xk9m"/>'
    );
  });

  it('asks IIIF for a card-sized image rather than the master file', () => {
    const html = sharePreviewHtml(preview());
    expect(html).toContain(
      '<meta property="og:image" content="https://api.nga.gov/iiif/abc-123/full/1200,/0/default.jpg"/>'
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
  });

  it('falls back to a small card when there is no image to show', () => {
    const html = sharePreviewHtml(preview({ imageUrl: null }));
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary"/>');
  });

  it('leaves a non-IIIF image URL alone rather than half-rewriting it', () => {
    const html = sharePreviewHtml(
      preview({ imageUrl: 'https://assets.example/plain.jpg' })
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://assets.example/plain.jpg"/>'
    );
  });

  /*
   * The statement is prose a stranger typed and it goes into an attribute
   * value. Without escaping, one double quote closes `content="` and the rest
   * of the sentence is markup — on a page served from this domain.
   */
  it('escapes prose so it cannot break out of an attribute', () => {
    const html = sharePreviewHtml(
      preview({
        title: 'Leaving " onload="alert(1)',
        description: '<script>alert("x")</script> & \'quoted\'',
      })
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('has a visible body, not a loading placeholder', () => {
    const html = sharePreviewHtml(preview());
    expect(html).toContain('<h1>Leaving</h1>');
    expect(html).toContain('Lumber Schooners at Evening — Fitz Henry Lane');
    expect(html).toContain('National Gallery of Art, Washington');
    expect(html).toContain('View the exhibition');
  });

  it('omits the description tags entirely when there is no statement', () => {
    const html = sharePreviewHtml(preview({ description: null }));
    expect(html).not.toContain('og:description');
    expect(html).not.toContain('twitter:description');
    // An empty description tag is worse than none: some unfurlers render the
    // empty string over whatever they would otherwise have inferred.
    expect(html).not.toContain('content=""');
  });
});
