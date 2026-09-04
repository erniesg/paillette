import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the viewer has asked for less motion.
 *
 * Framer Motion ships its own `useReducedMotion`, but it reads the media query
 * once into module state the first time any motion component mounts, which
 * makes the preference effectively unobservable afterwards — it cannot be
 * tested, and it will not notice a viewer who changes the setting while the
 * page is open. The board's whole reduced-motion path hangs off this answer, so
 * it is worth the fifteen lines to subscribe properly.
 *
 * Returns `false` during server render and on browsers without `matchMedia`,
 * which is the safe default: the animation is progressive enhancement, and
 * suppressing it for someone who never asked would be the worse mistake.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because the
 * preference is a value that exists outside React and the naive shape gets
 * hydration wrong: reading the media query in a `useState` initialiser makes
 * the client's first render disagree with the server's `false` for anyone who
 * *has* the preference set, and React logs a mismatch and discards the markup.
 * Passing a separate server snapshot is how you say "this value is legitimately
 * unknowable until hydration" without lying about it in either direction.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, readOnServer);
}

function subscribe(onChange: () => void): () => void {
  const list = matchMediaOrNull();
  if (!list) return () => {};

  // Safari below 14 only has the deprecated addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  if (typeof list.addListener === 'function') {
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }
  return () => {};
}

function matchMediaOrNull(): MediaQueryList | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(QUERY);
  } catch {
    return null;
  }
}

function read(): boolean {
  return matchMediaOrNull()?.matches ?? false;
}

/**
 * The server cannot know the preference, and guessing either way is worse than
 * admitting it: guess `true` and everyone loses the animation for one frame,
 * guess `false` and the markup matches what a server can actually produce.
 */
function readOnServer(): boolean {
  return false;
}
