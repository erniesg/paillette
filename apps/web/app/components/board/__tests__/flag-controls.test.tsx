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
import { beforeEach, describe, expect, it } from 'vitest';
import { FlagBadge, useCardFlagProps } from '../flag-controls';
import { __resetFlagsForTest, getFlag, setFlag } from '~/lib/webmcp/flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
} from '~/lib/webmcp/store';

const Card = ({ artworkId }: { artworkId: string }) => {
  const flagProps = useCardFlagProps(artworkId);
  return (
    <article {...flagProps} className="paillette-card">
      <FlagBadge artworkId={artworkId} title="Estuary at Dusk" />
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
});
