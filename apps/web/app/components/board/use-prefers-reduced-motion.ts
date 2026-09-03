import { useEffect, useState } from 'react';

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
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => read());

  useEffect(() => {
    const list = matchMediaOrNull();
    if (!list) return undefined;

    setReduced(list.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    // Safari below 14 only has the deprecated addListener.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    if (typeof list.addListener === 'function') {
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    }
    return undefined;
  }, []);

  return reduced;
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
