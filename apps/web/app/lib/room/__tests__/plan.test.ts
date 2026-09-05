import { describe, expect, it } from 'vitest';
import {
  CENTRE_LINE_M,
  CORNER_M,
  DOOR_WIDTH_M,
  MAX_WORKS_PER_ROOM,
  MIN_ROOM_DEPTH_M,
  MIN_ROOM_WIDTH_M,
  MIN_SLOT_M,
  allocateWalls,
  chunkWorks,
  groupWorks,
  hangHeight,
  planRoom,
  type Placement,
  type RoomWorkInput,
} from '~/lib/room/plan';

const unmeasured = (count: number): RoomWorkInput[] =>
  Array.from({ length: count }, (_, index) => ({
    artworkId: `w${index}`,
    size: null,
  }));

/** The gap between the near edges of two works on the same wall. */
const gapsAlong = (placements: Placement[], axis: 'x' | 'z') => {
  const sorted = [...placements].sort((a, b) => a[axis] - b[axis]);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    gaps.push(
      current[axis] - previous[axis] - current.widthM / 2 - previous.widthM / 2
    );
  }
  return gaps;
};

describe('allocateWalls', () => {
  it('puts a very small show on the wall you face', () => {
    expect(allocateWalls(1, true)).toEqual({ west: 0, north: 1, east: 0 });
    expect(allocateWalls(3, true)).toEqual({ west: 0, north: 3, east: 0 });
  });

  it('spreads anything larger across three walls, far wall favoured', () => {
    expect(allocateWalls(6, true)).toEqual({ west: 2, north: 2, east: 2 });
    expect(allocateWalls(4, true)).toEqual({ west: 1, north: 2, east: 1 });
    expect(allocateWalls(10, true)).toEqual({ west: 3, north: 4, east: 3 });
  });

  it('never loses or invents a work', () => {
    for (let count = 0; count <= 30; count += 1) {
      for (const terminal of [true, false]) {
        const { west, north, east } = allocateWalls(count, terminal);
        expect(west + north + east).toBe(count);
      }
    }
  });
});

describe('chunkWorks', () => {
  it('splits thirty into three rooms of ten rather than two and a stub', () => {
    expect(chunkWorks(unmeasured(30), MAX_WORKS_PER_ROOM).map((c) => c.length)).toEqual(
      [10, 10, 10]
    );
  });

  it('keeps the order the curation settled on', () => {
    const chunks = chunkWorks([1, 2, 3, 4, 5, 6, 7], 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5], [6, 7]]);
  });

  it('leaves a show that fits in one room alone', () => {
    expect(chunkWorks(unmeasured(6), MAX_WORKS_PER_ROOM)).toHaveLength(1);
  });
});

describe('groupWorks', () => {
  it('makes a room per named region, in the order the regions were named', () => {
    const works = unmeasured(4);
    const groups = groupWorks(works, [
      { label: 'The Empty Shore', artworkIds: ['w2', 'w3'] },
      { label: 'The Working Harbor', artworkIds: ['w0'] },
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      'The Empty Shore',
      'The Working Harbor',
      // Whatever no region claimed still has to hang somewhere.
      null,
    ]);
    expect(groups[2]!.works.map((entry) => entry.work.artworkId)).toEqual(['w1']);
  });

  it('hangs a work claimed twice only once', () => {
    const groups = groupWorks(unmeasured(2), [
      { label: 'A', artworkIds: ['w0', 'w1'] },
      { label: 'B', artworkIds: ['w0'] },
    ]);
    expect(groups.flatMap((group) => group.works.map((e) => e.work.artworkId))).toEqual(
      ['w0', 'w1']
    );
  });

  it('splits an oversized region into rooms that keep its name', () => {
    const works = unmeasured(20);
    const groups = groupWorks(works, [
      { label: 'Leaving', artworkIds: works.map((work) => work.artworkId) },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name)).toEqual(['Leaving', 'Leaving']);
  });

  it('ignores a region naming works that are not in the show', () => {
    const groups = groupWorks(unmeasured(2), [
      { label: 'Ghosts', artworkIds: ['nope'] },
    ]);
    expect(groups.map((group) => group.name)).toEqual([null]);
  });
});

