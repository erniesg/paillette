/**
 * The identity an anonymous ceiling counts against.
 *
 * There is no account on this surface, so the only thing to key a per-caller
 * budget on is the connecting address. It is hashed rather than stored: a
 * counter needs to tell two visitors apart and never needs to know who either
 * of them is, and a bucket key that is a bare IP is a log of who visited.
 *
 * The salt is per-meter and part of the digest. Two meters keyed on the same
 * visitor produce unrelated hashes, so neither one's storage can be joined
 * against the other's to reconstruct a session across features.
 */

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/**
 * Null when there is no usable address — behind a proxy that strips it, or a
 * header long enough to be someone probing. Callers decide what an
 * unidentifiable caller means for their meter; it is not the same answer for a
 * request counter as it is for a spend counter.
 */
export const getClientHash = async (
  connectingIp: string | undefined,
  salt: string
): Promise<string | null> => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${candidate}`)
  );
  return toHex(digest);
};
