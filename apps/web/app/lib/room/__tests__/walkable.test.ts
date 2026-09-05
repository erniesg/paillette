import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_AREA_M2,
  fieldOfView,
  planRoom,
  viewingDistance,
  type RoomWorkInput,
} from '~/lib/room/plan';
import {
  WALL_STANDOFF_M,
  isWalkable,
  roomAt,
  stepTowards,
  walkTowards,
} from '~/lib/room/walkable';

const unmeasured = (count: number): RoomWorkInput[] =>
  Array.from({ length: count }, (_, index) => ({
    artworkId: `w${index}`,
    size: null,
  }));

describe('isWalkable', () => {
  const plan = planRoom(unmeasured(6));
  const room = plan.rooms[0]!;

  it('lets the visitor stand where the visitor starts', () => {
    expect(isWalkable(plan, plan.entry.x, plan.entry.z)).toBe(true);
  });

  it('keeps the visitor off the walls', () => {
    expect(isWalkable(plan, room.centreX + room.widthM / 2 - 0.1, -2)).toBe(false);
    expect(isWalkable(plan, room.centreX - room.widthM / 2 + 0.1, -2)).toBe(false);
    expect(isWalkable(plan, 0, room.northZ + 0.1)).toBe(false);
    expect(isWalkable(plan, 0, room.southZ - 0.1)).toBe(false);
  });

  it('keeps the visitor inside the building', () => {
    expect(isWalkable(plan, 0, 5)).toBe(false);
    expect(isWalkable(plan, 0, room.northZ - 5)).toBe(false);
    expect(isWalkable(plan, 100, -2)).toBe(false);
  });

  it('opens exactly at the standoff, not a metre inside it', () => {
    const edge = room.centreX + room.widthM / 2 - WALL_STANDOFF_M;
    expect(isWalkable(plan, edge - 0.01, -2)).toBe(true);
    expect(isWalkable(plan, edge + 0.01, -2)).toBe(false);
  });
});

describe('the doorway between rooms', () => {
  const plan = planRoom(unmeasured(30));

  /**
   * The bug this file was written for. Two rooms whose interiors each stop
   * short of the shared wall do not connect: every square metre is walkable
   * and the enfilade is a set of sealed boxes.
   */
  it('connects one room to the next', () => {
    const first = plan.rooms[0]!;
    expect(isWalkable(plan, first.centreX, first.northZ)).toBe(true);
  });

  it('does not let the visitor walk through the wall beside the door', () => {
    const first = plan.rooms[0]!;
    expect(isWalkable(plan, first.centreX + 3, first.northZ)).toBe(false);
  });

  it('can be walked from the first room to the last', () => {
    let position = { x: plan.entry.x, z: plan.entry.z };
    for (let step = 0; step < 60; step += 1) {
      position = stepTowards(plan, position, 0, 0.6);
    }
    expect(roomAt(plan, position.z)).toBe(plan.rooms.length - 1);
  });
});

describe('stepTowards', () => {
  const plan = planRoom(unmeasured(6));

  it('faces down the show at heading zero', () => {
    const from = { x: 0, z: plan.entry.z };
    expect(stepTowards(plan, from, 0, 1).z).toBeLessThan(from.z);
  });

  it('turns right at heading minus a quarter turn', () => {
    const from = { x: 0, z: -3 };
    expect(stepTowards(plan, from, -Math.PI / 2, 1).x).toBeGreaterThan(0);
  });

  it('stops at a wall instead of passing through it', () => {
    const room = plan.rooms[0]!;
    let position = { x: 0, z: plan.entry.z };
    for (let step = 0; step < 40; step += 1) {
      position = stepTowards(plan, position, 0, 0.5);
      expect(isWalkable(plan, position.x, position.z)).toBe(true);
    }
    expect(position.z).toBeGreaterThan(room.northZ);
  });

  it('takes a shorter step rather than none when a full one would not fit', () => {
    const room = plan.rooms[0]!;
    const from = { x: 0, z: room.northZ + WALL_STANDOFF_M + 0.4 };
    const to = stepTowards(plan, from, 0, 1.2);
    expect(to.z).toBeLessThan(from.z);
    expect(isWalkable(plan, to.x, to.z)).toBe(true);
  });
});

describe('roomAt', () => {
  const plan = planRoom(unmeasured(30));

  it('names the room the visitor is standing in', () => {
    for (const room of plan.rooms) {
      expect(roomAt(plan, (room.southZ + room.northZ) / 2)).toBe(room.index);
    }
  });
});

/**
 * The failure this was written for: refusing any destination outside the
 * walkable set meant that from the door of a five-metre room, almost every
 * floor pixel on screen projects past the far wall and clicking it did
 * nothing — silently, with no feedback, on the primary way of moving.
 */
