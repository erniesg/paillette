/**
 * The glyph's state machine, and the promise that its six motions are actually
 * different from one another.
 *
 * The last one matters more than it looks. The whole claim is that someone can
 * tell searching from describing from dealing without reading a word; if two
 * kinds ever shared a frame table that claim would quietly become false and
 * nothing else in the suite would notice.
 */

import { describe, expect, it } from 'vitest';
import {
  CELLS,
  FAILED_FRAME,
  GLYPH_ANIMATIONS,
  GLYPH_ANNOUNCEMENT,
  GLYPH_STILLS,
  IDLE_FRAME,
  LIVE_ANNOUNCEMENT,
  LIVE_CONNECTING,
  LIVE_IDLE_FRAME,
  LIVE_LISTENING,
  LIVE_STILLS,
  glyphAnimationFor,
  kindForTool,
  readGlyphState,
  stillFrameFor,
  type GlyphKind,
} from '../activity-glyph';
import { PAILLETTE_TOOL_NAMES } from '../tools';
import type { ActivityEntry } from '../store';

let sequence = 0;

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => {
  sequence += 1;
  return {
    id: `activity-${sequence}`,
    toolName: 'search_artworks',
    input: {},
    status: 'ok',
    summary: null,
    detail: null,
    error: null,
    startedAt: 1_000,
    endedAt: 1_100,
    ...over,
  };
};

/** The store's ordering: newest first. */
const newestFirst = (...entries: ActivityEntry[]) => entries;

describe('kindForTool', () => {
  it('gives every registered tool a kind', () => {
    for (const name of PAILLETTE_TOOL_NAMES) {
      expect(GLYPH_ANNOUNCEMENT[kindForTool(name)]).toBeTruthy();
    }
  });

  it('separates the four kinds of work the brief names', () => {
    expect(kindForTool('search_artworks')).toBe('scan');
    expect(kindForTool('search_by_exemplars')).toBe('scan');
    expect(kindForTool('describe_artwork')).toBe('look');
    expect(kindForTool('redeal')).toBe('deal');
    expect(kindForTool('create_collection')).toBe('build');
  });

  it('treats an unknown tool as a read rather than a mutation', () => {
    // Guessing quiet is the cheaper mistake: a tool this map has never heard of
    // is more likely to be a query, and the loud motions should be earned.
    expect(kindForTool('some_tool_added_later')).toBe('read');
  });
});

describe('the frame tables', () => {
  const kinds = Object.keys(GLYPH_ANIMATIONS) as GlyphKind[];

  it('is exactly as wide as it claims, on every frame', () => {
    for (const kind of kinds) {
      for (const frame of GLYPH_ANIMATIONS[kind].frames) {
        expect([kind, [...frame].length]).toEqual([kind, CELLS]);
      }
      expect([kind, [...GLYPH_STILLS[kind]].length]).toEqual([kind, CELLS]);
    }
    expect([...IDLE_FRAME].length).toBe(CELLS);
    expect([...FAILED_FRAME].length).toBe(CELLS);
  });

  it('gives each kind a motion no other kind has', () => {
    const seen = new Map<string, GlyphKind>();
    for (const kind of kinds) {
      const signature = GLYPH_ANIMATIONS[kind].frames.join('|');
      expect(seen.get(signature)).toBeUndefined();
      seen.set(signature, kind);
    }
  });

  it('gives each kind a still no other kind has', () => {
    // This is the reduced-motion path. If two stills collided, a viewer who
    // asked for less motion would be shown a state they cannot distinguish.
    const stills = kinds.map((kind) => GLYPH_STILLS[kind]);
    expect(new Set(stills).size).toBe(stills.length);
    expect(stills).not.toContain(IDLE_FRAME);
    expect(stills).not.toContain(FAILED_FRAME);
  });

  it('actually moves — no kind holds one frame for its whole cycle', () => {
    for (const kind of kinds) {
      const frames = GLYPH_ANIMATIONS[kind].frames;
      expect([kind, new Set(frames).size > 1]).toEqual([kind, true]);
    }
  });

  it('paces a judgement more slowly than a search', () => {
    // Weighing that strobed would read as panic rather than deliberation.
    expect(GLYPH_ANIMATIONS.mark.ms).toBeGreaterThan(GLYPH_ANIMATIONS.scan.ms);
  });
});

