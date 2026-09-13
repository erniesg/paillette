import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalkControls } from '../walk-controls';

describe('walking controls', () => {
  it('stops held keyboard movement when focus leaves the button', () => {
    const onMove = vi.fn();
    render(<WalkControls onMove={onMove} onReset={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Walk forward' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onMove).toHaveBeenLastCalledWith('forward', true);
    fireEvent.blur(button);
    expect(onMove).toHaveBeenLastCalledWith('forward', false);
  });
  it('releases every movement when editing locks navigation', () => {
    const onMove = vi.fn();
    const onReset = vi.fn();
    const view = render(<WalkControls onMove={onMove} onReset={onReset} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Turn left' }), {
      key: ' ',
    });
    view.rerender(<WalkControls onMove={onMove} onReset={onReset} disabled />);
    for (const direction of ['forward', 'backward', 'left', 'right']) {
      expect(onMove).toHaveBeenCalledWith(direction, false);
    }
    expect(
      screen.getByRole('button', { name: 'Back to entrance' })
    ).toBeDisabled();
  });
});
