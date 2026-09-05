/**
 * Real scale, end to end — and a claim this deployment cannot demonstrate.
 *
 * "Hang works at their true size" is the strongest argument for a room
 * existing: on a page every work is the same size as every other work, and in
 * a room a print is small and a history painting is enormous. The NGA records
 * ingested here cannot show it. All sixty sampled carry a `dimensions` object
 * with every value null, so the room hangs every one of them at the declared
 * fallback and the honest count of works hung at a recorded size is zero.
 *
 * That makes this file the only place the feature is exercised. It runs the
 * whole path a real record would take — catalogue field, parser, metres,
 * planner — over the shapes a catalogue actually writes, so the day a
 * collection arrives with dimensions the behaviour is already pinned rather
 * than merely intended.
 */

import { describe, expect, it } from 'vitest';
import { parseDimensions } from '~/lib/room/dimensions';
import { planRoom, type RoomWorkInput } from '~/lib/room/plan';

const hang = (records: { id: string; dimensions: unknown }[]) => {
  const works: RoomWorkInput[] = records.map((record) => {
    const size = parseDimensions(record.dimensions);
    return {
      artworkId: record.id,
      size: size
        ? { widthM: size.widthCm / 100, heightM: size.heightCm / 100 }
        : null,
    };
  });
  const plan = planRoom(works);
  return {
    plan,
    of: (id: string) => plan.placements.find((entry) => entry.artworkId === id)!,
  };
};

describe('a catalogue that records how big things are', () => {
  it('hangs an etching small and a history painting enormous', () => {
    const { of } = hang([
      // Whistler, roughly. A plate you stand close to.
      { id: 'etching', dimensions: 'overall: 20.3 x 13.3 cm' },
      // A Salon machine. The same wall, a different room.
      { id: 'history', dimensions: 'overall: 386 x 515 cm' },
    ]);

    expect(of('etching').heightM).toBeCloseTo(0.203, 5);
    expect(of('history').heightM).toBeCloseTo(3.86, 5);
    expect(of('history').widthM / of('etching').widthM).toBeGreaterThan(38);
    expect(of('etching').measured && of('history').measured).toBe(true);
  });

  it('gives the large work more wall and raises it until it clears the floor', () => {
    const { of } = hang([
      { id: 'etching', dimensions: 'overall: 20.3 x 13.3 cm' },
      { id: 'history', dimensions: 'overall: 386 x 515 cm' },
    ]);

    expect(of('history').slotM).toBeGreaterThan(of('etching').slotM);
    // Centred at 145 cm a 3.86 m canvas would have its foot below the floor.
    expect(of('history').y - of('history').heightM / 2).toBeGreaterThan(0);
    expect(of('etching').y).toBeCloseTo(1.45, 5);
  });

  it('builds a room tall enough for what is hung in it', () => {
    const small = hang([{ id: 'a', dimensions: 'overall: 20.3 x 13.3 cm' }]);
    const large = hang([{ id: 'a', dimensions: 'overall: 386 x 515 cm' }]);
    expect(large.plan.wallHeightM).toBeGreaterThan(small.plan.wallHeightM);
    expect(large.plan.wallHeightM).toBeGreaterThan(3.86);
    expect(large.plan.rooms[0]!.widthM).toBeGreaterThan(5.15);
  });

  it('mixes measured and unmeasured without pretending about either', () => {
    const { plan, of } = hang([
      { id: 'known', dimensions: { height: 120, width: 90, unit: 'cm' } },
      // The shape every record in this deployment actually has.
      { id: 'nga', dimensions: { height: null, width: null, depth: null, unit: null } },
    ]);

    expect(plan.measuredCount).toBe(1);
    expect(of('known').heightM).toBeCloseTo(1.2, 5);
    expect(of('nga').measured).toBe(false);
    // The fallback is one declared size, not a guess derived from the record.
    expect(of('nga').widthM).toBeCloseTo(of('nga').heightM, 5);
  });

  /**
   * The refusal is the feature. A wall of works at their true size is only
   * worth anything if nothing on it is at an invented one.
   */
  it('refuses a record it cannot read rather than hanging a plausible size', () => {
    const { plan } = hang([
      { id: 'fractions', dimensions: '24 5/8 x 38 1/8 in.' },
      { id: 'unitless', dimensions: '62.5 x 96.8' },
      { id: 'nothing', dimensions: 'dimensions unknown' },
    ]);
    expect(plan.measuredCount).toBe(0);
    expect(new Set(plan.placements.map((entry) => entry.widthM)).size).toBe(1);
  });
});