describe('readGlyphState', () => {
  it('is idle before anything has run', () => {
    expect(readGlyphState([])).toEqual({
      phase: 'idle',
      kind: null,
      running: 0,
      live: 'off',
    });
  });

  it('takes its motion from the tool that is running', () => {
    const state = readGlyphState(
      newestFirst(
        entry({ toolName: 'describe_artwork', status: 'running', endedAt: null })
      )
    );
    expect(state).toEqual({ phase: 'running', kind: 'look', running: 1, live: 'off' });
  });

  it('follows the most recently started call when several are in flight', () => {
    // Eight tools in a turn overlap. The newest is the one whose result has
    // not landed, so it is the one the viewer is waiting on.
    const state = readGlyphState(
      newestFirst(
        entry({ toolName: 'redeal', status: 'running', startedAt: 3_000, endedAt: null }),
        entry({ toolName: 'describe_artwork', status: 'running', startedAt: 2_000, endedAt: null }),
        entry({ toolName: 'search_artworks', status: 'running', startedAt: 1_000, endedAt: null })
      )
    );
    expect(state).toEqual({ phase: 'running', kind: 'deal', running: 3, live: 'off' });
  });

  it('keeps running while one of several calls has settled', () => {
    const state = readGlyphState(
      newestFirst(
        entry({ toolName: 'search_artworks', status: 'running', startedAt: 2_000, endedAt: null }),
        entry({ toolName: 'get_view_context', status: 'ok', startedAt: 1_000 })
      )
    );
    expect(state.phase).toBe('running');
    expect(state.running).toBe(1);
  });

  it('settles when the last call finishes', () => {
    const state = readGlyphState(
      newestFirst(entry({ toolName: 'search_artworks', status: 'ok' }))
    );
    expect(state).toEqual({ phase: 'idle', kind: 'scan', running: 0, live: 'off' });
  });

  it('rests as a failure when the last call threw', () => {
    const state = readGlyphState(
      newestFirst(entry({ status: 'error', error: 'network unreachable' }))
    );
    expect(state.phase).toBe('failed');
    expect(stillFrameFor(state)).toBe(FAILED_FRAME);
  });

  it('rests as a failure when a tool refused without throwing', () => {
    // The tools answer `{ok:false,error:{…}}` rather than throwing, which is
    // the common way this codebase fails. A log that only noticed exceptions
    // would show a stale id as a successful call.
    const state = readGlyphState(
      newestFirst(
        entry({ status: 'ok', error: 'UNKNOWN_ARTWORK: no such work' })
      )
    );
    expect(state.phase).toBe('failed');
  });

  it('does not treat a cancelled call as a failure', () => {
    const state = readGlyphState(newestFirst(entry({ status: 'aborted' })));
    expect(state.phase).toBe('idle');
  });

  it('clears the failure once something runs again', () => {
    const state = readGlyphState(
      newestFirst(
        entry({ toolName: 'search_artworks', status: 'running', startedAt: 2_000, endedAt: null }),
        entry({ status: 'error', error: 'network unreachable', startedAt: 1_000 })
      )
    );
    expect(state.phase).toBe('running');
  });
});

describe('the live connection, on the same five cells', () => {
  it('changes nothing at all when no session is open', () => {
    // The typed path is the path. If this ever stops being true, the feature
    // has cost the thing it was meant to sit on top of.
    expect(readGlyphState([]).live).toBe('off');
    expect(
      stillFrameFor({ phase: 'idle', kind: null, running: 0, live: 'off' })
    ).toBe(IDLE_FRAME);
    expect(
      glyphAnimationFor({ phase: 'idle', kind: null, running: 0, live: 'off' })
    ).toBeNull();
  });

  it('wakes the resting mark without changing its width', () => {
    const state = readGlyphState([], 'on');
    expect(stillFrameFor(state)).toBe(LIVE_IDLE_FRAME);
    expect(stillFrameFor(state)).not.toBe(IDLE_FRAME);
    // Nothing on the row may move when a session opens.
    expect([...LIVE_IDLE_FRAME].length).toBe(CELLS);
    for (const frame of [...LIVE_CONNECTING.frames, ...LIVE_LISTENING.frames]) {
      expect([...frame].length).toBe(CELLS);
    }
    for (const still of Object.values(LIVE_STILLS)) {
      expect([...still].length).toBe(CELLS);
    }
  });

  it('lets tool work outrank the connection, both in motion and in words', () => {
    const searching = readGlyphState(
      newestFirst(
        entry({ toolName: 'search_artworks', status: 'running', endedAt: null })
      ),
      'listening'
    );
    // Both facts survive — the connection is still on the state — but the
    // thing the human is waiting on is the thing that animates.
    expect(searching.live).toBe('listening');
    expect(glyphAnimationFor(searching)).toBe(GLYPH_ANIMATIONS.scan);
    expect(stillFrameFor(searching)).toBe(GLYPH_STILLS.scan);
  });

  it('animates connecting and listening when nothing else is running', () => {
    expect(glyphAnimationFor(readGlyphState([], 'connecting'))).toBe(
      LIVE_CONNECTING
    );
    expect(glyphAnimationFor(readGlyphState([], 'listening'))).toBe(
      LIVE_LISTENING
    );
    // An open session at rest is a standing fact, not an event. Motion for it
    // would be the page fidgeting about its own plumbing.
    expect(glyphAnimationFor(readGlyphState([], 'on'))).toBeNull();
  });

  it('gives the live stills marks no tool kind already owns', () => {
    // Same promise the six kinds make to each other, extended: under
    // prefers-reduced-motion these are the only thing distinguishing the
    // states, so a collision is a state some people simply cannot perceive.
    const marks = [
      ...Object.values(GLYPH_STILLS),
      ...Object.values(LIVE_STILLS),
      IDLE_FRAME,
      FAILED_FRAME,
    ];
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('says nothing aloud about a session that is merely open', () => {
    // A screen reader announcing "live session open" on every re-render is the
    // audible form of helper text. Only the transitions are worth an interrupt.
    expect(LIVE_ANNOUNCEMENT.on).toBe('');
    expect(LIVE_ANNOUNCEMENT.off).toBe('');
    expect(LIVE_ANNOUNCEMENT.connecting).toBeTruthy();
    expect(LIVE_ANNOUNCEMENT.listening).toBeTruthy();
  });
});

describe('stillFrameFor', () => {
  it('draws the field when nothing is happening', () => {
    expect(
      stillFrameFor({ phase: 'idle', kind: 'scan', running: 0, live: 'off' })
    ).toBe(IDLE_FRAME);
  });

  it('draws the kind when something is', () => {
    expect(
      stillFrameFor({ phase: 'running', kind: 'deal', running: 1, live: 'off' })
    ).toBe(GLYPH_STILLS.deal);
  });
});
