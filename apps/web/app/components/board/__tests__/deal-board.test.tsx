import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DealBoard } from '../deal-board';
import { LightTableCard } from '../light-table-card';
import type { BoardMark } from '../provenance';

interface Work {
  id: string;
  title: string;
}

const works = (ids: string[]): Work[] =>
  ids.map((id) => ({ id, title: `Work ${id}` }));

const renderCard = (work: Work) => (
  <LightTableCard work={{ id: work.id, title: work.title }} />
);

const boardSlots = () => {
  const grid = screen.getByTestId('deal-board-grid');
  return Array.from(grid.querySelectorAll('[data-board-slot]'));
};

/**
 * Cards read by slot, not by DOM order.
 *
 * Framer Motion keeps an exiting card mounted until its exit animation ends,
 * and jsdom never runs one, so after a redeal the grid still contains the
 * departed cards. In a browser `mode="popLayout"` takes them out of flow while
 * they fly to the tray. Either way the slot index is the contract, so that is
 * what these tests assert on.
 */
const slotIds = () => {
  const out: string[] = [];
  for (const node of boardSlots()) {
    const slot = Number(node.getAttribute('data-board-slot'));
    const title = node.querySelector('h3')?.textContent ?? '';
    // Later entries win: the surviving card for a slot renders after the one
    // that is on its way out.
    if (!Number.isNaN(slot)) out[slot] = title;
  }
  return out;
};

/** Only the cards the current deal actually placed. */
const liveSlots = () => {
  const seen = new Map<number, Element>();
  for (const node of boardSlots()) {
    seen.set(Number(node.getAttribute('data-board-slot')), node);
  }
  return seen;
};

/** `prefers-reduced-motion` is off unless a test says otherwise. */
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

describe('DealBoard', () => {
  beforeEach(() => {
    setReducedMotion(false);
  });

  it('deals twelve cards', () => {
    render(
      <DealBoard
        items={works(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])}
        renderCard={renderCard}
      />
    );

    expect(boardSlots()).toHaveLength(12);
  });

  it('holds a preserved card in the slot it already occupied', () => {
    const before = works(['a', 'b', 'c', 'd']);
    const { rerender } = render(
      <DealBoard items={before} size={4} preservedIds={['c']} renderCard={renderCard} />
    );

    expect(slotIds()).toEqual(['Work a', 'Work b', 'Work c', 'Work d']);

    // A redeal that ranks c last must still leave it in slot 2.
    rerender(
      <DealBoard
        items={works(['x', 'y', 'z', 'c'])}
        size={4}
        preservedIds={['c']}
        renderCard={renderCard}
      />
    );

    expect(slotIds()[2]).toBe('Work c');
    expect(screen.getByTestId('deal-board-grid')).toHaveAttribute('data-held', '1');
  });

  it('marks held cards so the animation can skip them', () => {
    const { rerender } = render(
      <DealBoard items={works(['a', 'b'])} size={2} preservedIds={['a']} renderCard={renderCard} />
    );
    rerender(
      <DealBoard items={works(['a', 'q'])} size={2} preservedIds={['a']} renderCard={renderCard} />
    );

    const held = boardSlots().filter((node) => node.hasAttribute('data-held'));
    expect(held).toHaveLength(1);
    expect(held[0]?.querySelector('h3')?.textContent).toBe('Work a');
    expect(liveSlots().size).toBe(2);
  });

  it('renders the reject tray without hiding it', () => {
    render(
      <DealBoard
        items={works(['a', 'b'])}
        size={2}
        tray={works(['r1', 'r2'])}
        renderCard={renderCard}
      />
    );

    const tray = screen.getByRole('complementary', { name: /set aside — 2 works/i });
    expect(tray).toBeInTheDocument();
    expect(within(tray).getAllByRole('generic').length).toBeGreaterThan(0);

    // The name is on the landmark and nowhere on screen: the tray is a
    // position, not a labelled box, and a heading over a column of greyed
    // cards at the edge is a word doing no work.
    expect(within(tray).queryByText('Set aside')).not.toBeInTheDocument();
  });

  it('omits the tray when the board is not culling', () => {
    render(<DealBoard items={works(['a'])} size={1} renderCard={renderCard} />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('reserves the tray gutter even while it is empty', () => {
    // Measured in a browser: letting the gutter appear on the first redeal
    // shifted the grid 27-108px sideways and moved every "held" pick with it.
    // An empty array means "this board is culling", and the gutter is reserved
    // from the first deal so the geometry never changes underneath a pick.
    render(<DealBoard items={works(['a'])} size={1} tray={[]} renderCard={renderCard} />);

    const tray = screen.getByRole('complementary', { name: /set aside — empty/i });
    expect(tray).toBeInTheDocument();
    expect(tray).toHaveAttribute('data-empty');
  });

  it('collects picks at the front when motion is reduced', () => {
    setReducedMotion(true);

    render(
      <DealBoard
        items={works(['a', 'b', 'c', 'd'])}
        size={4}
        preservedIds={['c']}
        renderCard={renderCard}
      />
    );

    // Nothing is held on a first deal, so this only asserts the board still
    // renders under the reduced path.
    expect(boardSlots()).toHaveLength(4);
  });

  it('holds picks at the front rather than in place under reduced motion', () => {
    setReducedMotion(true);

    const { rerender } = render(
      <DealBoard
        items={works(['a', 'b', 'c', 'd'])}
        size={4}
        preservedIds={['c']}
        renderCard={renderCard}
      />
    );
    rerender(
      <DealBoard
        items={works(['x', 'y', 'z', 'c'])}
        size={4}
        preservedIds={['c']}
        renderCard={renderCard}
      />
    );

    expect(slotIds()[0]).toBe('Work c');
  });

  it('reports the deal to screen readers', () => {
    render(
      <DealBoard items={works(['a', 'b', 'c'])} size={3} renderCard={renderCard} />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('3 works on the board');
    expect(status).toHaveTextContent('3 new');
  });

  /*
   * Focus is the pointerless half of "the card under the cursor", so a card
   * that cannot hold focus cannot be picked or rejected by keyboard at all.
   * This regressed once already: the card rendered a *disabled* button
   * whenever it had nothing to open, which took the whole board out of the tab
   * order. Caught in a browser, not here, so it is asserted here now.
   */
  it('leaves every card able to hold focus with nothing to open', () => {
    render(<DealBoard items={works(['a', 'b'])} size={2} renderCard={renderCard} />);

    const cards = screen
      .getByTestId('deal-board-grid')
      .querySelectorAll('article.lt-slide');

    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toHaveAttribute('tabindex', '0');
    }
    // And no dead control left behind to take the tab stop instead.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('passes the rank and mark through to the card renderer', () => {
    const marks: Record<string, BoardMark> = {
      b: { flag: 'pick', hand: 'human' },
    };
    const seen: Array<{ id: string; rank: number; flag?: string }> = [];

    render(
      <DealBoard
        items={works(['a', 'b'])}
        size={2}
        marks={marks}
        renderCard={(work, context) => {
          seen.push({ id: work.id, rank: context.rank, flag: context.mark?.flag });
          return renderCard(work);
        }}
      />
    );

    expect(seen).toEqual([
      { id: 'a', rank: 1, flag: undefined },
      { id: 'b', rank: 2, flag: 'pick' },
    ]);
  });
});
