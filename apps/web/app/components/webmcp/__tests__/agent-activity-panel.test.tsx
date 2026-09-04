/**
 * The glyph and the log, rendered.
 *
 * The state machine has its own suite (`lib/webmcp/__tests__/activity-glyph`);
 * what is checked here is the wiring the state machine cannot see — that the
 * cells actually change on a timer, that they stop, that someone who asked for
 * less motion gets a state they can still read, and that closing the log does
 * not throw the session away.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentActivityPanel } from '../agent-activity-panel';
import { GLYPH_STILLS, IDLE_FRAME } from '~/lib/webmcp/activity-glyph';
import {
  __resetWebMcpStateForTest,
  setBridgeAttached,
  settleActivity,
  startActivity,
  requestConfirmation,
} from '~/lib/webmcp/store';

const cells = (): HTMLElement =>
  document.querySelector('.pa-activity-cells') as HTMLElement;

const glyphButton = () => screen.getByRole('button', { name: 'Agent activity' });

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.pa-activity-row'));

/** Drive the store the way the bridge does, from outside React. */
const run = (toolName: string, input: unknown = {}) => {
  let id = '';
  act(() => {
    id = startActivity(toolName, input);
  });
  return id;
};

const settle = (
  id: string,
  status: 'ok' | 'error' | 'aborted',
  summary: string | null,
  captured: { detail?: string | null; error?: string | null } = {}
) => {
  act(() => settleActivity(id, status, summary, captured));
};

const useReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

