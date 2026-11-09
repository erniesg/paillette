import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  IdleShowcaseImage,
  SHOWCASE_IMAGE_TIMEOUT_MS,
} from '../idle-showcase-image';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('reveals successful cards independently of a never-settling image and fallback', () => {
  vi.useFakeTimers();
  render(
    <>
      <IdleShowcaseImage
        src="/stalled"
        fallbackSrc="/also-stalled"
        alt="stalled"
        fallback={<span>Unavailable</span>}
      />
      <IdleShowcaseImage src="/good" alt="good" fallback={<span>Bad</span>} />
    </>
  );
  fireEvent.load(screen.getByAltText('good'));
  expect(screen.getByAltText('good').getAttribute('src')).toBe('/good');
  act(() => vi.advanceTimersByTime(SHOWCASE_IMAGE_TIMEOUT_MS));
  expect(screen.getByAltText('stalled').getAttribute('src')).toBe(
    '/also-stalled'
  );
  act(() => vi.advanceTimersByTime(SHOWCASE_IMAGE_TIMEOUT_MS));
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.getByAltText('good')).toBeTruthy();
});

it('does not reset a stalled card deadline when the layer is promoted or another card rotates', () => {
  vi.useFakeTimers();
  const cards = (other: string) => (
    <>
      <IdleShowcaseImage
        key="retained"
        src="/stalled"
        fallbackSrc="/original"
        alt="retained"
        fallback={<span>Unavailable</span>}
      />
      <IdleShowcaseImage
        key={other}
        src={other}
        alt="rotating"
        fallback={<span>Other unavailable</span>}
      />
    </>
  );
  const { rerender } = render(cards('/first'));
  act(() => vi.advanceTimersByTime(420));
  rerender(cards('/next'));
  act(() => vi.advanceTimersByTime(SHOWCASE_IMAGE_TIMEOUT_MS - 420));
  expect(screen.getByAltText('retained').getAttribute('src')).toBe('/original');
});

it('uses the original when the thumbnail fails and retains a successful fallback', () => {
  vi.useFakeTimers();
  render(
    <IdleShowcaseImage
      src="/thumbnail"
      fallbackSrc="/original"
      alt="work"
      loadingFallback={<span>Loading image</span>}
      fallback={<span>Unavailable</span>}
    />
  );
  expect(screen.getByText('Loading image')).toBeTruthy();
  fireEvent.error(screen.getByAltText('work'));
  expect(screen.getByAltText('work').getAttribute('src')).toBe('/original');
  fireEvent.load(screen.getByAltText('work'));
  expect(screen.queryByText('Loading image')).toBeNull();
  act(() => vi.advanceTimersByTime(SHOWCASE_IMAGE_TIMEOUT_MS * 3));
  expect(screen.getByAltText('work').getAttribute('src')).toBe('/original');
});