describe('walkTowards', () => {
  const plan = planRoom(unmeasured(6));
  const room = plan.rooms[0]!;
  const from = { x: plan.entry.x, z: plan.entry.z };

  it('walks as far as it can towards a point beyond the far wall', () => {
    const to = { x: 0, z: room.northZ - 4 };
    const arrived = walkTowards(plan, from, to);
    expect(arrived.z).toBeLessThan(from.z - 1);
    expect(isWalkable(plan, arrived.x, arrived.z)).toBe(true);
    expect(arrived.z).toBeGreaterThanOrEqual(room.northZ + WALL_STANDOFF_M - 0.001);
  });

  it('arrives exactly where a reachable point is', () => {
    const to = { x: 1, z: -3 };
    const arrived = walkTowards(plan, from, to);
    expect(arrived.x).toBeCloseTo(to.x, 6);
    expect(arrived.z).toBeCloseTo(to.z, 6);
  });

  it('stays put when there is nowhere to go in that direction', () => {
    const cornered = { x: room.centreX + room.widthM / 2 - WALL_STANDOFF_M, z: -3 };
    const arrived = walkTowards(plan, cornered, { x: cornered.x + 5, z: -3 });
    expect(arrived).toEqual(cornered);
  });

  it('goes through a doorway rather than stopping at it', () => {
    const enfilade = planRoom(unmeasured(30));
    const arrived = walkTowards(
      enfilade,
      { x: enfilade.entry.x, z: enfilade.entry.z },
      { x: 0, z: enfilade.rooms.at(-1)!.northZ }
    );
    expect(roomAt(enfilade, arrived.z)).toBe(enfilade.rooms.length - 1);
  });

  it('will not cut a corner through a wall to reach a walkable room', () => {
    const enfilade = planRoom(unmeasured(30));
    const second = enfilade.rooms[1]!;
    // A point in the next room, but off to one side of the doorway.
    const arrived = walkTowards(
      enfilade,
      { x: enfilade.entry.x, z: enfilade.entry.z },
      { x: second.widthM / 2 - WALL_STANDOFF_M, z: second.northZ + WALL_STANDOFF_M }
    );
    expect(roomAt(enfilade, arrived.z)).toBe(0);
  });
});

/**
 * The standoff and the minimum room size are two constants that have to agree.
 *
 * Walking stops 1.4 m short of every wall, so a room narrower than 2.8 m has
 * no interior at all — every square metre of it is standoff, `isWalkable`
 * answers false everywhere, and the room becomes a picture you cannot enter.
 * Nothing else in the suite would notice: the enfilade test walks along the
 * centre line, and the plan tests never ask whether the result can be stood
 * in. Raising the standoff to fix a phone is exactly the kind of change that
 * would break this quietly.
 */
describe('every room the planner can build can be stood in', () => {
  const shapes = [1, 2, 3, 4, 6, 12, 13, 24, 30, 61];

  it('has a walkable interior whatever the show is', () => {
    for (const count of shapes) {
      const plan = planRoom(unmeasured(count));
      for (const room of plan.rooms) {
        expect(room.widthM).toBeGreaterThan(WALL_STANDOFF_M * 2);
        expect(room.depthM).toBeGreaterThan(WALL_STANDOFF_M * 2);
        // And the centre of the room is somewhere a visitor may actually be.
        expect(
          isWalkable(plan, room.centreX, (room.southZ + room.northZ) / 2)
        ).toBe(true);
      }
      expect(isWalkable(plan, plan.entry.x, plan.entry.z)).toBe(true);
    }
  });

  it('leaves enough depth to back away from a wall and see it', () => {
    // Two standoffs plus a stride. Below this the room is a corridor you
    // cannot turn round in, whatever the arithmetic says.
    for (const count of shapes) {
      const plan = planRoom(unmeasured(count));
      for (const room of plan.rooms) {
        expect(room.depthM - WALL_STANDOFF_M * 2).toBeGreaterThan(0.85);
      }
    }
  });

  it('still connects one room to the next at this standoff', () => {
    const plan = planRoom(unmeasured(30));
    expect(plan.rooms.length).toBeGreaterThan(1);
    let position = { x: plan.entry.x, z: plan.entry.z };
    for (let step = 0; step < 120; step += 1) {
      position = stepTowards(plan, position, 0, 0.4);
    }
    expect(roomAt(plan, position.z)).toBe(plan.rooms.length - 1);
  });
});

/**
 * The standoff and the focus distance have to agree, or the model is incoherent.
 *
 * The rule the room offers is: **walking gets you around the room, clicking a
 * work gets you up to it.** That is only true if walking cannot already put you
 * closer to a wall than clicking would — otherwise "get up to it" sometimes
 * means backing away, and the two verbs stop meaning different things.
 *
 * This is what defends 1.4 m over the 0.95 m it started at: on a phone, the
 * distance at which a default-sized work fills the frame is 1.16 m, so an
 * arm's-length standoff let walking overshoot the focused view. It is *not* a
 * guarantee that a work is in frame wherever you stop — a 42° horizontal field
 * in a nine-metre room cannot promise that, and a test demanding it would force
 * a standoff that leaves the smallest rooms with no interior at all. What put
 * a picture back on screen in the phone screenshot was this change; that it is
 * enough in general is a judgement, not an invariant, and the report says so.
 */
describe('walking never gets you closer than looking does', () => {
  const SCREENS = [
    { name: 'desktop', aspect: 16 / 10 },
    { name: 'phone upright', aspect: 390 / 844 },
  ];

  it('leaves the focused view something to close', () => {
    const side = Math.sqrt(DEFAULT_WORK_AREA_M2);
    for (const screen of SCREENS) {
      const focus = viewingDistance(side, side, fieldOfView(screen.aspect), screen.aspect);
      expect(WALL_STANDOFF_M).toBeGreaterThan(focus);
    }
  });
});