beforeEach(() => {
  __resetWebMcpStateForTest();
  useReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('presence', () => {
  it('renders nothing at all on a page with no WebMCP and no history', () => {
    const { container } = render(<AgentActivityPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a glyph and nothing else once a host is attached', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    expect(glyphButton()).toBeInTheDocument();
    expect(cells()).toHaveTextContent(IDLE_FRAME);
    expect(cells().dataset.phase).toBe('idle');
    // Collapsed by default: no log, and no word anywhere saying what this is.
    expect(document.querySelector('.pa-activity-log')).toBeNull();
    expect(document.body.textContent).not.toContain('Agent activity');
  });
});

describe('the animation', () => {
  it('moves while a tool runs, and settles when it stops', () => {
    vi.useFakeTimers();
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('search_artworks', { query: 'storm' });
    expect(cells().dataset.phase).toBe('running');
    expect(cells().dataset.kind).toBe('scan');

    const first = cells().textContent;
    act(() => vi.advanceTimersByTime(120));
    const second = cells().textContent;
    expect(second).not.toBe(first);

    settle(id, 'ok', '12 results');
    expect(cells().dataset.phase).toBe('idle');
    expect(cells()).toHaveTextContent(IDLE_FRAME);

    // And it is genuinely stopped, not merely showing a still frame.
    const resting = cells().textContent;
    act(() => vi.advanceTimersByTime(2_000));
    expect(cells().textContent).toBe(resting);
  });

  it('does not look the same for two different kinds of work', () => {
    vi.useFakeTimers();
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const collect = (tool: string) => {
      const id = run(tool);
      const frames = new Set<string>();
      for (let step = 0; step < 8; step += 1) {
        frames.add(cells().textContent ?? '');
        act(() => vi.advanceTimersByTime(360));
      }
      settle(id, 'ok', 'done');
      return frames;
    };

    const searching = collect('search_artworks');
    const describing = collect('describe_artwork');

    expect(searching.size).toBeGreaterThan(1);
    expect(describing.size).toBeGreaterThan(1);
    // No shared frame at all — the two motions have nothing in common.
    for (const frame of searching) expect(describing.has(frame)).toBe(false);
  });

  it('follows the newest of several calls in flight', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    run('search_artworks');
    run('describe_artwork');
    run('redeal');

    expect(cells().dataset.kind).toBe('deal');
    expect(glyphButton().dataset.running).toBe('3');
  });

  it('rests as a failure when a tool refuses, without throwing', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('flag_artworks', { flags: [] });
    // The tools answer refusals rather than throwing them, so `ok` here still
    // has to read as a failure on screen.
    settle(id, 'ok', 'UNKNOWN_ARTWORK: no such work', {
      error: 'UNKNOWN_ARTWORK: no such work',
    });

    expect(cells().dataset.phase).toBe('failed');
    expect(cells()).toHaveTextContent('×');
  });
});

describe('prefers-reduced-motion', () => {
  it('changes state without moving', () => {
    vi.useFakeTimers();
    useReducedMotion(true);
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('search_artworks');
    const still = cells().textContent;
    expect(cells().dataset.phase).toBe('running');
    expect(still).toBe(GLYPH_STILLS.scan);

    act(() => vi.advanceTimersByTime(3_000));
    expect(cells().textContent).toBe(still);

    settle(id, 'ok', 'done');
    expect(cells()).toHaveTextContent(IDLE_FRAME);
  });

  it('still says which kind of work it is', () => {
    useReducedMotion(true);
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const search = run('search_artworks');
    expect(cells().textContent).toBe(GLYPH_STILLS.scan);
    settle(search, 'ok', 'done');

    run('redeal');
    expect(cells().textContent).toBe(GLYPH_STILLS.deal);
    expect(GLYPH_STILLS.deal).not.toBe(GLYPH_STILLS.scan);
  });
});

describe('the log', () => {
  it('opens on the glyph and shows the call as data', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('search_artworks', { query: 'storm at sea', topK: 12 });
    settle(id, 'ok', '12 results', { detail: '{\n  "count": 12\n}' });

    fireEvent.click(glyphButton());

    const [row] = rows();
    expect(row).toBeDefined();
    expect(row!.dataset.tool).toBe('search_artworks');
    expect(row!.textContent).toContain('search_artworks');
    expect(row!.textContent).toContain('{"query":"storm at sea","topK":12}');
    expect(row!.textContent).toContain('12 results');
    expect(row!.textContent).toMatch(/\d+ms/);
  });

  it('tells a running call from a finished one', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const done = run('get_view_context');
    settle(done, 'ok', 'ok');
    run('search_by_exemplars', { positiveIds: ['a'] });

    fireEvent.click(glyphButton());

    const [finished, running] = rows();
    expect(finished!.dataset.running).toBe('false');
    expect(running!.dataset.running).toBe('true');
    expect(running!.textContent).toContain('···');
  });

  it('shows an error as an error, in the words the tool used', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('redeal', { keep: 'picks' });
    settle(id, 'error', 'Failed to fetch', { error: 'Failed to fetch' });

    fireEvent.click(glyphButton());

    const [row] = rows();
    expect(row!.dataset.bad).toBe('true');
    expect(row!.textContent).toContain('Failed to fetch');
  });

  it('reads downwards, oldest first, when a turn fires eight tools', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const names = [
      'get_view_context',
      'search_artworks',
      'search_by_color',
      'search_by_exemplars',
      'flag_artworks',
      'redeal',
      'set_view',
      'describe_artwork',
    ];
    for (const name of names) settle(run(name), 'ok', 'done');

    fireEvent.click(glyphButton());

    expect(rows().map((row) => row.dataset.tool)).toEqual(names);
  });

  it('expands a call onto its arguments and its result', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('search_by_exemplars', { positiveIds: ['nga-1'] });
    settle(id, 'ok', '12 results', {
      detail: '{\n  "results": [\n    "nga-9"\n  ]\n}',
    });

    fireEvent.click(glyphButton());
    const [row] = rows();
    expect(row!.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(row!);
    const detail = document.querySelector('.pa-activity-detail') as HTMLElement;
    expect(detail.textContent).toContain('"positiveIds"');
    expect(detail.textContent).toContain('"nga-9"');
  });

  it('separates what went in from what came back with a mark, not a label', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    const id = run('search_artworks', { query: 'storm' });
    settle(id, 'ok', '12 results', { detail: '{\n  "count": 12\n}' });

    fireEvent.click(glyphButton());
    fireEvent.click(rows()[0]!);

    const detail = document.querySelector('.pa-activity-detail') as HTMLElement;
    // Position and one arrow say which block is which; a wall label never names
    // its fields either.
    expect(detail.querySelector('.pa-activity-turn')?.textContent).toBe('→');
    expect(
      detail.querySelector('.pa-activity-turn')?.getAttribute('aria-hidden')
    ).toBe('true');

    // The words survive only for a reader who cannot see the position.
    const visible = Array.from(detail.querySelectorAll('pre')).map((node) =>
      Array.from(node.childNodes)
        .filter(
          (child) =>
            !(
              child instanceof HTMLElement &&
              child.classList.contains('pa-activity-sr')
            )
        )
        .map((child) => child.textContent)
        .join('')
    );
    expect(visible.join(' ')).not.toContain('arguments');
    expect(visible.join(' ')).not.toContain('result');
    expect(detail.textContent).toContain('arguments');
    expect(detail.textContent).toContain('result');
  });

  it('says how much of the session it had to drop', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    for (let call = 0; call < 125; call += 1) {
      settle(run('get_view_context', { call }), 'ok', 'ok');
    }

    fireEvent.click(glyphButton());
    expect(rows()).toHaveLength(120);
    expect(
      document.querySelector('.pa-activity-earlier')?.textContent?.trim()
    ).toBe('… 5 earlier');
  });

  it('keeps its history when the human closes it', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    settle(run('search_artworks', { query: 'storm' }), 'ok', '12 results');
    settle(run('redeal', { keep: 'picks' }), 'ok', '12 dealt');

    fireEvent.click(glyphButton());
    expect(rows()).toHaveLength(2);

    fireEvent.click(glyphButton());
    expect(document.querySelector('.pa-activity-log')).toBeNull();

    fireEvent.click(glyphButton());
    expect(rows().map((row) => row.dataset.tool)).toEqual([
      'search_artworks',
      'redeal',
    ]);
  });

  it('gets out of the way when the human reaches for the page', () => {
    // The log is an opaque overlay across the lower-left of the board, which is
    // where the cards are. Driving it in a browser found the obvious
    // consequence: with the log open, a click meant for a card beside it went
    // nowhere useful. Listening on pointerdown without preventing anything
    // means the click still lands where it was aimed.
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);
    settle(run('search_artworks', { query: 'storm' }), 'ok', '12 results');

    fireEvent.click(glyphButton());
    expect(document.querySelector('.pa-activity-log')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.pa-activity-log')).toBeNull();
  });

  it('stays open when the pointer lands inside it', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);
    settle(run('search_artworks', { query: 'storm' }), 'ok', '12 results');

    fireEvent.click(glyphButton());
    fireEvent.pointerDown(rows()[0]!);
    expect(document.querySelector('.pa-activity-log')).toBeTruthy();
  });

  it('closes on Escape', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);
    settle(run('get_view_context'), 'ok', 'ok');

    fireEvent.click(glyphButton());
    expect(document.querySelector('.pa-activity-log')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.pa-activity-log')).toBeNull();
  });

  it('does not open itself when the agent works', () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    for (const name of ['get_view_context', 'search_artworks', 'set_results']) {
      settle(run(name), 'ok', 'done');
    }

    expect(document.querySelector('.pa-activity-log')).toBeNull();
  });
});

describe('the consent gate', () => {
  it('opens the log by itself, because that is where the answer is given', async () => {
    act(() => setBridgeAttached(true));
    render(<AgentActivityPanel />);

    let answered: Promise<boolean>;
    act(() => {
      answered = requestConfirmation({
        toolName: 'create_collection',
        title: 'Storm-lit seascapes',
        detail: '2 works',
      });
    });

    const ask = document.querySelector('.pa-activity-ask') as HTMLElement;
    expect(ask).toBeTruthy();
    expect(ask.textContent).toContain('create_collection');
    expect(ask.textContent).toContain('Storm-lit seascapes');

    // A question waiting on an answer cannot be dismissed by looking away.
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.pa-activity-ask')).toBeTruthy();

    fireEvent.click(within(ask).getByRole('button', { name: 'Decline' }));
    await expect(answered!).resolves.toBe(false);
  });
});
