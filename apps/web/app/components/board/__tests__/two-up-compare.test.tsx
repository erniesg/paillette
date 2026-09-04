import { render, screen, fireEvent } from '@testing-library/react';
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

  /*
   * `aria-modal="true"` is a promise that nothing behind the room is
   * reachable. Without a trap it is false: tabbing walks out into the grid
   * underneath, which is still focusable and now invisible.
   */
  it('keeps Tab inside the room', async () => {
    render(<TwoUpCompare works={pair} question="Which?" />);

    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1]!;

    last.focus();
    await userEvent.tab();

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps backwards off the front of the room', async () => {
    render(<TwoUpCompare works={pair} question="Which?" />);

    const buttons = screen.getAllByRole('button');
    buttons[0]!.focus();
    await userEvent.tab({ shift: true });

    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  /*
   * Dropping focus to the top of the document after a compare is how a
   * keyboard user loses their place on the board they were culling.
   */
  it('puts focus back where it came from on the way out', () => {
    const outside = document.createElement('button');
    outside.textContent = 'on the board';
    document.body.appendChild(outside);
    outside.focus();

    const { rerender } = render(<TwoUpCompare works={pair} question="Which?" />);
    expect(document.activeElement).not.toBe(outside);

    rerender(<TwoUpCompare works={null} question="Which?" />);
    expect(document.activeElement).toBe(outside);

    outside.remove();
  });

  /* No question, no label column holding the works apart for a missing caption. */
  it('omits the label entirely when there is no question', () => {
    const { container } = render(<TwoUpCompare works={pair} />);
    expect(container.querySelector('.lt-two-up-label')).toBeNull();
  });

  it('still hangs both works when an image fails to load', () => {
    render(<TwoUpCompare works={pair} question="Which?" />);

    const image = screen.getByAltText('Lumber Schooners at Evening');
    fireEvent.error(image);

    // The side keeps its caption and stays choosable; only the picture is gone.
    expect(screen.getByText('Lumber Schooners at Evening')).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Choose Lumber Schooners at Evening by Fitz Henry Lane',
      })
    ).toBeEnabled();
  });

  it('marks the room when motion is reduced', () => {
    setReducedMotion(true);
    render(<TwoUpCompare works={pair} question="Which?" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-reduced-motion');
  });
});
