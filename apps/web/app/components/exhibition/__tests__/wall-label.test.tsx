import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { WallLabel } from '../wall-label';
import { writeExhibition } from '~/lib/webmcp/exhibition';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
} from '~/lib/webmcp/store';
import {
  __resetAgentRequestForTest,
  onAgentTurnRequest,
} from '~/lib/webmcp/agent-request';

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetAgentRequestForTest();
});

describe('WallLabel', () => {
  it('offers an empty work an in-place wall-label editor', async () => {
    render(<WallLabel artworkId="a" title="Work a" />);

    expect(screen.getByRole('button', { name: 'Add wall label' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Wall label for Work a')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Add wall label' }));
    const label = screen.getByLabelText('Wall label for Work a');
    await userEvent.click(label);
    await userEvent.type(label, 'A human reading.');
    await userEvent.tab();

    expect(getWebMcpState().exhibition.labels.a?.current).toMatchObject({
      value: 'A human reading.',
      by: 'human',
      heldByHuman: true,
    });
  });

  it('asks the agent to write a label for this work only', async () => {
    const requests: unknown[] = [];
    onAgentTurnRequest((request) => requests.push(request));
    render(<WallLabel artworkId="a" title="Work a" />);

    await userEvent.click(screen.getByRole('button', { name: 'Suggest label' }));

    expect(requests).toEqual([
      expect.objectContaining({
        instruction: expect.stringContaining('write_labels with artworkIds: ["a"] only'),
        gestures: expect.objectContaining({
          selection: [{ id: 'a', title: 'Work a' }],
        }),
      }),
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The agent is preparing a label suggestion.'
    );
  });

  it('explains how to use label suggestions when Agent mode is unavailable', async () => {
    render(<WallLabel artworkId="a" title="Work a" />);

    await userEvent.click(screen.getByRole('button', { name: 'Suggest label' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Open Agent mode, then choose Suggest label to ask for a draft.'
    );
  });

  it('keeps an agent label editable', async () => {
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'The agent reading.' }] },
      { by: 'agent' }
    );
    render(<WallLabel artworkId="a" title="Work a" />);

    const label = screen.getByLabelText('Wall label for Work a');
    await userEvent.click(label);
    await userEvent.clear(label);
    await userEvent.type(label, 'My reading.');
    await userEvent.tab();

    expect(getWebMcpState().exhibition.labels.a?.current).toMatchObject({
      value: 'My reading.',
      by: 'human',
      heldByHuman: true,
    });
  });
});
