/**
 * Where a visitor is allowed to stand.
 *
 * There is no physics here and there deliberately is none. The room is walked
 * by teleporting — click the floor, arrive — so the only question ever asked
 * is whether a *destination* is inside the building, which is a point-in-rect
 * test rather than a swept collision. Continuous locomotion would need the
 * swept version; it also makes a meaningful number of people motion sick, and
 * this is an art site.
 *
 * The walkable set is each room's interior held back from its own walls, plus
 * a short corridor through each doorway so the rooms connect. Holding back
 * from the walls is not a safety margin — it is why you cannot put your eye
 * inside a painting, and why the far wall of a room stays composed as a wall
 * rather than dissolving into one work at zero distance.
 */

import type { RoomPlan, RoomShape } from './plan';
import { DOOR_WIDTH_M } from './plan';

/** How close to a wall a visitor may stand. Roughly arm's length plus a step. */
export const WALL_STANDOFF_M = 0.95;

/** Eye height. Not a camera setting — a person. */
export const EYE_HEIGHT_M = 1.62;

const insideRoom = (room: RoomShape, x: number, z: number): boolean =>
  x >= room.centreX - room.widthM / 2 + WALL_STANDOFF_M &&
  x <= room.centreX + room.widthM / 2 - WALL_STANDOFF_M &&
  z <= room.southZ - WALL_STANDOFF_M &&
  z >= room.northZ + WALL_STANDOFF_M;

/**
 * The doorway itself, which belongs to neither room's interior.
 *
 * Without this the two standoffs meet back to back and the enfilade is a set
 * of sealed boxes: every room walkable, no way between them. It cost one
 * afternoon to notice, which is the argument for this file being testable at
 * all.
 */
const insideDoor = (room: RoomShape, x: number, z: number): boolean => {
  if (!room.doorNorth) return false;
  const half = DOOR_WIDTH_M / 2 - 0.2;
  return (
    Math.abs(x - room.centreX) <= half &&
    z <= room.northZ + WALL_STANDOFF_M &&
    z >= room.northZ - WALL_STANDOFF_M
  );
};

export const isWalkable = (plan: RoomPlan, x: number, z: number): boolean =>
  plan.rooms.some(
    (room) => insideRoom(room, x, z) || insideDoor(room, x, z)
  );

/**
 * The furthest point along a step that is still inside the building.
 *
 * Tried at decreasing fractions rather than solved, because the walkable set
 * is a union of rectangles and the exact intersection is not worth the code —
 * a visitor pressed against a wall wants to stop at the wall, not at the
 * analytically correct millimetre of it.
 */
export const stepTowards = (
  plan: RoomPlan,
  from: { x: number; z: number },
  headingRadians: number,
  distanceM: number
): { x: number; z: number } => {
  // Heading 0 faces -z, the way the show runs, matching the camera's own
  // default orientation so nothing has to be negated at the call site.
  const dx = -Math.sin(headingRadians) * distanceM;
  const dz = -Math.cos(headingRadians) * distanceM;

  for (const fraction of [1, 0.66, 0.33]) {
    const x = from.x + dx * fraction;
    const z = from.z + dz * fraction;
    if (isWalkable(plan, x, z)) return { x, z };
  }
  return from;
};

/**
 * Which room a visitor is standing in, for deciding what to keep in memory.
 *
 * Depth alone answers it: the enfilade runs along one axis, so a room is a
 * band of z and nothing else has to be checked.
 */
export const roomAt = (plan: RoomPlan, z: number): number => {
  for (const room of plan.rooms) {
    if (z <= room.southZ && z >= room.northZ) return room.index;
  }
  return z > 0 ? 0 : Math.max(0, plan.rooms.length - 1);
};
