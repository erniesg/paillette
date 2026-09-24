import { afterEach, describe, expect, it } from 'vitest';
import {
  __TURN_TIMING_STORAGE_KEY_FOR_TEST,
  clearTurnTimings,
  loadTurnTimings,
  percentile,
  saveTurnTiming,
  startTurnTiming,
  timingRows,
} from '../turn-timing';

/** A clock the test moves by hand, so no assertion depends on a sleep. */
const fakeClock = () => {
  let t = 1000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
};

afterEach(() => {
  clearTurnTimings();
});

describe('startTurnTiming', () => {
  it('splits a turn into model, tools and the rest, and counts nudges', () => {
    const clock = fakeClock();
    const timer = startTurnTiming('storms at sea', clock.now, () => 42);
    timer.classify('ask');

    clock.advance(50); // reading gestures, building tools
    let mark = timer.mark();
    clock.advance(3000);
    timer.modelCall(mark, { modelMs: 2800, promptTokens: 5000, cachedTokens: 4096 }, [
      'search_artworks',
      'search_artworks',
    ]);

    const phase = timer.mark();
    const a = timer.mark();
    clock.advance(1200);
    timer.tool('search_artworks', a, true);
    timer.tool('search_artworks', a, false);
    timer.toolPhase(phase);
    timer.noteLanded();

    mark = timer.mark();
    clock.advance(2000);
    timer.modelCall(mark, { modelMs: 1900, promptTokens: 6000, cachedTokens: 0 }, []);
    timer.nudge('labels:a,b');

    mark = timer.mark();
    clock.advance(1000);
    timer.modelCall(mark, null, []);
    clock.advance(10);

    const timing = timer.finish('replied');
    expect(timing).toMatchObject({
      at: 42,
      kind: 'ask',
      totalMs: 7260,
      noteMs: 4250,
      modelCallCount: 3,
      nudges: 1,
      nudgeKeys: ['labels:a,b'],
      outcome: 'replied',
      breakdown: {
        modelMs: 6000,
        serverModelMs: 4700,
        toolsMs: 1200,
        // From the nudge to the end: the last model call and the tail.
        nudgeMs: 1010,
        otherMs: 60,
        promptTokens: 11000,
        cachedTokens: 4096,
      },
    });
    expect(timing.toolCalls.map((call) => call.ok)).toEqual([true, false]);
    expect(timing.modelCalls.map((call) => call.afterNudge)).toEqual([false, false, true]);
  });

  it('reports no note rather than the end of the turn when none landed', () => {
    const clock = fakeClock();
    const timer = startTurnTiming('x', clock.now);
    clock.advance(100);
    expect(timer.finish('error').noteMs).toBeNull();
  });

  it('keeps the first note, not the last', () => {
    const clock = fakeClock();
    const timer = startTurnTiming('x', clock.now);
    clock.advance(100);
    timer.noteLanded();
    clock.advance(900);
    timer.noteLanded();
    expect(timer.finish('replied').noteMs).toBe(100);
  });
});

describe('turn timing storage', () => {
  it('survives in sessionStorage and ignores what is not a record', () => {
    const clock = fakeClock();
    saveTurnTiming(startTurnTiming('first', clock.now).finish('replied'));
    saveTurnTiming(startTurnTiming('second', clock.now).finish('budget'));
    expect(loadTurnTimings().map((timing) => timing.instruction)).toEqual([
      'first',
      'second',
    ]);

    sessionStorage.setItem(
      __TURN_TIMING_STORAGE_KEY_FOR_TEST,
      JSON.stringify([{ v: 1, totalMs: 5, modelCalls: [] }, { nope: true }, 7])
    );
    expect(loadTurnTimings()).toHaveLength(1);

    sessionStorage.setItem(__TURN_TIMING_STORAGE_KEY_FOR_TEST, '{not json');
    expect(loadTurnTimings()).toEqual([]);
  });

  it('keeps the newest sixty', () => {
    const clock = fakeClock();
    for (let i = 0; i < 65; i += 1) {
      saveTurnTiming(startTurnTiming(`t${i}`, clock.now).finish('replied'));
    }
    const kept = loadTurnTimings();
    expect(kept).toHaveLength(60);
    expect(kept[0]?.instruction).toBe('t5');
  });
});

describe('percentile', () => {
  it('is nearest-rank, so every answer is a value that was measured', () => {
    const values = [9, 1, 5, 3, 7, 2, 8, 4, 6, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile([4], 95)).toBe(4);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('timingRows', () => {
  it('flattens a turn for console.table', () => {
    const clock = fakeClock();
    const timer = startTurnTiming('a long instruction '.repeat(10), clock.now);
    timer.classify('redeal');
    const [row] = timingRows([timer.finish('replied')]);
    expect(row).toMatchObject({ kind: 'redeal', modelCalls: 0, nudges: 0 });
    expect(row?.instruction.length).toBeLessThanOrEqual(48);
  });
});
