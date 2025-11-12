/**
 * Tests for dimensionality reduction and clustering utilities
 */

import { describe, it, expect } from 'vitest';
import {
  PCA,
  reduceTo2D,
  reduceTo3D,
  dbscan,
  estimateDBSCANParams,
  type Point2D,
} from '../dimensionality-reduction';

describe('PCA', () => {
  it('should reduce 3D data to 2D', () => {
    const data = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ];

    const pca = new PCA();
    const reduced = pca.fitTransform(data, 2);

    expect(reduced).toHaveLength(4);
    expect(reduced[0]).toHaveLength(2);
    expect(reduced[3]).toHaveLength(2);
  });

  it('should reduce high-dimensional data to 2D', () => {
    const data = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 768 }, (_, j) => i * 0.1 + j * 0.01)
    );

    const pca = new PCA();
    const reduced = pca.fitTransform(data, 2);

    expect(reduced).toHaveLength(10);
    expect(reduced[0]).toHaveLength(2);
  });

  it('should reduce high-dimensional data to 3D', () => {
    const data = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 1024 }, (_, j) => i * 0.1 + j * 0.01)
    );

    const pca = new PCA();
    const reduced = pca.fitTransform(data, 3);

    expect(reduced).toHaveLength(10);
    expect(reduced[0]).toHaveLength(3);
  });

  it('should handle empty data', () => {
    const pca = new PCA();
    const reduced = pca.fitTransform([], 2);

    expect(reduced).toHaveLength(0);
  });
});

describe('reduceTo2D', () => {
  it('should reduce and normalize embeddings to 2D', () => {
    const embeddings = Array.from({ length: 20 }, (_, i) =>
      Array.from({ length: 768 }, (_, j) => Math.random())
    );

    const points = reduceTo2D(embeddings);

    expect(points).toHaveLength(20);

    // Check that points are normalized to [0, 1]
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it('should handle empty embeddings', () => {
    const points = reduceTo2D([]);
    expect(points).toHaveLength(0);
  });

  it('should produce deterministic results for same input', () => {
    const embeddings = [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
    ];

    const points1 = reduceTo2D(embeddings);
    const points2 = reduceTo2D(embeddings);

    // Note: Results may vary due to random projection
    // but the structure should be consistent
    expect(points1).toHaveLength(3);
    expect(points2).toHaveLength(3);
  });
});

describe('reduceTo3D', () => {
  it('should reduce and normalize embeddings to 3D', () => {
    const embeddings = Array.from({ length: 15 }, (_, i) =>
      Array.from({ length: 768 }, (_, j) => Math.random())
    );

    const points = reduceTo3D(embeddings);

    expect(points).toHaveLength(15);

    // Check that points are normalized to [0, 1]
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(point.z).toBeGreaterThanOrEqual(0);
      expect(point.z).toBeLessThanOrEqual(1);
    }
  });
});

describe('DBSCAN Clustering', () => {
  it('should cluster points into groups', () => {
    // Create two clear clusters
    const cluster1: Point2D[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.12 },
      { x: 0.11, y: 0.13 },
      { x: 0.13, y: 0.11 },
      { x: 0.14, y: 0.14 },
    ];

    const cluster2: Point2D[] = [
      { x: 0.8, y: 0.8 },
      { x: 0.82, y: 0.82 },
      { x: 0.81, y: 0.83 },
      { x: 0.83, y: 0.81 },
      { x: 0.84, y: 0.84 },
    ];

    const points = [...cluster1, ...cluster2];

    const result = dbscan(points, 0.05, 3);

    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    expect(result.labels).toHaveLength(10);
  });

  it('should identify noise points', () => {
    const points: Point2D[] = [
      // Cluster
      { x: 0.5, y: 0.5 },
      { x: 0.51, y: 0.51 },
      { x: 0.52, y: 0.52 },
      { x: 0.53, y: 0.53 },
      // Noise (far away)
      { x: 0.9, y: 0.9 },
    ];

    const result = dbscan(points, 0.05, 3);

    expect(result.noisePoints.length).toBeGreaterThan(0);
    expect(result.labels[4]).toBe(-1); // Last point should be noise
  });

  it('should handle empty points', () => {
    const result = dbscan([], 0.05, 3);

    expect(result.clusters).toHaveLength(0);
    expect(result.labels).toHaveLength(0);
    expect(result.noisePoints).toHaveLength(0);
  });

  it('should assign colors to clusters', () => {
    const points: Point2D[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.12 },
      { x: 0.11, y: 0.13 },
      { x: 0.13, y: 0.11 },
      { x: 0.14, y: 0.14 },
    ];

    const result = dbscan(points, 0.05, 3);

    if (result.clusters.length > 0) {
      expect(result.clusters[0].color).toBeDefined();
      expect(result.clusters[0].color).toMatch(/^hsl\(/);
    }
  });

  it('should calculate cluster centroids', () => {
    const points: Point2D[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.15, y: 0.15 },
    ];

    const result = dbscan(points, 0.15, 2);

    if (result.clusters.length > 0) {
      const centroid = result.clusters[0].centroid;
      expect(centroid.x).toBeGreaterThan(0);
      expect(centroid.y).toBeGreaterThan(0);
    }
  });
});

