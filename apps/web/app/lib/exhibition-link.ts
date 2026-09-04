/**
 * An exhibition as a URL.
 *
 * The board dies with the tab, and "shareable exhibitions" was therefore a
 * promise the build did not keep. This keeps it, and the choice of *how* is
 * the interesting part.
 *
 * **The whole show travels in the link.** Title, statement, the ordered ids
 * and every label, deflated and base64url'd into one query parameter. Nothing
 * is stored on a server.
 *
 * The alternative was a server-side record with a short id, and it is worse
 * here on every axis that matters tonight. It needs a new anonymous write
 * endpoint on a site whose whole catalogue is deliberately read-only to
 * anonymous callers — which means a rate limit, an expiry policy, a size cap
 * and a moderation story for arbitrary text that strangers can publish under
 * this domain. It needs KV. And it can rot: a link that resolves to a record
 * somebody has to keep is a link that stops working. A self-contained URL
 * cannot be deleted out from under the person who shared it, and it works the
 * first time it is opened, cold, by someone who has never used Paillette.
 *
 * The cost is length, and it is real — but measured rather than feared. With
 * twelve distinct labels and a hundred-word statement the deflated payload is
 * about 900 bytes, so the whole URL is ~1250 characters. At the documented cap
 * of twenty-four works (`EXHIBITION_MAX_WORKS`) it is ~1900. Both sit inside
 * the ~2 kB that every browser and every chat client will carry without
 * truncating, which is what the cap on the hang is for.
 *
 * Ids stay session-resolvable, exactly as `docs/HANDOFF.md` §5.4 says, so the
 * page's loader re-fetches each record by id from the public NGA route on the
 * server. The link carries what only this session knew — the prose — and the
 * catalogue supplies what it always knew.
 */

/** Bumped if the shape changes; an old link should fail loudly, not oddly. */
const VERSION = 1;

/** Deflated payloads carry `1`, plain ones `0`. One character, no sniffing. */
const DEFLATED = '1';
const PLAIN = '0';

export const EXHIBITION_LINK_PARAM = 'e';
export const EXHIBITION_PATH = '/exhibition';

/** Beyond this a URL stops being something you can paste into a message. */
export const EXHIBITION_LINK_SOFT_LIMIT = 2000;

export interface ExhibitionLinkWork {
  artworkId: string;
  label: string | null;
  /** True when the agent wrote this label, for the credit on the page. */
  labelByAgent: boolean;
}

export interface ExhibitionLinkPayload {
  collectionId: string;
  title: string | null;
  titleByAgent: boolean;
  statement: string | null;
  statementByAgent: boolean;
  works: ExhibitionLinkWork[];
}

/**
 * The wire shape, with one-letter keys.
 *
 * Ugly on purpose: every character here is a character of URL, and the
 * difference between `{"artworkId":…,"label":…}` and `[id,label]` repeated
 * twenty-four times is most of the budget.
 */
type Wire = {
  v: number;
  c: string;
  /** [text, 1 if the agent wrote it] */
  t?: [string, 0 | 1];
  s?: [string, 0 | 1];
  /** [id, label, 1 if the agent wrote it] */
  w: [string, string, 0 | 1][];
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Feature-detected, both ways. `CompressionStream` is in every current engine
 * and in the Workers runtime, but a link written by a browser that lacks it
 * still has to be readable, so the format says which it is rather than the
 * reader guessing.
 */
const hasCompression = () =>
  typeof CompressionStream !== 'undefined' &&
  typeof DecompressionStream !== 'undefined';

/**
 * One chunk in, the transformed bytes out.
 *
 * The cast is on `writable` alone: the DOM types declare it as
 * `WritableStream<BufferSource>` while `ReadableStream<Uint8Array>` wants a
 * `Uint8Array` sink, and the two do not unify even though every byte here is a
 * `Uint8Array`. Narrowing it in one place beats loosening the signatures of
 * everything that calls this.
 */
const through = (
  bytes: Uint8Array,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream }
): Promise<Uint8Array> =>
  collect(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }).pipeThrough({
      readable: transform.readable,
      writable: transform.writable as WritableStream<Uint8Array>,
    })
  );

const deflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  through(bytes, new CompressionStream('deflate-raw'));

const inflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  through(bytes, new DecompressionStream('deflate-raw'));

const toWire = (payload: ExhibitionLinkPayload): Wire => ({
  v: VERSION,
  c: payload.collectionId,
  ...(payload.title
    ? { t: [payload.title, payload.titleByAgent ? 1 : 0] as [string, 0 | 1] }
    : {}),
  ...(payload.statement
    ? {
        s: [payload.statement, payload.statementByAgent ? 1 : 0] as [
          string,
          0 | 1,
        ],
      }
    : {}),
  w: payload.works.map((work) => [
    work.artworkId,
    work.label ?? '',
    work.labelByAgent ? 1 : 0,
  ]),
});

export const encodeExhibitionLink = async (
  payload: ExhibitionLinkPayload
): Promise<string> => {
  const json = new TextEncoder().encode(JSON.stringify(toWire(payload)));
  if (!hasCompression()) return PLAIN + toBase64Url(json);
  try {
    return DEFLATED + toBase64Url(await deflate(json));
  } catch {
    // Never fail to produce a link over a compression detail.
    return PLAIN + toBase64Url(json);
  }
};

export const decodeExhibitionLink = async (
  encoded: string
): Promise<ExhibitionLinkPayload | null> => {
  const marker = encoded.slice(0, 1);
  const body = encoded.slice(1);
  if (!body || (marker !== DEFLATED && marker !== PLAIN)) return null;

  let json: string;
  try {
    const bytes = fromBase64Url(body);
    json = new TextDecoder().decode(
      marker === DEFLATED ? await inflate(bytes) : bytes
    );
  } catch {
    return null;
  }

  let wire: Wire;
  try {
    wire = JSON.parse(json) as Wire;
  } catch {
    return null;
  }
  if (!wire || wire.v !== VERSION || !Array.isArray(wire.w)) return null;

  const works: ExhibitionLinkWork[] = [];
  for (const entry of wire.w) {
    const artworkId = typeof entry?.[0] === 'string' ? entry[0].trim() : '';
    if (!artworkId) continue;
    const label = typeof entry[1] === 'string' ? entry[1].trim() : '';
    works.push({
      artworkId,
      label: label || null,
      labelByAgent: entry[2] === 1,
    });
  }
  if (!works.length) return null;

  return {
    collectionId: typeof wire.c === 'string' && wire.c ? wire.c : 'nga',
    title: wire.t?.[0]?.trim() || null,
    titleByAgent: wire.t?.[1] === 1,
    statement: wire.s?.[0]?.trim() || null,
    statementByAgent: wire.s?.[1] === 1,
    works,
  };
};

/** The path plus the parameter. The origin belongs to whoever is asking. */
export const exhibitionLinkPath = (encoded: string) =>
  `${EXHIBITION_PATH}?${EXHIBITION_LINK_PARAM}=${encoded}`;
