import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoUpCompare } from '../two-up-compare';
import type { LightTableWork } from '../light-table-card';

const left: LightTableWork = {
  id: 'a',
  title: 'Lumber Schooners at Evening',
  artist: 'Fitz Henry Lane',
  dateText: '1860',
  imageUrl: 'https://example.test/a.jpg',
};

const right: LightTableWork = {
  id: 'b',
  title: 'Estuary at Day’s End',
  artist: 'Unattributed',
  dateText: '1875',
  imageUrl: 'https://example.test/b.jpg',
};

const pair = [left, right] as const;

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

describe('TwoUpCompare', () => {
  beforeEach(() => {
    setReducedMotion(false);
  });

  it('renders nothing until there is a pair', () => {
    const { container } = render(<TwoUpCompare works={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hangs two works and the question between them', () => {
    render(
      <TwoUpCompare works={pair} question="Which is the light you meant?" />
    );

    expect(screen.getByText('Which is the light you meant?')).toBeVisible();
    expect(screen.getByAltText('Lumber Schooners at Evening')).toBeVisible();
    expect(screen.getByAltText('Estuary at Day’s End')).toBeVisible();
  });

  /*
   * The room's whole claim is that there is nothing in it. If a toolbar ever
   * gets added back, this fails — which is the point of asserting it.
   */
  it('puts nothing on screen but the works and the label', () => {
    render(<TwoUpCompare works={pair} question="Better one, or two?" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    // Two of them are the works themselves; the third is the close control,
    // which is clipped to a single pixel until a keyboard focuses it.
    expect(
      buttons.filter((button) => button.querySelector('img'))
    ).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Close compare' })).toHaveClass(
      'lt-two-up-escape'
    );
  });

  it('reports the side that was clicked, and its loser', async () => {
    const onChoose = vi.fn();
    render(<TwoUpCompare works={pair} onChoose={onChoose} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Choose Estuary at Day’s End by Unattributed',
      })
    );

    expect(onChoose).toHaveBeenCalledWith(right, left, 1);
  });

  it('answers with the arrow keys', async () => {
    const onChoose = vi.fn();
    render(<TwoUpCompare works={pair} onChoose={onChoose} />);

    await userEvent.keyboard('{ArrowLeft}');
    expect(onChoose).toHaveBeenLastCalledWith(left, right, 0);

    await userEvent.keyboard('{ArrowRight}');
    expect(onChoose).toHaveBeenLastCalledWith(right, left, 1);
  });

  it('leaves on Escape without answering', async () => {
    const onChoose = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TwoUpCompare works={pair} onChoose={onChoose} onDismiss={onDismiss} />
    );

    await userEvent.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('stops listening to the keyboard once the room closes', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <TwoUpCompare works={pair} onDismiss={onDismiss} />
    );

    rerender(<TwoUpCompare works={null} onDismiss={onDismiss} />);
    await userEvent.keyboard('{Escape}');

    expect(onDismiss).not.toHaveBeenCalled();
  });

  /*
   * The ink is the only thing that says who asked. If the hand stopped
   * reaching the DOM the question would silently render in the human's
   * graphite and the screenshot would show one hand instead of two.
   */
  it('carries the asking hand so the question takes that ink', () => {
    const { rerender } = render(
      <TwoUpCompare works={pair} question="Which?" />
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-hand', 'agent');

    rerender(<TwoUpCompare works={pair} question="Which?" hand="human" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-hand', 'human');
  });

  it('names itself by the question for a screen reader', () => {
    render(<TwoUpCompare works={pair} question="Warmer, or quieter?" />);
    expect(
      screen.getByRole('dialog', { name: 'Warmer, or quieter?' })
    ).toBeInTheDocument();
  });

  it('marks the room when motion is reduced', () => {
    setReducedMotion(true);
    render(<TwoUpCompare works={pair} question="Which?" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-reduced-motion');
  });
});
