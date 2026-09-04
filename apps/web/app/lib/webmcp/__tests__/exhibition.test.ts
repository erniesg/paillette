/**
 * The exhibition: merge semantics, and who owns which words.
 *
 * The property worth protecting is not that the writes work. It is that the
 * agent cannot take a sentence away from the person who wrote it — not by
 * overwriting it, not by rewriting it a turn later, and not by restating the
 * whole document to change one label.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '../artwork-index';
import { __resetFlagsForTest, setFlag } from '../flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setBoard,
} from '../store';
import {
  __resetTurnStateForTest,
  isEmptyTurn,
  peekTurn,
  prepareTurn,
  toTurnPayload,
} from '../turn';
import {
  __resetExhibitionForTest,
  acceptProposal,
  declineProposal,
  dissolveRegion,
  hasExhibition,
  listHungWorks,
  renameRegion,
  resolveHang,
  setRegions,
  writeExhibition,
  EXHIBITION_MAX_WORKS,
  STATEMENT_MAX_CHARS,
  TITLE_MAX_CHARS,
} from '../exhibition';
import { createPailletteTools, type ToolContext } from '../tools';
import type { WebMcpTool } from '../registry';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    galleryId: 'nga',
    orgId: 'nga',
    title: `Work ${id}`,
    artist: 'A. Painter',
    year: 1888,
    imageUrl: `https://assets.example/${id}.jpg`,
    thumbnailUrl: `https://assets.example/${id}-thumb.jpg`,
    similarity: 0.7,
    metadata: {},
  }) as unknown as ArtworkSearchResult;

const context: ToolContext = {
  navigate: vi.fn(),
  getPageContext: () => ({
    pathname: '/nga/search',
    search: '',
    collectionId: 'nga',
    query: '',
    facet: null,
    colour: null,
  }),
};

let tools: Map<string, WebMcpTool>;

const call = (name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(input, {}) as Promise<Record<string, any>>;
};

const board = (ids: string[]) =>
  setBoard({
    order: ids,
    dealt: ids,
    note: null,
    lastChangeBy: 'agent',
    redeals: 1,
    at: Date.now(),
  });

const exhibition = () => getWebMcpState().exhibition;

beforeEach(() => {
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetTurnStateForTest();
  __resetExhibitionForTest();
  rememberArtworks(['a', 'b', 'c', 'd', 'e'].map(artwork));
  tools = new Map(
    createPailletteTools(context).map((tool) => [tool.name, tool])
  );
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('partial writes merge', () => {
  it('changes one label without restating the rest of the show', () => {
    writeExhibition({ title: 'Weather', statement: 'About the sky.' }, { by: 'agent' });
    writeExhibition(
      {
        works: [
          { artworkId: 'a', label: 'First label.' },
          { artworkId: 'b', label: 'Second label.' },
        ],
      },
      { by: 'agent' }
    );

    writeExhibition(
      { works: [{ artworkId: 'b', label: 'Rewritten.' }] },
      { by: 'agent' }
    );

    const state = exhibition();
    expect(state.title.current?.value).toBe('Weather');
    expect(state.statement.current?.value).toBe('About the sky.');
    expect(state.labels.a?.current?.value).toBe('First label.');
    expect(state.labels.b?.current?.value).toBe('Rewritten.');
  });

  it('leaves the title alone when only the statement is written', () => {
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    writeExhibition({ statement: 'About departure.' }, { by: 'agent' });
    expect(exhibition().title.current?.value).toBe('Leaving');
  });

  it('clips to museum length rather than refusing', () => {
    writeExhibition(
      { title: 'x'.repeat(400), statement: 'y'.repeat(2000) },
      { by: 'agent' }
    );
    expect(exhibition().title.current?.value).toHaveLength(TITLE_MAX_CHARS);
    expect(exhibition().statement.current?.value).toHaveLength(
      STATEMENT_MAX_CHARS
    );
  });
});

describe('a field the human has edited is theirs', () => {
  it('parks an agent rewrite as a proposal instead of overwriting', () => {
    writeExhibition({ statement: 'This is about weather.' }, { by: 'agent' });
    writeExhibition({ statement: 'It is about leaving.' }, { by: 'human' });

    const result = writeExhibition(
      { statement: 'A study of atmospheric conditions.' },
      { by: 'agent' }
    );

    expect(exhibition().statement.current?.value).toBe('It is about leaving.');
    expect(exhibition().statement.current?.by).toBe('human');
    expect(exhibition().statement.proposed?.value).toBe(
      'A study of atmospheric conditions.'
    );
    expect(result.deferred).toEqual([
      {
        field: 'statement',
        current: 'It is about leaving.',
        proposed: 'A study of atmospheric conditions.',
      },
    ]);
    expect(result.changed).not.toContain('statement');
  });

  it('protects a human label from an agent rewrite', () => {
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'The agent’s reading.' }] },
      { by: 'agent' }
    );
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'Mine.' }] },
      { by: 'human' }
    );
    const result = writeExhibition(
      { works: [{ artworkId: 'a', label: 'Theirs again.' }] },
      { by: 'agent' }
    );

    expect(exhibition().labels.a?.current?.value).toBe('Mine.');
    expect(result.deferred[0]?.field).toBe('label:a');
  });

  it('lets the agent overwrite its own draft freely', () => {
    writeExhibition({ title: 'First draft' }, { by: 'agent' });
    const result = writeExhibition({ title: 'Second draft' }, { by: 'agent' });
    expect(exhibition().title.current?.value).toBe('Second draft');
    expect(result.deferred).toHaveLength(0);
  });

  it('keeps the human’s words through repeated agent rewrites', () => {
    writeExhibition({ statement: 'It is about leaving.' }, { by: 'human' });
    for (const attempt of ['one', 'two', 'three']) {
      writeExhibition({ statement: attempt }, { by: 'agent' });
    }
    expect(exhibition().statement.current?.value).toBe('It is about leaving.');
    expect(exhibition().statement.proposed?.value).toBe('three');
  });

  it('a human edit answers and clears a pending proposal', () => {
    writeExhibition({ statement: 'Weather.' }, { by: 'human' });
    writeExhibition({ statement: 'Atmospherics.' }, { by: 'agent' });
    expect(exhibition().statement.proposed).not.toBeNull();

    writeExhibition({ statement: 'Leaving, and being left.' }, { by: 'human' });
    expect(exhibition().statement.proposed).toBeNull();
    expect(exhibition().statement.current?.value).toBe('Leaving, and being left.');
  });
});

describe('proposals', () => {
  it('accepting keeps the agent as the author and makes the field the human’s', () => {
    writeExhibition({ title: 'Mine' }, { by: 'human' });
    writeExhibition({ title: 'Theirs' }, { by: 'agent' });
    acceptProposal('title');

    const field = exhibition().title;
    expect(field.current?.value).toBe('Theirs');
    // Credit is honest: the agent wrote the words.
    expect(field.current?.by).toBe('agent');
    // But it is now held, so the agent may not overwrite it again.
    expect(field.current?.heldByHuman).toBe(true);
    expect(field.proposed).toBeNull();

    writeExhibition({ title: 'Theirs, revised' }, { by: 'agent' });
    expect(exhibition().title.current?.value).toBe('Theirs');
  });

  it('declining drops the proposal and leaves the human’s text', () => {
    writeExhibition({ statement: 'Mine.' }, { by: 'human' });
    writeExhibition({ statement: 'Theirs.' }, { by: 'agent' });
    declineProposal('statement');
    expect(exhibition().statement.proposed).toBeNull();
    expect(exhibition().statement.current?.value).toBe('Mine.');
  });

  it('accepting a label proposal works the same way', () => {
    writeExhibition({ works: [{ artworkId: 'a', label: 'Mine.' }] }, { by: 'human' });
    writeExhibition({ works: [{ artworkId: 'a', label: 'Theirs.' }] }, { by: 'agent' });
    acceptProposal({ artworkId: 'a' });
    expect(exhibition().labels.a?.current?.value).toBe('Theirs.');
    expect(exhibition().labels.a?.current?.heldByHuman).toBe(true);
  });

  it('does not re-park an identical proposal', () => {
    writeExhibition({ title: 'Leaving' }, { by: 'human' });
    const result = writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    expect(exhibition().title.proposed).toBeNull();
    expect(result.deferred).toHaveLength(0);
  });
});

describe('the hang', () => {
  it('follows the board', () => {
    board(['a', 'b', 'c']);
    expect(resolveHang()).toEqual(['a', 'b', 'c']);
  });

  it('drops a work the human rejected, without anyone asking', () => {
    board(['a', 'b', 'c']);
    setFlag('b', 'reject', { by: 'human' });
    expect(resolveHang()).toEqual(['a', 'c']);
  });

  it('ignores an agent’s provisional reject', () => {
    board(['a', 'b', 'c']);
    setFlag('b', 'reject', { by: 'agent', reason: 'too busy' });
    expect(resolveHang()).toContain('b');
  });

  it('keeps labels through a redeal that changes the board', () => {
    board(['a', 'b', 'c']);
    writeExhibition({ works: [{ artworkId: 'a', label: 'Held.' }] }, { by: 'agent' });
    board(['a', 'd', 'e']);
    expect(resolveHang()).toEqual(['a', 'd', 'e']);
    expect(exhibition().labels.a?.current?.value).toBe('Held.');
  });

  it('falls back to the human’s picks when there is no board', () => {
    setFlag('c', 'pick', { by: 'human' });
    expect(resolveHang()).toEqual(['c']);
  });

  it('honours an explicit position', () => {
    board(['a', 'b', 'c']);
    writeExhibition({ works: [{ artworkId: 'c', position: 0 }] }, { by: 'agent' });
    expect(resolveHang()).toEqual(['c', 'a', 'b']);
  });

  it('takes a work off the wall on removeArtworkIds and puts it back when named', () => {
    board(['a', 'b', 'c']);
    writeExhibition({ removeArtworkIds: ['b'] }, { by: 'agent' });
    expect(resolveHang()).toEqual(['a', 'c']);

    writeExhibition({ works: [{ artworkId: 'b' }] }, { by: 'agent' });
    expect(resolveHang()).toContain('b');
  });

  it('caps the hang', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `w${index}`);
    rememberArtworks(ids.map(artwork));
    board(ids);
    expect(resolveHang()).toHaveLength(EXHIBITION_MAX_WORKS);
  });

  it('reports labels and positions together', () => {
    board(['a', 'b']);
    writeExhibition({ works: [{ artworkId: 'b', label: 'Second.' }] }, { by: 'agent' });
    expect(listHungWorks()).toEqual([
      {
        artworkId: 'a',
        position: 0,
        label: null,
        labelBy: null,
        labelHeldByHuman: false,
        proposedLabel: null,
      },
      {
        artworkId: 'b',
        position: 1,
        label: 'Second.',
        labelBy: 'agent',
        labelHeldByHuman: false,
        proposedLabel: null,
      },
    ]);
  });

  it('is not a show until someone writes something', () => {
    board(['a', 'b']);
    expect(hasExhibition()).toBe(false);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    expect(hasExhibition()).toBe(true);
  });
});

describe('set_exhibition and get_exhibition', () => {
  it('round-trips through the tool surface with provenance', async () => {
    board(['a', 'b']);
    await call('set_exhibition', {
      title: 'Leaving',
      statement: 'A show about departure.',
      works: [{ artworkId: 'a', label: 'The boat is already gone.' }],
    });

    const view = await call('get_exhibition');
    expect(view.ok).toBe(true);
    expect(view.title).toEqual({ text: 'Leaving', by: 'agent' });
    expect(view.works[0]).toMatchObject({
      artworkId: 'a',
      position: 0,
      title: 'Work a',
      label: 'The boat is already gone.',
      labelBy: 'agent',
    });
    expect(view.unlabelled).toBe(1);
  });

  it('reports what it could not overwrite, with the human’s wording', async () => {
    board(['a']);
    writeExhibition({ statement: 'It is about leaving.' }, { by: 'human' });
    const result = await call('set_exhibition', {
      statement: 'It is about weather.',
    });
    expect(result.ok).toBe(true);
    expect(result.deferred).toEqual([
      {
        field: 'statement',
        current: 'It is about leaving.',
        proposed: 'It is about weather.',
      },
    ]);
    expect(result.statement).toMatchObject({
      text: 'It is about leaving.',
      by: 'human',
      theirs: true,
      yourUnacceptedProposal: 'It is about weather.',
    });
  });

  it('refuses an empty call rather than silently doing nothing', async () => {
    const result = await call('set_exhibition', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('refuses a works entry with no artworkId', async () => {
    const result = await call('set_exhibition', { works: [{ label: 'orphan' }] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('refuses works that is not an array', async () => {
    const result = await call('set_exhibition', { works: 'a' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('surfaces the exhibition in get_view_context', async () => {
    board(['a']);
    await call('set_exhibition', { title: 'Leaving' });
    const view = await call('get_view_context');
    expect(view.exhibition.title.text).toBe('Leaving');
    expect(view.exhibition.works[0].artworkId).toBe('a');
  });
});

describe('a correction rides the next turn', () => {
  it('carries the human’s rewritten statement, and drains it once', () => {
    board(['a']);
    writeExhibition({ statement: 'About weather.' }, { by: 'agent' });
    writeExhibition(
      { statement: 'It is not about weather. It is about leaving.' },
      { by: 'human' }
    );

    const payload = toTurnPayload(prepareTurn('try again'));
    expect(payload.exhibitionEdits).toEqual([
      {
        field: 'statement',
        value: 'It is not about weather. It is about leaving.',
      },
    ]);

    // Once. The agent should see what changed since it last looked, not the
    // whole history restated every turn.
    expect(toTurnPayload(prepareTurn('and again')).exhibitionEdits).toEqual([]);
  });

  it('does not report the agent’s own writes back to it', () => {
    board(['a']);
    writeExhibition({ title: 'Weather', statement: 'x' }, { by: 'agent' });
    expect(prepareTurn('go').exhibitionEdits).toEqual([]);
  });

  it('names the work a rewritten label belongs to', () => {
    board(['a']);
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'Nobody is coming back.' }] },
      { by: 'human' }
    );
    expect(toTurnPayload(prepareTurn()).exhibitionEdits).toEqual([
      {
        field: 'label',
        work: 'Work a (A. Painter)',
        value: 'Nobody is coming back.',
      },
    ]);
  });

  it('reports only the last wording of a field they edited twice', () => {
    writeExhibition({ statement: 'first' }, { by: 'human' });
    writeExhibition({ statement: 'second' }, { by: 'human' });
    expect(prepareTurn().exhibitionEdits).toEqual([
      expect.objectContaining({ field: 'statement', value: 'second' }),
    ]);
  });

  it('makes a rewritten statement on its own a non-empty turn', () => {
    writeExhibition({ statement: 'About leaving.' }, { by: 'human' });
    expect(isEmptyTurn(peekTurn())).toBe(false);
  });

  it('a deterministic redeal does not spend the correction', async () => {
    board(['a']);
    setFlag('a', 'pick', { by: 'human' });
    writeExhibition({ statement: 'About leaving.' }, { by: 'human' });
    // peekTurn is what a redeal assembles; it must not drain.
    peekTurn();
    expect(prepareTurn('now tell the agent').exhibitionEdits).toHaveLength(1);
  });
});

describe('write_labels', () => {
  const stubLabels = (
    labels: { artworkId: string; label: string; source?: string }[],
    { status = 200 }: { status?: number } = {}
  ) => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        sent.push({
          url: String(input),
          body: init.body ? JSON.parse(String(init.body)) : {},
        });
        if (status !== 200) {
          return Response.json(
            {
              success: false,
              error: { code: 'LABELS_RATE_LIMITED', message: 'Too many.' },
            },
            { status }
          );
        }
        return Response.json({
          success: true,
          data: {
            collectionId: 'nga',
            model: 'gpt-5.6-terra',
            labels: labels.map((entry) => ({
              source: 'catalogue',
              ...entry,
            })),
            missing: [],
          },
        });
      })
    );
    return sent;
  };

  it('refuses without a statement, because a label needs a theme', async () => {
    board(['a']);
    const sent = stubLabels([]);
    const result = await call('write_labels', { artworkIds: ['a'] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NO_STATEMENT');
    expect(sent).toHaveLength(0);
  });

  it('sends the theme with the works and writes the labels onto the show', async () => {
    board(['a', 'b']);
    writeExhibition(
      { title: 'Leaving', statement: 'A show about departure.' },
      { by: 'agent' }
    );
    const sent = stubLabels([
      { artworkId: 'a', label: 'The boat is already gone.' },
      { artworkId: 'b', label: 'Nobody is on the quay.' },
    ]);

    const result = await call('write_labels', { artworkIds: ['a', 'b'] });

    expect(result.ok).toBe(true);
    expect(sent[0]?.url).toBe('/api/public-labels');
    expect(sent[0]?.body).toMatchObject({
      collectionId: 'nga',
      artworkIds: ['a', 'b'],
      statement: 'A show about departure.',
      title: 'Leaving',
    });
    expect(exhibition().labels.a?.current?.value).toBe(
      'The boat is already gone.'
    );
    expect(exhibition().labels.b?.current?.by).toBe('agent');
  });

  it('does not overwrite a label the human wrote', async () => {
    board(['a']);
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    writeExhibition({ works: [{ artworkId: 'a', label: 'Mine.' }] }, { by: 'human' });
    stubLabels([{ artworkId: 'a', label: 'Theirs.' }]);

    const result = await call('write_labels', { artworkIds: ['a'] });

    expect(exhibition().labels.a?.current?.value).toBe('Mine.');
    expect(exhibition().labels.a?.proposed?.value).toBe('Theirs.');
    expect(result.labels[0].proposedOnly).toBe(true);
    expect(result.deferred[0].field).toBe('label:a');
  });

  it('reports which labels were written from a caption and which were not', async () => {
    board(['a', 'b']);
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    stubLabels([
      { artworkId: 'a', label: 'Seen.', source: 'caption' },
      { artworkId: 'b', label: 'Read.', source: 'catalogue' },
    ]);

    const result = await call('write_labels', { artworkIds: ['a', 'b'] });
    expect(result.labels[0].writtenFrom).toBe('caption');
    expect(result.catalogueOnly).toEqual(['b']);
  });

  it('carries the voice steer', async () => {
    board(['a']);
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    const sent = stubLabels([{ artworkId: 'a', label: 'One.' }]);
    await call('write_labels', { artworkIds: ['a'], voice: 'plainer' });
    expect(sent[0]?.body.voice).toBe('plainer');
  });

  it('refuses an empty artworkIds', async () => {
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    const result = await call('write_labels', { artworkIds: [] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('refuses more than a board at a time', async () => {
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    const result = await call('write_labels', {
      artworkIds: Array.from({ length: 13 }, (_, index) => `w${index}`),
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOO_MANY_WORKS');
  });

  it('refuses ids this page has never seen', async () => {
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    const sent = stubLabels([]);
    const result = await call('write_labels', { artworkIds: ['ghost'] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ARTWORK_NOT_IN_SESSION');
    expect(sent).toHaveLength(0);
  });

  it('returns a shaped failure when the service refuses', async () => {
    board(['a']);
    writeExhibition({ statement: 'A show about departure.' }, { by: 'agent' });
    stubLabels([], { status: 429 });
    const result = await call('write_labels', { artworkIds: ['a'] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('LABELS_RATE_LIMITED');
  });
});

describe('annotate_atlas', () => {
  it('names groupings and gives each work one region', () => {
    board(['a', 'b', 'c']);
    const regions = setRegions(
      [
        { label: 'The ones about leaving', artworkIds: ['a', 'b'] },
        { label: 'The rest', artworkIds: ['b', 'c'] },
      ],
      { by: 'agent' }
    );
    expect(regions.map((region) => region.artworkIds)).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('drops a region left with no works after deduplication', () => {
    const regions = setRegions(
      [
        { label: 'First', artworkIds: ['a'] },
        { label: 'Second', artworkIds: ['a'] },
      ],
      { by: 'agent' }
    );
    expect(regions).toHaveLength(1);
  });

  it('dissolves and renames', () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    const [region] = exhibition().regions;
    renameRegion(region!.id, 'Departures');
    expect(exhibition().regions[0]).toMatchObject({
      label: 'Departures',
      by: 'human',
    });
    dissolveRegion(region!.id);
    expect(exhibition().regions).toHaveLength(0);
  });

  it('says so when the board is not in atlas view', async () => {
    const result = await call('annotate_atlas', {
      regions: [{ label: 'Leaving', artworkIds: ['a'] }],
    });
    expect(result.ok).toBe(true);
    expect(result.notVisible).toContain('atlas');
  });

  it('names back the regions the atlas will not draw', async () => {
    board(['a', 'b']);
    const result = await call('annotate_atlas', {
      regions: [
        { label: 'On the board', artworkIds: ['a'] },
        // Every work in this one has been redealt away, so the view draws
        // nothing for it. The agent has to be told, or it believes it named
        // something the human can see.
        { label: 'Redealt away', artworkIds: ['gone-1', 'gone-2'] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.notDrawn).toEqual(['Redealt away']);
    expect(result.notDrawnReason).toContain('not drawn');
  });

  it('says nothing about undrawn regions when they all draw', async () => {
    board(['a', 'b']);
    const result = await call('annotate_atlas', {
      regions: [{ label: 'On the board', artworkIds: ['a'] }],
    });
    expect(result.ok).toBe(true);
    expect(result.notDrawn).toBeUndefined();
  });

  it('refuses a region with no works', async () => {
    const result = await call('annotate_atlas', {
      regions: [{ label: 'Leaving', artworkIds: [] }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('refuses regions that is not an array', async () => {
    const result = await call('annotate_atlas', { regions: 'leaving' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('dissolves everything on an empty array', async () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    await call('annotate_atlas', { regions: [] });
    expect(exhibition().regions).toHaveLength(0);
  });
});
