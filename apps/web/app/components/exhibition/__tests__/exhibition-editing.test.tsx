import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as drafts from '~/lib/exhibition-draft';
import { ExhibitionView } from '../exhibition-view';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';

const navigate = vi.fn();
vi.mock('@remix-run/react', () => ({
  useLocation: () => ({
    pathname: '/e/abc1234',
    search: '?frame=oak',
    hash: '',
  }),
  useNavigate: () => navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('~/lib/room/capability', () => ({ canRenderRoom: () => false }));
const original: ExhibitionPage = {
  title: 'Quiet mornings',
  statement: 'Small scenes of daily life.',
  statementByAgent: false,
  works: [
    {
      artworkId: 'one',
      title: 'A work',
      artist: 'Artist',
      date: '1900',
      medium: 'Oil',
      accession: null,
      sourceUrl: null,
      imageUrl: null,
      label: null,
      labelByAgent: false,
      dimensions: null,
    },
  ],
  missing: 0,
  code: 'abc1234',
  canonicalUrl: 'http://localhost/e/abc1234',
  institution: 'Museum',
  institutionUrl: 'https://example.com',
  rights: 'Open access',
};
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  navigate.mockClear();
});

describe('editing an exhibition copy', () => {
  it('offers an editor for a work with no label and keeps the source snapshot unchanged', async () => {
    const user = userEvent.setup();
    render(<ExhibitionView page={original} />);
    await user.click(screen.getByRole('button', { name: 'Edit labels' }));
    const input = screen.getByRole('textbox', { name: /Wall label/i });
    await user.type(input, 'A quiet moment held in paint.');
    await user.click(screen.getByRole('button', { name: 'Save label' }));
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(
      screen.getByText('A quiet moment held in paint.')
    ).toBeInTheDocument();
    expect(original.works[0]?.label).toBeNull();
  });
  it('preserves the exhibition URL when choosing another frame', async () => {
    const user = userEvent.setup();
    render(<ExhibitionView page={original} />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Frame style' }),
      'black'
    );
    expect(navigate).toHaveBeenCalledWith(
      '/e/abc1234?frame=black',
      expect.anything()
    );
  });
  it('restores committed work labels when the same exhibit is reopened', async () => {
    const user = userEvent.setup();
    const view = render(<ExhibitionView page={original} />);
    await user.click(screen.getByRole('button', { name: 'Edit labels' }));
    await user.type(
      screen.getByRole('textbox', { name: /Wall label/i }),
      'My label.'
    );
    await user.click(screen.getByRole('button', { name: 'Save label' }));
    view.unmount();
    render(<ExhibitionView page={original} />);
    await waitFor(() =>
      expect(screen.getByText('My label.')).toBeInTheDocument()
    );
  });
  it('rejects a stale share result after the view changes', async () => {
    let resolveShare!: (url: string) => void;
    vi.spyOn(drafts, 'shareExhibitionCopy').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveShare = resolve;
        })
    );
    const user = userEvent.setup();
    const page = { ...original, collectionId: 'nga' };
    const view = render(<ExhibitionView page={page} template="room" />);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    view.rerender(<ExhibitionView page={page} template="page" />);
    await act(async () => {
      resolveShare('http://localhost/e/old?v=room');
    });
    expect(
      screen.getByText(
        'Your labels, frame, or view changed. Share again for the latest copy.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('http://localhost/e/old?v=room')
    ).not.toBeInTheDocument();
  });
  it('rejects a stale share result when another tab saves a label', async () => {
    let resolveShare!: (url: string) => void;
    vi.spyOn(drafts, 'shareExhibitionCopy').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveShare = resolve;
        })
    );
    const user = userEvent.setup();
    const page = { ...original, collectionId: 'nga' };
    render(<ExhibitionView page={page} />);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {
      localStorage.setItem(
        drafts.exhibitionDraftKey(page),
        drafts.serializeExhibitionDraft({
          one: { text: 'From another tab.', by: 'human' },
        })
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: drafts.exhibitionDraftKey(page),
          storageArea: localStorage,
          newValue: drafts.serializeExhibitionDraft({
            one: { text: 'From another tab.', by: 'human' },
          }),
        })
      );
      resolveShare('http://localhost/e/stale');
      await Promise.resolve();
    });
    expect(screen.getByText('From another tab.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your labels, frame, or view changed. Share again for the latest copy.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('http://localhost/e/stale')
    ).not.toBeInTheDocument();
  });
});
