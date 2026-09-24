import { describe, expect, it } from 'vitest';
import {
  buildFrameVertices,
  FRAME_VERTEX_COUNT,
} from '~/lib/room/frame-geometry';

const triangles = (vertices: Float32Array) => {
  const result: Array<readonly [number, number, number][]> = [];
  for (let index = 0; index < vertices.length; index += 9) {
    result.push([
      [vertices[index]!, vertices[index + 1]!, vertices[index + 2]!],
      [vertices[index + 3]!, vertices[index + 4]!, vertices[index + 5]!],
      [vertices[index + 6]!, vertices[index + 7]!, vertices[index + 8]!],
    ]);
  }
  return result;
};

const pointKey = ([x, y, z]: readonly number[]) => `${x},${y},${z}`;

describe('buildFrameVertices', () => {
  it('has a fixed nonindexed stride, including an absent rail', () => {
    const framed = buildFrameVertices({ width: 2, height: 1, rail: 0.1, depth: 0.04 });
    const absent = buildFrameVertices({ width: 2, height: 1, rail: 0, depth: 0.04 });

    expect(framed).toHaveLength(FRAME_VERTEX_COUNT * 3);
    expect(absent).toHaveLength(FRAME_VERTEX_COUNT * 3);
    expect([...absent].every((value) => value === 0)).toBe(true);
  });

  it('keeps the artwork opening and grows only outward by the rail', () => {
    const vertices = buildFrameVertices({ width: 2, height: 1, rail: 0.1, depth: 0.04 });
    const xs = vertices.filter((_, index) => index % 3 === 0);
    const ys = vertices.filter((_, index) => index % 3 === 1);
    const zs = vertices.filter((_, index) => index % 3 === 2);

    expect(Math.min(...xs)).toBeCloseTo(-1.1);
    expect(Math.max(...xs)).toBeCloseTo(1.1);
    expect(Math.min(...ys)).toBeCloseTo(-0.6);
    expect(Math.max(...ys)).toBeCloseTo(0.6);
    expect(Math.min(...zs)).toBeCloseTo(0.021);
    expect(Math.max(...zs)).toBeCloseTo(0.061);

    for (const triangle of triangles(vertices)) {
      const [x, y] = triangle.reduce(
        ([sumX, sumY], point) => [sumX + point[0] / 3, sumY + point[1] / 3],
        [0, 0]
      );
      expect(Math.abs(x) < 1 && Math.abs(y) < 0.5).toBe(false);
    }
  });

  it('joins the mitred corners into one sealed manifold', () => {
    const vertices = buildFrameVertices({ width: 2, height: 1, rail: 0.1, depth: 0.04 });
    const edges = new Map<string, number>();

    for (const triangle of triangles(vertices)) {
      for (const [from, to] of [[0, 1], [1, 2], [2, 0]] as const) {
        const edge = [pointKey(triangle[from]!), pointKey(triangle[to]!)]
          .sort()
          .join('|');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }

    expect([...edges.values()].every((count) => count === 2)).toBe(true);
  });
});
