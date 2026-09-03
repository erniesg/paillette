/**
 * The flag affordances as the human meets them, and as the visuals lane will
 * need to style them.
 *
 * The data attributes are a contract, not an implementation detail: provenance
 * ink is meant to be two CSS selectors and no JavaScript, which only works if
 * `data-flag-by` and `data-flag-provisional` are actually on the element.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagBadge, useCardFlagProps } from '../flag-controls';
import { __resetFlagsForTest, getFlag, setFlag } from '~/lib/webmcp/flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
} from '~/lib/webmcp/store';

// Shaped like the real card: the badge sits on top of a button that opens the
// artwork, which is exactly what shift-click has to get past.
const Card = ({
  artworkId,
  onOpen = () => {},
}: {
  artworkId: string;
  onOpen?: () => void;
}) => {
  const flagProps = useCardFlagProps(artworkId);
  return (
    <article {...flagProps} className="paillette-card">
      <FlagBadge artworkId={artworkId} title="Estuary at Dusk" />
      <button type="button" onClick={onOpen}>
        Open
      </button>
    </article>
  );
};

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
});

describe('FlagBadge', () => {
  it('offers three real buttons, each naming its key and its work', () => {
    render(<FlagBadge artworkId="a" title="Estuary at Dusk" />);

    expect(
      screen.getByRole('button', { name: 'Pick Estuary at Dusk (P)' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reject Estuary at Dusk (X)' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Unflag Estuary at Dusk (U)' })
    ).toBeTruthy();
  });

  it('reports pick and reject as toggles, and unflag as neither', () => {
    render(<FlagBadge artworkId="a" />);

    expect(screen.getByRole('button', { name: /Pick/ }).getAttribute('aria-pressed')).toBe('false');
    // "Unflag" is an action, not a state; claiming aria-pressed would be a lie.
    expect(
      screen.getByRole('button', { name: /Unflag/ }).hasAttribute('aria-pressed')
    ).toBe(false);
  });

  it('announces the flag once it is set', async () => {
    render(<FlagBadge artworkId="a" />);

    await userEvent.click(screen.getByRole('button', { name: /Pick/ }));

    expect(
      screen.getByRole('button', { name: /Pick/ }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(getFlag('a')).toMatchObject({ flag: 'pick', by: 'human' });
  });

  it('clicking the same key again clears it, exactly as the key press does', async () => {
    render(<FlagBadge artworkId="a" />);
    const pick = screen.getByRole('button', { name: /Pick/ });

    await userEvent.click(pick);
    await userEvent.click(pick);

    expect(getFlag('a')).toBeNull();
  });

  it('reflects a flag the agent set, without the human touching anything', () => {
    setFlag('a', 'reject', { by: 'agent', reason: 'too busy' });
    const { container } = render(<FlagBadge artworkId="a" />);

    const badge = container.querySelector('.paillette-flag-badge');
    expect(badge?.getAttribute('data-flag')).toBe('reject');
    expect(badge?.getAttribute('data-flag-by')).toBe('agent');
    expect(badge?.getAttribute('data-flag-provisional')).toBe('true');
  });
});

describe('useCardFlagProps', () => {
  it('exposes the hooks the visual pass needs', () => {
    setFlag('a', 'pick', { by: 'human' });
    const { container } = render(<Card artworkId="a" />);

    const card = container.querySelector('.paillette-card');
    expect(card?.getAttribute('data-artwork-id')).toBe('a');
    expect(card?.getAttribute('data-flag')).toBe('pick');
    expect(card?.getAttribute('data-flag-by')).toBe('human');
    expect(card?.getAttribute('data-flag-provisional')).toBe('false');
  });

  it('reports "none" for an unflagged card rather than omitting the attribute', () => {
    const { container } = render(<Card artworkId="a" />);

    expect(
      container.querySelector('.paillette-card')?.getAttribute('data-flag')
    ).toBe('none');
  });

  it('makes the hovered card the deictic anchor, so P lands on it', async () => {
    const { container } = render(<Card artworkId="a" />);
    const card = container.querySelector('.paillette-card') as HTMLElement;

    await userEvent.hover(card);
    expect(getWebMcpState().hovered).toBe('a');

    await userEvent.unhover(card);
    expect(getWebMcpState().hovered).toBeNull();
  });

  it('gives the anchor to keyboard focus too, not only to the mouse', () => {
    render(
      <>
        <Card artworkId="a" />
      </>
    );
    const card = document.querySelector('.paillette-card') as HTMLElement;

    fireEvent.focus(card);

    expect(getWebMcpState().hovered).toBe('a');
  });

  it('does not steal the anchor from another card when it leaves', async () => {
    render(
      <>
        <Card artworkId="a" />
        <Card artworkId="b" />
      </>
    );
    const [first, second] = Array.from(
      document.querySelectorAll('.paillette-card')
    ) as HTMLElement[];

    await userEvent.hover(first!);
    await userEvent.hover(second!);
    // Leaving the first must not clear an anchor the second now owns.
    await userEvent.unhover(first!);

    expect(getWebMcpState().hovered).toBe('b');
  });

  it('makes shift-click mean "and this one" instead of opening the work', () => {
    const onOpen = vi.fn();
    render(<Card artworkId="a" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }), {
      shiftKey: true,
    });

    expect(getWebMcpState().selection).toEqual(['a']);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves a plain click completely alone', async () => {
    const onOpen = vi.fn();
    render(<Card artworkId="a" onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(getWebMcpState().selection).toEqual([]);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('marks the selection for whoever styles it', () => {
    const { container } = render(<Card artworkId="a" />);
    const card = container.querySelector('.paillette-card');
    expect(card?.getAttribute('data-selected')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }), {
      shiftKey: true,
    });

    expect(card?.getAttribute('data-selected')).toBe('true');
  });
});

describe('how loud the badge is', () => {
  it('stays quiet on a card nobody is pointing at', () => {
    const { container } = render(<Card artworkId="a" />);

    expect(
      container
        .querySelector('.paillette-flag-badge')
        ?.getAttribute('data-quiet')
    ).toBe('true');
    // Quiet, not absent: the buttons are still reachable by tab and by a
    // screen reader, which is the whole reason they are not unmounted.
    expect(screen.getByRole('button', { name: /Pick/ })).toBeTruthy();
  });

  it('speaks up on the card under the cursor', async () => {
    const { container } = render(<Card artworkId="a" />);
    await userEvent.hover(container.querySelector('.paillette-card') as HTMLElement);

    expect(
      container
        .querySelector('.paillette-flag-badge')
        ?.getAttribute('data-quiet')
    ).toBe('false');
  });

  it('a flag is a mark, so it stays visible once set', () => {
    setFlag('a', 'pick', { by: 'human' });
    const { container } = render(<Card artworkId="a" />);

    expect(
      container
        .querySelector('.paillette-flag-badge')
        ?.getAttribute('data-quiet')
    ).toBe('false');
  });
});
