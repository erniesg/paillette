import { describe, expect, it } from 'vitest';
import {
  annotateForAgent,
  emptyScene,
  readScene,
  resolveDeixis,
  segmentUtterance,
  type DeicticScene,
  type SceneWork,
} from '../deixis';

const work = (id: string, title: string, artist = 'Fitz Henry Lane'): SceneWork => ({
  id,
  title,
  artist,
  thumbnailUrl: `https://example.test/${id}.jpg`,
});

const lane = work('nga-1', 'Lumber Schooners at Evening on Penobscot Bay');
const dusk = work('nga-2', "Estuary at Day's End");
const third = work('nga-3', 'Fallen Tree');

const scene = (over: Partial<DeicticScene> = {}): DeicticScene => ({
  ...emptyScene(),
  ...over,
});

describe('readScene', () => {
  it('reads the shape the WebMCP store holds', () => {
    const result = readScene({
      focused: { origin: 'human', artwork: { id: 'nga-1', title: 'A', artist: 'B' } },
      agentResults: { items: [{ id: 'nga-2', title: 'C', artist: null }] },
    });
    expect(result.focused?.id).toBe('nga-1');
    expect(result.visible.map((item) => item.id)).toEqual(['nga-2']);
  });

  it('reads the shape get_view_context returns', () => {
    const result = readScene({
      openArtwork: { openedBy: 'agent', artwork: { id: 'nga-9', title: 'A' } },
      humanResults: { visible: [{ id: 'nga-8', title: 'B' }] },
    });
    expect(result.focused?.id).toBe('nga-9');
    expect(result.visible.map((item) => item.id)).toEqual(['nga-8']);
  });

  it("prefers the agent's board, because that is what took over the canvas", () => {
    const result = readScene({
      agentResults: { items: [{ id: 'agent-1' }] },
      humanResults: { items: [{ id: 'human-1' }] },
    });
    expect(result.visible.map((item) => item.id)).toEqual(['agent-1']);
  });

  it('picks up hovered and selection the moment the page reports them', () => {
    const result = readScene({
      hovered: { id: 'nga-1' },
      selection: [{ id: 'nga-2' }, { id: 'nga-3' }],
    });
    expect(result.hovered?.id).toBe('nga-1');
    expect(result.selection.map((item) => item.id)).toEqual(['nga-2', 'nga-3']);
  });

  it('is an empty scene rather than a throw when handed nonsense', () => {
    expect(readScene(null)).toEqual(emptyScene());
    expect(readScene('nope')).toEqual(emptyScene());
    expect(readScene({ agentResults: { items: [{ noId: true }] } }).visible).toEqual(
      []
    );
  });
});

