import type { ExhibitionPage } from './exhibition-page.server';
import {
  encodeExhibitionLink,
  exhibitionLinkPath,
  type ExhibitionLinkPayload,
} from './exhibition-link';
import { frameHref, type FrameStyle } from './room/frame';
import { templateHref, type ExhibitionTemplate } from './room/template';

/** The server adds these fields for editable, shareable exhibitions. */
export type DraftableExhibitionPage = ExhibitionPage & {
  collectionId?: string;
  titleByAgent?: boolean;
};

export type LabelAuthor = 'human' | 'agent';

export type StoredExhibitionDraft = Record<
  string,
  { text: string; by: LabelAuthor }
>;

export const DRAFT_LABEL_MAX_LENGTH = 320;
const DRAFT_VERSION = 1;
export const EXHIBITION_SHARE_DEADLINE_MS = 15_000;
export const EXHIBITION_DRAFT_CHANGE_EVENT = 'paillette:exhibition-draft-change';

export const emptyExhibitionDraft = (): StoredExhibitionDraft =>
  Object.create(null) as StoredExhibitionDraft;

export const copyExhibitionDraft = (
  labels: StoredExhibitionDraft
): StoredExhibitionDraft => {
  const copy = emptyExhibitionDraft();
  for (const [id, value] of Object.entries(labels)) copy[id] = value;
  return copy;
};

export const ownDraftLabel = (
  labels: StoredExhibitionDraft,
  artworkId: string
): { text: string; by: LabelAuthor } | undefined =>
  Object.prototype.hasOwnProperty.call(labels, artworkId)
    ? labels[artworkId]
    : undefined;

export const exhibitionDraftKey = (page: DraftableExhibitionPage): string => {
  const collection = page.collectionId ?? '';
  if (page.code && collection) return `paillette:exhibition-draft:${collection}:${page.code}`;

  let canonical = page.canonicalUrl;
  try {
    const url = new URL(page.canonicalUrl);
    url.searchParams.delete('v');
    url.searchParams.delete('frame');
    url.searchParams.delete('theme');
    url.hash = '';
    canonical = url.toString();
  } catch {
    // A route supplies an absolute canonical URL. Keeping an unusual input
    // literal here still isolates it rather than sharing an unrelated draft.
  }
  return `paillette:exhibition-draft:url:${canonical}`;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Reject untrusted local data before it reaches a rendered exhibition. */
export const readStoredExhibitionDraft = (
  raw: string | null,
  knownArtworkIds: Set<string>
): StoredExhibitionDraft => {
  if (!raw || raw.length > 100_000) return emptyExhibitionDraft();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || parsed.version !== DRAFT_VERSION || !isPlainRecord(parsed.labels)) {
      return emptyExhibitionDraft();
    }
    const labels = emptyExhibitionDraft();
    for (const [id, value] of Object.entries(parsed.labels)) {
      if (!knownArtworkIds.has(id) || !isPlainRecord(value)) continue;
      if (
        typeof value.text !== 'string' ||
        value.text.length > DRAFT_LABEL_MAX_LENGTH ||
        (value.by !== 'human' && value.by !== 'agent')
      ) continue;
      labels[id] = { text: value.text, by: value.by };
    }
    return labels;
  } catch {
    return emptyExhibitionDraft();
  }
};

export const serializeExhibitionDraft = (labels: StoredExhibitionDraft): string =>
  JSON.stringify({ version: DRAFT_VERSION, labels });

export const exhibitionCopyPayload = (
  page: DraftableExhibitionPage
): ExhibitionLinkPayload => {
  if (!page.collectionId) {
    throw new Error('This exhibition cannot be shared because its collection is unknown.');
  }
  return {
    collectionId: page.collectionId,
    title: page.title,
    titleByAgent: page.titleByAgent === true,
    statement: page.statement,
    statementByAgent: page.statementByAgent,
    works: page.works.map((work) => ({
      artworkId: work.artworkId,
      label: work.label,
      labelByAgent: work.labelByAgent,
    })),
    ...(page.regions?.length ? { regions: page.regions } : {}),
  };
};

const originFor = (page: ExhibitionPage): string => {
  try {
    return new URL(page.canonicalUrl).origin;
  } catch {
    if (typeof window !== 'undefined') return window.location.origin;
    throw new Error('This exhibition has no valid canonical URL for sharing.');
  }
};

const publishedUrl = (value: unknown, origin: string): string | null => {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.search ||
      url.hash ||
      !/^\/e\/[^/?#]+$/.test(url.pathname)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const withPresentation = (
  url: string,
  template: ExhibitionTemplate,
  frame: FrameStyle
) => frameHref(templateHref(url, template), frame);

/**
 * Creates a new short exhibit. It never writes to the source exhibition.
 * A valid self-contained link is returned if the service cannot create one.
 */
export const shareExhibitionCopy = async (
  page: DraftableExhibitionPage,
  { template, frame }: { template: ExhibitionTemplate; frame: FrameStyle }
): Promise<string> => {
  const payload = exhibitionCopyPayload(page);
  const origin = originFor(page);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXHIBITION_SHARE_DEADLINE_MS);
  try {
    const response = await fetch('/api/exhibitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { url?: unknown } };
      const url = publishedUrl(body?.data?.url, origin);
      if (url) return withPresentation(url, template, frame);
    }
  } catch {
    // The self-contained form is deliberately independent of this service.
  } finally {
    clearTimeout(timer);
  }

  const fallback = new URL(exhibitionLinkPath(await encodeExhibitionLink(payload)), origin);
  return withPresentation(fallback.toString(), template, frame);
};
