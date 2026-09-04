/**
 * The short code an exhibition is reachable by.
 *
 * Lives in `@paillette/types` because both ends need the same answer to "is
 * this a code, and what is its canonical form" — the API before it touches D1,
 * and the web loader before it makes a request at all. Two copies of an
 * alphabet is a bug waiting for the day somebody adds a character to one.
 *
 * **The alphabet is base62 minus the glyphs that lie.** No `0`/`O`, no
 * `1`/`l`/`I`. Not for entropy — dropping five characters costs about a third
 * of a bit each — but because a link gets read aloud, typed off a phone screen
 * and OCR'd out of a screenshot, and every one of those is a place where an
 * `l` becomes a `1` and the show is gone. 57 characters, seven long, is 57^7 ≈
 * 1.95 × 10^12: enough that guessing is not a strategy.
 *
 * Note that lowercase `o` and lowercase `i` **are** in the alphabet — only the
 * digits and the two uppercase letters were dropped. That asymmetry is the
 * reason `normaliseShareCode` refuses to "helpfully" repair a mistyped glyph;
 * see the note there.
 *
 * **Unguessable is not private.** A code is a capability — anyone holding it
 * can open the show, and that is the point of a link you can paste. There is
 * no access control behind it. An unlisted exhibition is unlisted, not secret,
 * and nothing here should be read as saying otherwise.
 */

/** base62 with the ambiguous glyphs removed. Order is not significant. */
export const SHARE_CODE_ALPHABET =
  '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export const SHARE_CODE_LENGTH = 7;
export const SHARE_CODE_MIN_LENGTH = 7;
export const SHARE_CODE_MAX_LENGTH = 8;

/**
 * Normalisation is trim and unwrap, and deliberately nothing else.
 *
 * Two things it pointedly does **not** do, both because the tempting version
 * resolves a wrong code to a real exhibition instead of refusing it:
 *
 *  - **It does not repair ambiguous glyphs.** Mapping a typed `O` onto `0`
 *    looks helpful until you notice that `0` was dropped from the alphabet but
 *    lowercase `o` was not — so the "repair" would hand somebody a different
 *    curator's show. The glyphs are absent from the alphabet, so a mistype
 *    fails validation and the visitor is told the link is wrong. Being told
 *    beats being shown the wrong thing.
 *  - **It does not truncate.** Clipping an over-long string to eight
 *    characters turns `abcdefghi` into the valid, unrelated code `abcdefgh`.
 *    Length is a validation question, not a normalisation one.
 *
 * It also does not case-fold, which the obvious reading of "normalise" would
 * include. The alphabet is mixed-case base62, so folding would collapse
 * `aB3xk9m` and `Ab3Xk9M` into one code and throw away most of the keyspace
 * the length was chosen for. Case is carried, exactly as generated.
 *
 * What is left is the punctuation a link picks up on its way through a chat
 * client: a wrapping angle bracket, a trailing full stop, a stray quote.
 */
export const normaliseShareCode = (raw: string | null | undefined): string => {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^[<([{"'\s]+|[>)\]}"'.,;:!?\s]+$/g, '');
};

const VALID = new RegExp(
  `^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_MIN_LENGTH},${SHARE_CODE_MAX_LENGTH}}$`
);

/** Shape only. Says nothing about whether the exhibition exists. */
export const isShareCode = (value: string): boolean => VALID.test(value);

/**
 * Normalise and validate in one step, because doing them separately is how a
 * raw string reaches a query. Returns null rather than throwing: an unopenable
 * link is an ordinary 404, not an exception.
 */
export const readShareCode = (raw: string | null | undefined): string | null => {
  const code = normaliseShareCode(raw);
  return isShareCode(code) ? code : null;
};

/**
 * `crypto.getRandomValues`, not `Math.random`.
 *
 * Rejection-sampled so the alphabet stays uniform: 256 is not a multiple of
 * 57, so taking a byte modulo 57 would make the first sixteen characters
 * measurably likelier than the rest. It costs a handful of extra bytes and
 * removes a whole class of "why do so many codes start with a 2" question.
 */
export const generateShareCode = (length: number = SHARE_CODE_LENGTH): string => {
  const size = SHARE_CODE_ALPHABET.length;
  const ceiling = Math.floor(256 / size) * size;
  let code = '';
  const buffer = new Uint8Array(length * 2);
  while (code.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= ceiling) continue;
      code += SHARE_CODE_ALPHABET[byte % size];
      if (code.length === length) break;
    }
  }
  return code;
};

/** The path half of a share URL. The origin belongs to whoever is asking. */
export const shareCodePath = (code: string) => `/e/${code}`;
