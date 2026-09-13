import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HungWork } from '~/lib/exhibition-page.server';
import { LabelEditor } from '../label-editor';

const work = (overrides: Partial<HungWork> = {}): HungWork => ({
  artworkId: 'work-1',
  title: 'Harbour at dusk',
  artist: 'A. Painter',
  date: '1890',
  medium: 'Oil on canvas',
  accession: null,
  sourceUrl: null,
  imageUrl: 'https://images.example/harbour.jpg',
  label: null,
  labelByAgent: false,
  dimensions: null,
  ...overrides,
});

const renderEditor = (props: Partial<React.ComponentProps<typeof LabelEditor>> = {}) => {
  const onCommit = vi.fn();
  render(
    <LabelEditor
      work={work()}
      collectionId="nga"
      exhibitionTitle="Night water"
      exhibitionStatement="A show about the quiet after a port has emptied."
      onCommit={onCommit}
      {...props}
    />
  );
  return onCommit;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LabelEditor', () => {
  it('lets a curator save a missing label as theirs', async () => {
    const onCommit = renderEditor();
    const field = screen.getByRole('textbox', { name: 'Wall label for Harbour at dusk' });

    await userEvent.type(field, 'A late light stays on the water.');
    await userEvent.click(screen.getByRole('button', { name: 'Save label' }));

    expect(onCommit).toHaveBeenCalledWith('A late light stays on the water.', 'human');
  });

  it('reports unsaved work until the curator saves or discards it', async () => {
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });
    const field = screen.getByRole('textbox');

    await userEvent.type(field, 'A late light stays on the water.');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(field).toHaveValue('');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('does not clear dirty state when a parent supplies a new callback', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const props = {
      work: work(),
      collectionId: 'nga',
      exhibitionTitle: 'Night water',
      exhibitionStatement: 'A show about the quiet after a port has emptied.',
      onCommit: vi.fn(),
    };
    const view = render(<LabelEditor {...props} onDirtyChange={first} />);

    await userEvent.type(screen.getByRole('textbox'), 'Mine.');
    view.rerender(<LabelEditor {...props} onDirtyChange={second} />);

    expect(second).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(second).toHaveBeenLastCalledWith(false);
  });

  it('normalizes a whitespace-only save back to the committed label', async () => {
    const onDirtyChange = vi.fn();
    const onCommit = renderEditor({
      work: work({ label: 'The curator’s reading.' }),
      onDirtyChange,
    });
    const field = screen.getByRole('textbox');

    await userEvent.type(field, '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save label' }));

    expect(field).toHaveValue('The curator’s reading.');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('offers an AI label only as a suggestion and records acceptance as agent text', async () => {
    const onCommit = renderEditor();
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            labels: [
              { artworkId: 'work-1', label: 'The harbor holds the last warmth.', source: 'catalogue' },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal(
      'fetch',
      fetcher
    );

    await userEvent.click(screen.getByRole('button', { name: 'Generate label' }));

    expect(await screen.findByText('The harbor holds the last warmth.')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/public-labels',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          collectionId: 'nga',
          artworkIds: ['work-1'],
          title: 'Night water',
          statement: 'A show about the quiet after a port has emptied.',
        }),
      })
    );
    expect(onCommit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }));
    expect(onCommit).toHaveBeenCalledWith('The harbor holds the last warmth.', 'agent');
  });

  it.each([429, 502])('keeps the current label when generation fails with %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    renderEditor({ work: work({ label: 'The curator’s reading.' }) });

    await userEvent.click(screen.getByRole('button', { name: 'Generate label' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t generate a label. Try again.');
    expect(screen.getByRole('textbox')).toHaveValue('The curator’s reading.');
  });

  it('rejects a response for a different work', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { labels: [{ artworkId: 'other-work', label: 'Wrong wall.' }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Generate label' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t generate a label. Try again.');
    expect(screen.queryByText('Wrong wall.')).toBeNull();
  });

  it('does not replace a draft edited while generation is pending', async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
    );
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Generate label' }));
    await userEvent.type(screen.getByRole('textbox'), 'My own words.');
    resolve?.(
      new Response(
        JSON.stringify({
          success: true,
          data: { labels: [{ artworkId: 'work-1', label: 'The agent’s words.' }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate label' })).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('My own words.');
    expect(screen.queryByText('The agent’s words.')).toBeNull();
  });

  it('unblocks generation when the editor changes to another work mid-request', async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
    );
    const props = {
      collectionId: 'nga',
      exhibitionTitle: 'Night water',
      exhibitionStatement: 'A show about the quiet after a port has emptied.',
      onCommit: vi.fn(),
    };
    const view = render(<LabelEditor {...props} work={work()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Generate label' }));
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    view.rerender(
      <LabelEditor {...props} work={work({ artworkId: 'work-2', title: 'Morning shore' })} />
    );

    expect(screen.getByRole('button', { name: 'Generate label' })).toBeEnabled();
    resolve?.(
      new Response(
        JSON.stringify({
          success: true,
          data: { labels: [{ artworkId: 'work-1', label: 'Stale.' }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await waitFor(() => expect(screen.queryByText('Stale.')).toBeNull());
  });
});
