import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerFilmstrip, type LedgerFrame } from '../ledger-filmstrip';
import type { LightTableWork } from '../light-table-card';

const work = (id: string): LightTableWork => ({
  id,
  title: `Work ${id}`,
  thumbnailUrl: `https://example.test/${id}.jpg`,
});

const frame = (overrides: Partial<LedgerFrame> & { id: string }): LedgerFrame => ({
  hand: 'human',
  works: [work('a'), work('b'), work('c')],
  ...overrides,
});

const setReducedMotion = (reduced: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduced-motion') ? reduced : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
};

describe('LedgerFilmstrip', () => {
  beforeEach(() => {
    setReducedMotion(false);
    // jsdom has no layout, so `scrollTo` on an element is not implemented.
    Element.prototype.scrollTo = vi.fn();
  });

  it('renders nothing before the first turn', () => {
    const { container } = render(<LedgerFilmstrip frames={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws one frame per turn', () => {
    render(
      <LedgerFilmstrip
        frames={[frame({ id: '1' }), frame({ id: '2' }), frame({ id: '3' })]}
        onRestore={vi.fn()}
      />
    );

    expect(
      within(screen.getByRole('navigation', { name: 'Ledger' })).getAllByRole(
        'button'
      )
    ).toHaveLength(3);
  });

  /*
   * Six is the number that still reads at this size. A frame holding a whole
   * twelve-card board is a texture, not a miniature — and the count that got
   * dropped has to survive somewhere, so it goes in the caption and the
   * accessible name rather than being silently lost.
   */
  it('draws six thumbnails and says how many it left out', () => {
    const works = 'abcdefghijkl'.split('').map(work);
    render(
      <LedgerFilmstrip frames={[frame({ id: '1', works })]} onRestore={vi.fn()} />
    );

    const button = screen.getByRole('button');
    expect(button.querySelectorAll('img')).toHaveLength(6);
    expect(button).toHaveTextContent('+6');
    expect(button).toHaveAccessibleName(/restore 12 works/i);
  });

  it('captions a turn with what was said', () => {
    render(
      <LedgerFilmstrip
        frames={[frame({ id: '1', caption: 'something warm, not busy' })]}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText('something warm, not busy')).toBeInTheDocument();
  });

  /*
   * The ink is the only thing distinguishing the two hands. If it stopped
   * reaching the DOM the strip would render in one colour and become a
   * transcript with the names filed off, which is worse than a transcript.
   */
  it('carries the hand of each turn so the caption takes that ink', () => {
    render(
      <LedgerFilmstrip
        frames={[
          frame({ id: '1', hand: 'human', caption: 'warm, not busy' }),
          frame({ id: '2', hand: 'agent', caption: 'Following your picks.' }),
        ]}
        onRestore={vi.fn()}
      />
    );

    const [human, agent] = screen.getAllByRole('button');
    expect(human).toHaveAttribute('data-hand', 'human');
    expect(agent).toHaveAttribute('data-hand', 'agent');
  });

  it('restores the board of the frame that was clicked', async () => {
    const onRestore = vi.fn();
    const second = frame({ id: '2', caption: 'tighter' });
    render(
      <LedgerFilmstrip frames={[frame({ id: '1' }), second]} onRestore={onRestore} />
    );

    await userEvent.click(screen.getAllByRole('button')[1]!);

    expect(onRestore).toHaveBeenCalledWith(second);
  });

  it('marks the frame whose board is on the table', () => {
    render(
      <LedgerFilmstrip
        frames={[frame({ id: '1' }), frame({ id: '2' })]}
        activeId="2"
        onRestore={vi.fn()}
      />
    );

    const [first, second] = screen.getAllByRole('button');
    expect(first).not.toHaveAttribute('data-active');
    expect(second).toHaveAttribute('data-active');
    expect(second).toHaveAttribute('aria-current', 'true');
  });

  it('keeps a pick framed inside the miniature', () => {
    render(
      <LedgerFilmstrip
        frames={[frame({ id: '1', pickIds: ['b'] })]}
        onRestore={vi.fn()}
      />
    );

    const picked = screen
      .getByRole('button')
      .querySelectorAll('[data-flag="pick"]');
    expect(picked).toHaveLength(1);
  });

  it('is inert rather than broken when nothing can be restored', () => {
    render(<LedgerFilmstrip frames={[frame({ id: '1' })]} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('scrolls to the newest turn without moving the page', () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;

    const { rerender } = render(
      <LedgerFilmstrip frames={[frame({ id: '1' })]} onRestore={vi.fn()} />
    );
    rerender(
      <LedgerFilmstrip
        frames={[frame({ id: '1' }), frame({ id: '2' })]}
        onRestore={vi.fn()}
      />
    );

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );
  });

  it('jumps rather than glides when motion is reduced', () => {
    setReducedMotion(true);
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;

    render(<LedgerFilmstrip frames={[frame({ id: '1' })]} onRestore={vi.fn()} />);

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: 'auto' })
    );
  });
});
