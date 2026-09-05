/**
 * Whether this device should be offered a room at all.
 *
 * The requirement is that the degradation is *honest*: no dead control, no
 * apology on screen. So this runs before anything is drawn and before the
 * selector is rendered — a machine that cannot run the room is never shown the
 * word ROOM, rather than being shown it and then told no. And a `?v=room` link
 * arriving on such a machine renders the page silently, because the visitor
 * did not choose this device to be disappointed by.
 *
 * The test is deliberately narrow. Feature-detecting a GPU by user agent is
 * how you end up refusing a perfectly good phone, so the only questions asked
 * are ones with real answers: can a WebGL context actually be created, and has
 * the browser volunteered that it has very little memory. `deviceMemory` is
 * Chromium-only and absent everywhere else; absent means no answer, and no
 * answer is not a failure.
 *
 * The context is created and immediately given back. Browsers cap the number
 * of live WebGL contexts — Chrome at sixteen — and leaking one per page load
 * to answer a yes/no question is the kind of thing that works until a tab has
 * been open a while.
 */

/** Below this the browser is telling us it is a low-memory device. */
export const MIN_DEVICE_MEMORY_GB = 2;

export const canRenderRoom = (): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const memory = (
    navigator as Navigator & { deviceMemory?: number }
  ).deviceMemory;
  if (typeof memory === 'number' && memory < MIN_DEVICE_MEMORY_GB) return false;

  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return false;
    // Handing the context back rather than waiting for the collector, so that
    // asking the question never costs a context slot.
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
};
