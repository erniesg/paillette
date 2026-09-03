/**
 * The demo collections offered on `/try`, read from a manifest rather than
 * hard-coded.
 *
 * `apps/web/public/samples/manifest.json` is the contract. Whoever adds a
 * dataset drops the zip beside it and appends an entry — no change to this
 * app is needed for the new collection to appear in the picker. A malformed
 * or missing manifest must never take the page down, so parsing is
 * defensive: bad entries are dropped, and an empty result falls back to the
 * one archive that ships with the repo.
 */

/** One bundled collection a visitor can index in a click. */
export type DemoArchive = {
  /** Stable key; also the React list key. */
  id: string;
  /** What the picker calls it. */
  name: string;
  /** The institution the images came from. */
  source: string;
  /** Where the zip is served from — app-relative, or an absolute URL. */
  path: string;
  /** Images inside, used for the honest time estimate before you click. */
  imageCount: number;
  /** True when a CSV sidecar rides along and becomes catalogue metadata. */
  hasMetadata: boolean;
  /** Licence of the images, shown as-is. */
  licence: string;
  /** Archive size in bytes, when the manifest states it. */
  bytes?: number;
  /** One optional line of colour for the card. */
  note?: string;
};

export const DEMO_MANIFEST_PATH = '/samples/manifest.json';

/**
 * Used when the manifest is missing, unreachable or unusable. This is the
 * archive committed to this repo, so the demo works even with no manifest.
 */
export const FALLBACK_ARCHIVES: DemoArchive[] = [
  {
    id: 'nga-25-no-metadata',
    name: '25 works, no metadata',
    source: 'National Gallery of Art, Washington',
    path: '/samples/sample-art-25-no-metadata.zip',
    imageCount: 25,
    hasMetadata: false,
    licence: 'CC0 / NGA Open Access',
    bytes: 7629617,
    note: 'Titles come from filenames — proof that a plain folder of images is enough.',
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** One manifest entry, or null when it is missing anything it needs. */
const toArchive = (value: unknown): DemoArchive | null => {
  if (!isRecord(value)) return null;

  const id = str(value.id);
  const name = str(value.name);
  const path = str(value.path);
  if (!id || !name || !path) return null;

  const imageCount = Number(value.imageCount);
  const bytes = Number(value.bytes);
  const note = str(value.note);

  return {
    id,
    name,
    source: str(value.source) || 'Unknown source',
    path,
    imageCount: Number.isFinite(imageCount) && imageCount > 0 ? Math.floor(imageCount) : 0,
    hasMetadata: value.hasMetadata === true,
    licence: str(value.licence) || 'Licence not stated',
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
    ...(note ? { note } : {}),
  };
};

/**
 * Accepts either `{ collections: [...] }` or a bare array, so a hand-edited
 * manifest that drops the wrapper still works.
 */
export const parseDemoManifest = (value: unknown): DemoArchive[] => {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.collections)
      ? value.collections
      : [];

  const seen = new Set<string>();
  const archives: DemoArchive[] = [];
  for (const entry of raw) {
    const archive = toArchive(entry);
    if (!archive || seen.has(archive.id)) continue;
    seen.add(archive.id);
    archives.push(archive);
  }
  return archives;
};

/**
 * Fetch the manifest, falling back to the bundled archive on any failure.
 * Never throws: the picker is the page's primary call to action.
 */
export const loadDemoArchives = async (
  fetchImpl: typeof fetch = fetch
): Promise<DemoArchive[]> => {
  try {
    const response = await fetchImpl(DEMO_MANIFEST_PATH);
    if (!response.ok) return FALLBACK_ARCHIVES;
    const archives = parseDemoManifest(await response.json());
    return archives.length > 0 ? archives : FALLBACK_ARCHIVES;
  } catch {
    return FALLBACK_ARCHIVES;
  }
};

/**
 * Roughly how long an archive of this size takes to become fully indexed.
 * Measured on staging: a 100-image job runs about six minutes at the current
 * batch size. Stated up front so a slow job reads as slow, not as hung.
 */
export const SECONDS_PER_IMAGE = 3.6;

export const estimateMinutes = (imageCount: number): number =>
  Math.max(1, Math.round((imageCount * SECONDS_PER_IMAGE) / 60));

export const formatDuration = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
};
