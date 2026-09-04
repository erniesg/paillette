/**
 * What a link looks like before anyone clicks it.
 *
 * A link pasted into Slack, WhatsApp or X is unfurled by a bot that is not a
 * browser: it fetches once, reads the `<head>`, and gives up quickly. Serving
 * it the full app shell mostly works and is a bad bet — the shell carries a
 * script graph the bot will not run, the tags it wants are somewhere after
 * several kilobytes of preload hints, and the ones that time out show the link
 * as a bare URL. So crawlers get their own document: the tags, a fallback
 * body, and nothing else.
 *
 * That is also most of what makes a link feel shareable. Title, statement as
 * the description, lead artwork as the image. A URL with a picture and a
 * sentence under it reads as a place; a URL on its own reads as a risk.
 */

import { SOCIAL_CARD_WIDTH, atWidth } from './iiif';

/**
 * The bots that actually unfurl links, plus the general-purpose fetchers that
 * behave like them.
 *
 * Matched case-insensitively against the whole UA, and deliberately a list
 * rather than "anything that is not a browser": guessing at absence is how you
 * end up serving a stub to a real visitor with an unusual UA, and the cost of
 * missing a crawler is only that it parses the normal page — which still has
 * the tags, because the route renders them too. This path is an optimisation
 * with a fallback, not a requirement.
 */
const CRAWLERS = [
  'facebookexternalhit',
  'facebookcatalog',
  'twitterbot',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'whatsapp',
  'telegrambot',
  'linkedinbot',
  'pinterest',
  'redditbot',
  'skypeuripreview',
  'applebot',
  'bingbot',
  'googlebot',
  'google-inspectiontool',
  'embedly',
  'quora link preview',
  'nuzzel',
  'vkshare',
  'w3c_validator',
  'iframely',
  'mastodon',
  'opengraph',
  'signal',
  'bluesky',
  'developers.google.com/+/web/snippet',
];

export const isSocialCrawler = (request: Request): boolean => {
  const agent = request.headers.get('user-agent');
  if (!agent) return false;
  const normalised = agent.toLowerCase();
  return CRAWLERS.some((crawler) => normalised.includes(crawler));
};

/**
 * An enrichment probe — a client asking for the metadata rather than the page.
 *
 * Distinguished from a human by what it asks for rather than who it says it
 * is: `Accept: application/json` with no interest in HTML is not a navigation.
 * Browsers always send `text/html` on a document request, so this cannot
 * capture one.
 */
export const wantsJson = (request: Request): boolean => {
  const accept = request.headers.get('accept');
  if (!accept) return false;
  return accept.includes('application/json') && !accept.includes('text/html');
};

export interface SharePreview {
  title: string;
  description: string | null;
  imageUrl: string | null;
  canonicalUrl: string;
  /** Rendered as the visible body, so a bot that shows the page shows a show. */
  works: { title: string; artist: string | null; imageUrl: string | null }[];
  institution: string;
}

/**
 * Escaped for both places it lands: an attribute value and a text node.
 *
 * The statement is prose a stranger typed, and it goes into `content="…"`. A
 * single unescaped quote there ends the attribute and everything after it
 * becomes markup. This is the only defence that matters on this path, so it
 * escapes the full set rather than the three that usually suffice.
 */
const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const tag = (attribute: 'property' | 'name', key: string, value: string | null) =>
  value ? `<meta ${attribute}="${key}" content="${escape(value)}"/>` : '';

export const sharePreviewHtml = (preview: SharePreview): string => {
  const image = atWidth(preview.imageUrl, SOCIAL_CARD_WIDTH);
  const description = preview.description;

  const head = [
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escape(preview.title)} — Paillette</title>`,
    `<link rel="canonical" href="${escape(preview.canonicalUrl)}"/>`,
    tag('name', 'description', description),
    tag('property', 'og:type', 'article'),
    tag('property', 'og:site_name', 'Paillette'),
    tag('property', 'og:title', preview.title),
    tag('property', 'og:description', description),
    tag('property', 'og:url', preview.canonicalUrl),
    tag('property', 'og:image', image),
    image ? tag('property', 'og:image:width', String(SOCIAL_CARD_WIDTH)) : '',
    image ? tag('property', 'og:image:alt', preview.title) : '',
    tag('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
    tag('name', 'twitter:title', preview.title),
    tag('name', 'twitter:description', description),
    tag('name', 'twitter:image', image),
  ]
    .filter(Boolean)
    .join('');

  // A visible body, because some of these bots render what they fetch and a
  // few humans arrive here through a proxy that forwards the bot's UA. It is
  // the exhibition in its shortest honest form, not a "loading…" placeholder.
  const body = [
    `<h1>${escape(preview.title)}</h1>`,
    description ? `<p>${escape(description)}</p>` : '',
    '<ul>',
    ...preview.works.map(
      (work) =>
        `<li>${escape(work.title)}${
          work.artist ? ` — ${escape(work.artist)}` : ''
        }</li>`
    ),
    '</ul>',
    `<p>${escape(preview.institution)}</p>`,
    `<p><a href="${escape(preview.canonicalUrl)}">View the exhibition</a></p>`,
  ]
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
};
