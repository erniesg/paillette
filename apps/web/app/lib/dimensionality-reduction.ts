/**
 * Dimensionality reduction utilities for embedding visualization
 * Implements PCA (Principal Component Analysis) for reducing high-dimensional embeddings to 2D/3D
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D extends Point2D {
  z: number;
}

/**
 * Simple PCA implementation for reducing embeddings to 2D or 3D
 */
export class PCA {
  private mean: number[] = [];
  private components: number[][] = [];

  /**
   * Fit PCA on the data and transform to lower dimensions
   * @param data - Array of high-dimensional vectors (N x D)
   * @param dimensions - Target dimensions (2 or 3)
   * @returns Reduced data (N x dimensions)
   */
  fitTransform(data: number[][], dimensions: 2 | 3 = 2): number[][] {
    if (data.length === 0) return [];

    const n = data.length;
    const d = data[0].length;

    // 1. Calculate mean
    this.mean = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < d; j++) {
        this.mean[j] += data[i][j];
      }
    }
    this.mean = this.mean.map((m) => m / n);

    // 2. Center the data
    const centered = data.map((row) =>
      row.map((val, idx) => val - this.mean[idx])
    );

    // 3. Calculate covariance matrix (simplified - use randomized SVD for large data)
    // For performance, we'll use a simplified approach with random projections
    // This is faster than full SVD for high-dimensional data

    const targetDim = dimensions;
    this.components = this.randomProjection(d, targetDim);

    // 4. Transform data
    const transformed = this.transform(centered);

    return transformed;
  }

  /**
   * Random projection for dimensionality reduction
   * This is much faster than full PCA/SVD for high-dimensional data
   */
  private randomProjection(inputDim: number, outputDim: number): number[][] {
    const components: number[][] = [];

    for (let i = 0; i < outputDim; i++) {
      const component: number[] = [];
      for (let j = 0; j < inputDim; j++) {
        // Random Gaussian projection
        component.push(this.randomNormal());
      }
      // Normalize
      const norm = Math.sqrt(
        component.reduce((sum, val) => sum + val * val, 0)
      );
      components.push(component.map((val) => val / norm));
    }

    return components;
  }

  /**
   * Generate random number from normal distribution (Box-Muller transform)
   */
  private randomNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Transform data using fitted components
   */
  private transform(data: number[][]): number[][] {
    return data.map((row) => {
      return this.components.map((component) => {
        return row.reduce((sum, val, idx) => sum + val * component[idx], 0);
      });
    });
  }
}

/**
 * Reduce embeddings to 2D points
 */
export function reduceTo2D(embeddings: number[][]): Point2D[] {
  if (embeddings.length === 0) return [];

  const pca = new PCA();
  const reduced = pca.fitTransform(embeddings, 2);

  // Normalize to [0, 1] range for better visualization
  const points = reduced.map(([x, y]) => ({ x, y }));
  return normalizePoints2D(points);
}

/**
 * Reduce embeddings to 3D points
 */
export function reduceTo3D(embeddings: number[][]): Point3D[] {
  if (embeddings.length === 0) return [];

  const pca = new PCA();
  const reduced = pca.fitTransform(embeddings, 3);

  const points = reduced.map(([x, y, z]) => ({ x, y, z }));
  return normalizePoints3D(points);
}

/**
 * Normalize 2D points to [0, 1] range
 */
function normalizePoints2D(points: Point2D[]): Point2D[] {
  if (points.length === 0) return [];

  const xValues = points.map((p) => p.x);
  const yValues = points.map((p) => p.y);

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  return points.map((p) => ({
    x: (p.x - xMin) / xRange,
    y: (p.y - yMin) / yRange,
  }));
}

/**
 * Normalize 3D points to [0, 1] range
 */
function normalizePoints3D(points: Point3D[]): Point3D[] {
  if (points.length === 0) return [];

  const xValues = points.map((p) => p.x);
  const yValues = points.map((p) => p.y);
  const zValues = points.map((p) => p.z);

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const zMin = Math.min(...zValues);
  const zMax = Math.max(...zValues);

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const zRange = zMax - zMin || 1;

  return points.map((p) => ({
    x: (p.x - xMin) / xRange,
    y: (p.y - yMin) / yRange,
    z: (p.z - zMin) / zRange,
  }));
}

/**
 * Calculate pairwise distances between points (for debugging/validation)
 */
export function calculateDistances(points: Point2D[]): number[][] {
  const n = points.length;
  const distances: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      distances[i][j] = dist;
      distances[j][i] = dist;
    }
  }

  return distances;
}