describe('planRoom', () => {
  it('hangs an exhibition of any size without losing a work', () => {
    for (const count of [1, 2, 6, 12, 13, 24, 30, 61]) {
      const plan = planRoom(unmeasured(count));
      expect(plan.placements).toHaveLength(count);
      expect(new Set(plan.placements.map((p) => p.artworkId)).size).toBe(count);
    }
  });

  it('draws no room at all for an exhibition with nothing in it', () => {
    const plan = planRoom([]);
    expect(plan.rooms).toHaveLength(0);
    expect(plan.placements).toHaveLength(0);
  });

  it('walks the order the curation settled on: left wall, far wall, right wall', () => {
    const plan = planRoom(unmeasured(6));
    expect(plan.placements.map((p) => p.side)).toEqual([
      'west',
      'west',
      'north',
      'north',
      'east',
      'east',
    ]);
    expect(plan.placements.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('runs the west wall away from the door and the east wall back towards it', () => {
    const plan = planRoom(unmeasured(6));
    const [westA, westB] = plan.placements.filter((p) => p.side === 'west') as [
      Placement,
      Placement,
    ];
    const [eastA, eastB] = plan.placements.filter((p) => p.side === 'east') as [
      Placement,
      Placement,
    ];
    // The visitor faces -z, so walking on means z decreasing.
    expect(westB.z).toBeLessThan(westA.z);
    expect(eastB.z).toBeGreaterThan(eastA.z);
  });

  it('faces every picture into the room it is hung in', () => {
    const plan = planRoom(unmeasured(12));
    const room = plan.rooms[0]!;
    for (const placement of plan.placements) {
      // A plane's own normal is +z; rotating it by rotationY gives where it looks.
      const normalX = Math.sin(placement.rotationY);
      const normalZ = Math.cos(placement.rotationY);
      const inwardX = room.centreX - placement.x;
      const inwardZ = (room.southZ + room.northZ) / 2 - placement.z;
      expect(normalX * inwardX + normalZ * inwardZ).toBeGreaterThan(0);
    }
  });

  it('never overlaps two works on the same wall', () => {
    const plan = planRoom(unmeasured(30));
    for (const room of plan.rooms) {
      for (const side of ['west', 'east'] as const) {
        const wall = plan.placements.filter(
          (p) => p.roomIndex === room.index && p.side === side
        );
        for (const gap of gapsAlong(wall, 'z')) expect(gap).toBeGreaterThan(0);
      }
      const north = plan.placements.filter(
        (p) => p.roomIndex === room.index && p.side === 'north'
      );
      for (const gap of gapsAlong(north, 'x')) expect(gap).toBeGreaterThan(0);
    }
  });

  it('keeps every work inside the walls of its own room', () => {
    const plan = planRoom(unmeasured(30));
    for (const placement of plan.placements) {
      const room = plan.rooms[placement.roomIndex]!;
      const halfWidth = room.widthM / 2;
      expect(placement.x).toBeGreaterThanOrEqual(room.centreX - halfWidth - 0.001);
      expect(placement.x).toBeLessThanOrEqual(room.centreX + halfWidth + 0.001);
      expect(placement.z).toBeLessThanOrEqual(room.southZ + 0.001);
      expect(placement.z).toBeGreaterThanOrEqual(room.northZ - 0.001);
    }
  });

  it('hangs nothing across a doorway', () => {
    const plan = planRoom(unmeasured(30));
    const throughRooms = plan.rooms.filter((room) => room.doorNorth);
    expect(throughRooms.length).toBeGreaterThan(0);
    for (const room of throughRooms) {
      const onFarWall = plan.placements.filter(
        (p) => p.roomIndex === room.index && p.side === 'north'
      );
      expect(onFarWall.length).toBeGreaterThan(0);
      for (const placement of onFarWall) {
        const nearEdge = Math.abs(placement.x - room.centreX) - placement.widthM / 2;
        expect(nearEdge).toBeGreaterThanOrEqual(DOOR_WIDTH_M / 2);
      }
    }
  });

  it('gives each work between 1.5 m and 2.5 m of wall at the default size', () => {
    const plan = planRoom(unmeasured(12));
    for (const placement of plan.placements) {
      expect(placement.slotM).toBeGreaterThanOrEqual(MIN_SLOT_M);
      expect(placement.slotM).toBeLessThanOrEqual(2.5);
    }
  });

  it('grows the room to fit the works rather than cropping them', () => {
    // One work does not need any of the minimum, so the minimum is what it gets.
    const single = planRoom(unmeasured(1));
    expect(single.rooms[0]!.widthM).toBe(MIN_ROOM_WIDTH_M);
    expect(single.rooms[0]!.depthM).toBe(MIN_ROOM_DEPTH_M);
    // Three across the far wall already exceed it, which is the floor doing
    // its job rather than a cap: 3 × 1.55 m of wall plus two corners is 6.2 m.
    const small = planRoom(unmeasured(3));
    expect(small.rooms[0]!.widthM).toBeGreaterThan(MIN_ROOM_WIDTH_M);
    const large = planRoom(unmeasured(12));
    expect(large.rooms[0]!.widthM).toBeGreaterThan(single.rooms[0]!.widthM);
    expect(large.rooms[0]!.depthM).toBeGreaterThan(single.rooms[0]!.depthM);
    // A wide work widens the wall it hangs on, corner margins included.
    const wide = planRoom([{ artworkId: 'big', size: { widthM: 6, heightM: 2 } }]);
    expect(wide.rooms[0]!.widthM).toBeGreaterThanOrEqual(6 + CORNER_M * 2);
  });

  it('lays the rooms out as an enfilade, each one behind the last', () => {
    const plan = planRoom(unmeasured(30));
    expect(plan.rooms).toHaveLength(3);
    for (let index = 1; index < plan.rooms.length; index += 1) {
      expect(plan.rooms[index]!.southZ).toBe(plan.rooms[index - 1]!.northZ);
      expect(plan.rooms[index]!.doorSouth).toBe(true);
    }
    expect(plan.rooms[0]!.doorSouth).toBe(false);
    expect(plan.rooms.at(-1)!.doorNorth).toBe(false);
  });

  /**
   * Rooms of differing widths leave a step in the side walls at every
   * threshold, and you can see out through it. Depth is where the variation
   * is allowed to live.
   */
  it('gives the whole enfilade one width so the side walls do not step', () => {
    const plan = planRoom([
      ...Array.from({ length: 12 }, (_, i) => ({ artworkId: `a${i}`, size: null })),
      { artworkId: 'wide', size: { widthM: 5, heightM: 2 } },
    ]);
    expect(plan.rooms.length).toBeGreaterThan(1);
    expect(new Set(plan.rooms.map((room) => room.widthM)).size).toBe(1);
    expect(new Set(plan.rooms.map((room) => room.centreX)).size).toBe(1);
  });

  it('hangs at the museum centre line, and raises only what would not fit', () => {
    expect(hangHeight(0.65)).toBe(CENTRE_LINE_M);
    expect(hangHeight(2)).toBe(CENTRE_LINE_M);
    // A four-metre canvas centred at 1.45 would have its foot below the floor.
    expect(hangHeight(4)).toBeCloseTo(2.15, 5);
    const plan = planRoom([{ artworkId: 'big', size: { widthM: 3, heightM: 4 } }]);
    expect(plan.placements[0]!.y - 4 / 2).toBeGreaterThan(0);
    expect(plan.wallHeightM).toBeGreaterThan(4);
  });

  it('marks a fallback size as a fallback and counts what was measured', () => {
    const plan = planRoom([
      { artworkId: 'known', size: { widthM: 0.9, heightM: 1.2 } },
      { artworkId: 'unknown', size: null },
    ]);
    expect(plan.measuredCount).toBe(1);
    const known = plan.placements.find((p) => p.artworkId === 'known')!;
    const unknown = plan.placements.find((p) => p.artworkId === 'unknown')!;
    expect(known.measured).toBe(true);
    expect(known.widthM).toBe(0.9);
    expect(unknown.measured).toBe(false);
  });

  it('hangs every unmeasured work at the same size, so the fallback shows', () => {
    const plan = planRoom(unmeasured(12));
    const widths = new Set(plan.placements.map((p) => p.widthM));
    const heights = new Set(plan.placements.map((p) => p.heightM));
    expect(widths.size).toBe(1);
    expect(heights.size).toBe(1);
  });

  it('stands the visitor inside the first room, facing the show', () => {
    const plan = planRoom(unmeasured(6));
    expect(plan.entry.z).toBeLessThan(plan.rooms[0]!.southZ);
    expect(plan.entry.z).toBeGreaterThan(plan.rooms[0]!.northZ);
  });

  it('builds a room per region when the show names its groups', () => {
    const works = unmeasured(6);
    const plan = planRoom(works, [
      { label: 'The Working Harbor', artworkIds: ['w0', 'w1', 'w2'] },
      { label: 'The Empty Shore', artworkIds: ['w3', 'w4', 'w5'] },
    ]);
    expect(plan.rooms.map((room) => room.name)).toEqual([
      'The Working Harbor',
      'The Empty Shore',
    ]);
    expect(plan.placements.filter((p) => p.roomIndex === 0)).toHaveLength(3);
  });
});