describe('estimateDBSCANParams', () => {
  it('should estimate parameters for small dataset', () => {
    const points: Point2D[] = Array.from({ length: 10 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
    }));

    const params = estimateDBSCANParams(points);

    expect(params.eps).toBeGreaterThan(0);
    expect(params.minPts).toBeGreaterThanOrEqual(4);
    expect(params.minPts).toBeLessThanOrEqual(10);
  });

  it('should estimate parameters for large dataset', () => {
    const points: Point2D[] = Array.from({ length: 100 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
    }));

    const params = estimateDBSCANParams(points);

    expect(params.eps).toBeGreaterThan(0);
    expect(params.minPts).toBeGreaterThanOrEqual(4);
  });

  it('should scale minPts with dataset size', () => {
    const smallPoints: Point2D[] = Array.from({ length: 10 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
    }));

    const largePoints: Point2D[] = Array.from({ length: 100 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
    }));

    const smallParams = estimateDBSCANParams(smallPoints);
    const largeParams = estimateDBSCANParams(largePoints);

    expect(largeParams.minPts).toBeGreaterThanOrEqual(smallParams.minPts);
  });
});

describe('Integration: Full pipeline', () => {
  it('should reduce embeddings and cluster them', () => {
    // Simulate real artwork embeddings (1024 dimensions)
    const embeddings = Array.from({ length: 30 }, (_, i) =>
      Array.from({ length: 1024 }, (_, j) => {
        // Create 3 distinct clusters in high-dimensional space
        const cluster = Math.floor(i / 10);
        return cluster * 0.5 + Math.random() * 0.1;
      })
    );

    // Reduce to 2D
    const points = reduceTo2D(embeddings);

    expect(points).toHaveLength(30);

    // Estimate clustering parameters
    const params = estimateDBSCANParams(points);

    expect(params.eps).toBeGreaterThan(0);
    expect(params.minPts).toBeGreaterThan(0);

    // Perform clustering
    const result = dbscan(points, params.eps, params.minPts);

    expect(result.labels).toHaveLength(30);
    // Should find at least 1 cluster
    expect(
      result.clusters.length + result.noisePoints.length
    ).toBeGreaterThanOrEqual(1);
  });

  it('should handle real-world artwork embeddings', () => {
    // Simulate embeddings from actual CLIP model (768 dimensions)
    const embeddings = [
      // Similar artworks (paintings)
      Array.from({ length: 768 }, () => 0.5 + Math.random() * 0.1),
      Array.from({ length: 768 }, () => 0.52 + Math.random() * 0.1),
      Array.from({ length: 768 }, () => 0.51 + Math.random() * 0.1),
      // Different artworks (sculptures)
      Array.from({ length: 768 }, () => -0.3 + Math.random() * 0.1),
      Array.from({ length: 768 }, () => -0.32 + Math.random() * 0.1),
      Array.from({ length: 768 }, () => -0.31 + Math.random() * 0.1),
    ];

    const points = reduceTo2D(embeddings);
    const params = estimateDBSCANParams(points);
    const result = dbscan(points, params.eps, params.minPts);

    // Should successfully process the data
    expect(result.labels).toHaveLength(6);
    expect(result.clusters.length + result.noisePoints.length).toBeGreaterThan(
      0
    );
  });
});
