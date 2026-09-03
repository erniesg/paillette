import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  useCullingKeys,
  type CullingFlag,
} from '../use-culling-keys';

function Harness({
  targetId = 'work-1',
  onFlag,
  onCompare,
  enabled,
  withInput = false,
}: {
  targetId?: string | null;
  onFlag: (id: string, flag: CullingFlag | null) => void;
  onCompare?: () => void;
  enabled?: boolean;
  withInput?: boolean;
}) {
  useCullingKeys({ targetId, onFlag, onCompare, enabled });
  return withInput ? <input aria-label="utterance" /> : <div>board</div>;
}

describe('useCullingKeys', () => {
  it('picks, rejects and clears the targeted card', async () => {
    const onFlag = vi.fn();
    render(<Harness onFlag={onFlag} />);

    await userEvent.keyboard('p');
    expect(onFlag).toHaveBeenLastCalledWith('work-1', 'pick');

    await userEvent.keyboard('x');
    expect(onFlag).toHaveBeenLastCalledWith('work-1', 'reject');

    await userEvent.keyboard('u');
    expect(onFlag).toHaveBeenLastCalledWith('work-1', null);
  });

  it('takes the keys in either case', async () => {
    const onFlag = vi.fn();
    render(<Harness onFlag={onFlag} />);

    await userEvent.keyboard('P');
    expect(onFlag).toHaveBeenLastCalledWith('work-1', 'pick');
  });

  it('does nothing with no card targeted', async () => {
    const onFlag = vi.fn();
    render(<Harness targetId={null} onFlag={onFlag} />);

    await userEvent.keyboard('p');
    expect(onFlag).not.toHaveBeenCalled();
  });

  it('opens compare on C without needing a target', async () => {
    const onCompare = vi.fn();
    render(
      <Harness targetId={null} onFlag={vi.fn()} onCompare={onCompare} />
    );

    await userEvent.keyboard('c');
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  /*
   * The utterance bar and the board share one keyboard. Without this, typing
   * "explore" into the search field silently picks and rejects things behind
   * it — the `p`, the `x` in "explore"... The bar wins whenever it is focused.
   */
  it('stays out of the way while the human is typing', async () => {
    const onFlag = vi.fn();
    const onCompare = vi.fn();
    render(
      <Harness onFlag={onFlag} onCompare={onCompare} withInput />
    );

    const input = screen.getByLabelText('utterance');
    await userEvent.click(input);
    await userEvent.type(input, 'explore a picture');

    expect(onFlag).not.toHaveBeenCalled();
    expect(onCompare).not.toHaveBeenCalled();
    expect(input).toHaveValue('explore a picture');
  });

  /* Cmd-P is print and Ctrl-U is view source; neither belongs to the board. */
  it('leaves the browser its own shortcuts', async () => {
    const onFlag = vi.fn();
    render(<Harness onFlag={onFlag} />);

    await userEvent.keyboard('{Meta>}p{/Meta}');
    await userEvent.keyboard('{Control>}u{/Control}');

    expect(onFlag).not.toHaveBeenCalled();
  });

  it('binds nothing while disabled', async () => {
    const onFlag = vi.fn();
    render(<Harness onFlag={onFlag} enabled={false} />);

    await userEvent.keyboard('p');
    expect(onFlag).not.toHaveBeenCalled();
  });

  it('unbinds on unmount', async () => {
    const onFlag = vi.fn();
    const { unmount } = render(<Harness onFlag={onFlag} />);

    unmount();
    await userEvent.keyboard('p');

    expect(onFlag).not.toHaveBeenCalled();
  });

  it('ignores C when there is nothing to compare', async () => {
    const onFlag = vi.fn();
    render(<Harness onFlag={onFlag} />);

    await userEvent.keyboard('c');
    expect(onFlag).not.toHaveBeenCalled();
  });
});
