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

/**
 * How close to a wall walking can take you.
 *
 * This was 0.95 m — arm's length — and it made a real bad moment, which a
 * phone found first. Tapping the floor walks as far along that line as the
 * building allows, so a tap toward the far wall parked the visitor a metre
 * from it. At a metre you cannot see a work anyway: a phone held upright has a
 * horizontal field of about 42°, which at that distance is 0.78 m of wall —
 * less than the gap between two hung works, so the visitor arrived nose-first
 * into bare plaster with a picture just off each edge of the screen.
 *
 * 1.4 m is a viewing distance rather than a safety margin, and it makes the
 * interaction model coherent: **walking gets you around the room, and clicking
 * a work gets you up to it.** Focusing still leans closer than this — that is
 * what focusing is for — and leaves you standing here when you close the
 * label.
 */
export const WALL_STANDOFF_M = 1.4;

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

/** How finely a walk is checked along its own line. */
export const MARCH_M = 0.2;

/**
 * The furthest point towards a destination that is still inside the building.
 *
 * Marched rather than solved, because the walkable set is a union of
 * rectangles and the exact intersection is not worth the code — a visitor
 * pressed against a wall wants to stop at the wall, not at the analytically
 * correct millimetre of it. Marching also gets the doorways right for free: a
 * line that passes through a door corridor keeps going into the next room,
 * and one that does not stops at the wall.
 *
 * The alternative — testing only the destination and refusing anything
 * outside — is what shipped first, and it made clicking the floor do nothing
 * at all for most of the screen. Standing at the door of a five-metre room,
 * almost every floor pixel projects past the far wall's standoff.
 */
export const walkTowards = (
  plan: RoomPlan,
  from: { x: number; z: number },
  to: { x: number; z: number }
): { x: number; z: number } => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return from;

  const steps = Math.ceil(distance / MARCH_M);
  let furthest = from;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const x = from.x + dx * fraction;
    const z = from.z + dz * fraction;
    if (!isWalkable(plan, x, z)) break;
    furthest = { x, z };
  }
  return furthest;
};

/**
 * One step forward or back, in the direction the visitor is facing.
 *
 * Heading 0 faces -z, the way the show runs, matching the camera's own default
 * orientation so nothing has to be negated at the call site.
 */
export const stepTowards = (
  plan: RoomPlan,
  from: { x: number; z: number },
  headingRadians: number,
  distanceM: number
): { x: number; z: number } =>
  walkTowards(plan, from, {
    x: from.x - Math.sin(headingRadians) * distanceM,
    z: from.z - Math.cos(headingRadians) * distanceM,
  });

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