describe('resolveDeixis', () => {
  it('binds "this one" to what the cursor is over', () => {
    const result = resolveDeixis(
      'more like this one but brighter',
      scene({ hovered: lane })
    );
    expect(result.referents).toHaveLength(1);
    expect(result.referents[0]?.phrase).toBe('this one');
    expect(result.referents[0]?.works).toEqual([lane]);
    expect(result.referents[0]?.source).toBe('hovered');
  });

  it('falls back to the open artwork when nothing is hovered', () => {
    const result = resolveDeixis('more like this', scene({ focused: lane }));
    expect(result.referents[0]?.source).toBe('focused');
    expect(result.referents[0]?.works).toEqual([lane]);
  });

  it('lets a click outrank a hover', () => {
    const result = resolveDeixis(
      'that painting, warmer',
      scene({ hovered: lane, selection: [dusk] })
    );
    expect(result.referents[0]?.source).toBe('selection');
    expect(result.referents[0]?.works).toEqual([dusk]);
  });

  it('binds "these two" to the selection', () => {
    const result = resolveDeixis(
      'something between these two',
      scene({ selection: [lane, dusk, third] })
    );
    expect(result.referents[0]?.phrase).toBe('these two');
    expect(result.referents[0]?.works).toEqual([lane, dusk]);
  });

  it('counts positions across the board, left to right', () => {
    const board = scene({ visible: [lane, dusk, third] });
    expect(resolveDeixis('the left one', board).referents[0]?.works).toEqual([
      lane,
    ]);
    expect(resolveDeixis('the second one', board).referents[0]?.works).toEqual([
      dusk,
    ]);
    expect(resolveDeixis('the last one', board).referents[0]?.works).toEqual([
      third,
    ]);
    expect(resolveDeixis('the right painting', board).referents[0]?.works).toEqual(
      [third]
    );
  });

  it('resolves several referents in one sentence', () => {
    const result = resolveDeixis(
      'the left one and the right one, nothing like this',
      scene({ visible: [lane, dusk, third], hovered: dusk })
    );
    expect(result.referents.map((referent) => referent.phrase)).toEqual([
      'the left one',
      'the right one',
      'this',
    ]);
  });

  it('says what it could not resolve instead of guessing', () => {
    const result = resolveDeixis('more like this one', emptyScene());
    expect(result.referents).toEqual([]);
    expect(result.unresolved[0]?.phrase).toBe('this one');
    expect(result.unresolved[0]?.reason).toMatch(/nothing is hovered/i);
  });

  it('refuses to pick when several works are selected and one is asked for', () => {
    const result = resolveDeixis('this one', scene({ selection: [lane, dusk] }));
    expect(result.referents).toEqual([]);
    expect(result.unresolved[0]?.reason).toMatch(/2 works are selected/);
  });

  it('refuses a count the selection cannot satisfy', () => {
    const result = resolveDeixis(
      'between these three',
      scene({ selection: [lane, dusk] })
    );
    expect(result.unresolved[0]?.reason).toMatch(/2 works are selected, not 3/);
  });

  it('reports a position the board does not have', () => {
    const result = resolveDeixis('the fifth one', scene({ visible: [lane] }));
    expect(result.unresolved[0]?.reason).toMatch(/no fifth work/i);
  });

  it('does not treat "it" as pointing at anything', () => {
    // "Make it brighter" is not a gesture, and a resolver that guessed here
    // would be wrong far more often than right.
    const result = resolveDeixis('make it brighter', scene({ hovered: lane }));
    expect(result.referents).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('is case-insensitive and keeps the human‌s own wording', () => {
    const result = resolveDeixis('More Like This One', scene({ hovered: lane }));
    expect(result.referents[0]?.phrase).toBe('This One');
  });
});

describe('annotateForAgent', () => {
  it('leaves an utterance with no deixis exactly as spoken', () => {
    const text = 'something warm for above the sofa';
    expect(annotateForAgent(text, resolveDeixis(text, emptyScene()))).toBe(text);
  });

  it('appends the binding with the id, so the next tool call can use it', () => {
    const text = 'more like this one but brighter';
    const annotated = annotateForAgent(
      text,
      resolveDeixis(text, scene({ hovered: lane }))
    );
    expect(annotated).toContain(text);
    expect(annotated).toContain('nga-1');
    expect(annotated).toContain('Lumber Schooners at Evening on Penobscot Bay');
  });

  it('tells the agent what it could not resolve rather than hiding it', () => {
    const text = 'between these two';
    const annotated = annotateForAgent(
      text,
      resolveDeixis(text, emptyScene())
    );
    expect(annotated).toMatch(/could not be resolved \(nothing is selected\)/);
  });
});

describe('segmentUtterance', () => {
  it('cuts the sentence into words and pictures', () => {
    const text = 'more like this one but brighter';
    const { referents } = resolveDeixis(text, scene({ hovered: lane }));
    expect(segmentUtterance(text, referents)).toEqual([
      { kind: 'text', text: 'more like ' },
      { kind: 'referent', referent: referents[0] },
      { kind: 'text', text: ' but brighter' },
    ]);
  });

  it('is one plain run when nothing was pointed at', () => {
    expect(segmentUtterance('something warm', [])).toEqual([
      { kind: 'text', text: 'something warm' },
    ]);
  });

  it('reassembles to exactly the original text', () => {
    const text = 'the left one and the right one, nothing like this';
    const { referents } = resolveDeixis(
      text,
      scene({ visible: [lane, dusk, third], hovered: dusk })
    );
    const rebuilt = segmentUtterance(text, referents)
      .map((segment) =>
        segment.kind === 'text' ? segment.text : segment.referent.phrase
      )
      .join('');
    expect(rebuilt).toBe(text);
  });
});
