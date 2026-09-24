/**
 * A nonindexed frame has four quad strips, each made from four sides and two
 * triangles. Keeping this fixed lets the room batch frames with a simple
 * `frameIndex * FRAME_VERTEX_COUNT * 3` offset.
 */
export const FRAME_VERTEX_COUNT = 96;

const FRAME_BACK_Z = 0.021;

export type FrameGeometryOptions = {
  /** The visible artwork opening. */
  width: number;
  /** The visible artwork opening. */
  height: number;
  /** How far the joined frame grows out from each edge of that opening. */
  rail: number;
  /** The frame's maximum projection from the wall. */
  depth: number;
};

type Point = readonly [number, number, number];

const corners = (
  halfWidth: number,
  halfHeight: number,
  z: number
): readonly [Point, Point, Point, Point] => [
  [-halfWidth, -halfHeight, z],
  [halfWidth, -halfHeight, z],
  [halfWidth, halfHeight, z],
  [-halfWidth, halfHeight, z],
];

/** Adds a quad as two outward-facing triangles. */
const pushQuad = (
  target: number[],
  first: Point,
  second: Point,
  third: Point,
  fourth: Point
) => {
  target.push(...first, ...second, ...third, ...first, ...third, ...fourth);
};

/**
 * Builds one continuous, mitred rectangular frame around an artwork opening.
 *
 * The four closed contours form the back, outer wall, raised front and inner
 * wall. The inner front is slightly lower than the outer front, so its meeting
 * with the artwork reads as a bevel while retaining a full inner side wall.
 * It deliberately uses no Three.js types so it can be tested and batched
 * without a renderer.
 */
export const buildFrameVertices = ({
  width,
  height,
  rail,
  depth,
}: FrameGeometryOptions): Float32Array => {
  const empty = new Float32Array(FRAME_VERTEX_COUNT * 3);
  if (!(width > 0) || !(height > 0) || !(rail > 0) || !(depth > 0)) return empty;

  const frontZ = FRAME_BACK_Z + depth;
  const bevelDepth = Math.min(depth * 0.28, rail * 0.35);
  const innerBack = corners(width / 2, height / 2, FRAME_BACK_Z);
  const outerBack = corners(width / 2 + rail, height / 2 + rail, FRAME_BACK_Z);
  const outerFront = corners(width / 2 + rail, height / 2 + rail, frontZ);
  const innerFront = corners(width / 2, height / 2, frontZ - bevelDepth);
  const values: number[] = [];

  for (let corner = 0; corner < 4; corner += 1) {
    const next = (corner + 1) % 4;

    // Back is wound toward the wall; the remaining strips face out of their
    // respective solid walls. Together they form a sealed manifold.
    pushQuad(
      values,
      outerBack[corner]!,
      innerBack[corner]!,
      innerBack[next]!,
      outerBack[next]!
    );
    pushQuad(
      values,
      outerBack[corner]!,
      outerBack[next]!,
      outerFront[next]!,
      outerFront[corner]!
    );
    pushQuad(
      values,
      outerFront[corner]!,
      outerFront[next]!,
      innerFront[next]!,
      innerFront[corner]!
    );
    pushQuad(
      values,
      innerBack[corner]!,
      innerFront[corner]!,
      innerFront[next]!,
      innerBack[next]!
    );
  }

  return new Float32Array(values);
};
