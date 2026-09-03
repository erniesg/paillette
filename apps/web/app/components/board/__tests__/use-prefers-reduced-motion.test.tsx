import { render, screen, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrefersReducedMotion } from '../use-prefers-reduced-motion';

function Probe() {
  return <span data-testid="probe">{String(usePrefersReducedMotion())}</span>;
}

/**
 * A `matchMedia` stub that can actually change its mind, so the subscription
 * has something to observe. The real one is a live object; a stub that only
 * ever returns its initial value cannot tell a working listener from a missing
 * one.
 */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
      listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
      listeners.delete(fn),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list)
  );

  return {
    listenerCount: () => listeners.size,
    set(next: boolean) {
      list.matches = next;
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the preference on the client', () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('is false when the preference is not set', () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  /*
   * The bug this replaced: reading the media query in a `useState` initialiser
   * made the client's first render disagree with the server's `false` for
   * anyone who has the preference set, so React logged a hydration mismatch
   * and threw the server markup away. The server has no way to know the
   * preference, so its snapshot has to say so.
   */
  it('renders false on the server even when the client would say true', () => {
    stubMatchMedia(true);
    expect(renderToString(<Probe />)).toContain('>false<');
  });

  it('follows the preference changing while the page is open', () => {
    const media = stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');

    act(() => media.set(true));
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('unsubscribes when the last listener unmounts', () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('is false rather than broken without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('is false rather than broken when matchMedia throws', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('unsupported query');
      })
    );
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});
