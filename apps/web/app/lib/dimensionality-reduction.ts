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
    const d = data[0]?.length ?? 0;
    if (d === 0) return [];

    // 1. Calculate mean
    this.mean = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      const row = data[i];
      if (!row) continue;
      for (let j = 0; j < d; j++) {
        const val = row[j];
        const meanVal = this.mean[j];
        if (val !== undefined && meanVal !== undefined) {
          this.mean[j] = meanVal + val;
        }
      }
    }
    this.mean = this.mean.map((m) => m / n);

    // 2. Center the data
    const centered = data.map((row) =>
      row.map((val, idx) => val - (this.mean[idx] ?? 0))
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
        return row.reduce((sum, val, idx) => sum + val * (component[idx] ?? 0), 0);
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
  const points = reduced.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
  return normalizePoints2D(points);
}

/**
 * Reduce embeddings to 3D points
 */
export function reduceTo3D(embeddings: number[][]): Point3D[] {
  if (embeddings.length === 0) return [];

  const pca = new PCA();
  const reduced = pca.fitTransform(embeddings, 3);

  const points = reduced.map(([x, y, z]) => ({ x: x ?? 0, y: y ?? 0, z: z ?? 0 }));
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
    const distRow1 = distances[i];
    if (!distRow1) continue;

    for (let j = i + 1; j < n; j++) {
      const p1 = points[i];
      const p2 = points[j];
      const distRow2 = distances[j];
      if (!p1 || !p2 || !distRow2) continue;
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      distRow1[j] = dist;
      distRow2[i] = dist;
    }
  }

  return distances;
}

/**
 * DBSCAN Clustering Algorithm
 * Density-Based Spatial Clustering of Applications with Noise
 */
export interface Cluster {
  id: number;
  points: number[]; // Indices of points in this cluster
  centroid: Point2D;
  color: string;
}

export interface ClusterResult {
  clusters: Cluster[];
  labels: number[]; // -1 for noise, 0+ for cluster ID
  noisePoints: number[]; // Indices of noise points
}

/**
 * Perform DBSCAN clustering on 2D points
 * @param points - Array of 2D points
 * @param eps - Maximum distance between points in a cluster (epsilon)
 * @param minPts - Minimum number of points to form a dense region
 * @returns Cluster result with labels and cluster info
 */
export function dbscan(
  points: Point2D[],
  eps: number = 0.05,
  minPts: number = 5
): ClusterResult {
  const n = points.length;
  const labels = new Array(n).fill(-1); // -1 = unvisited
  const visited = new Array(n).fill(false);
  let clusterId = 0;
  const clusters: Cluster[] = [];

  // Calculate distance between two points
  const distance = (i: number, j: number): number => {
    const p1 = points[i];
    const p2 = points[j];
    if (!p1 || !p2) return Infinity;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Find all neighbors within eps distance
  const getNeighbors = (pointIdx: number): number[] => {
    const neighbors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (distance(pointIdx, i) <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  };

  // Expand cluster from a seed point
  const expandCluster = (pointIdx: number, neighbors: number[]): void => {
    if (labels[pointIdx] === undefined) return;
    labels[pointIdx] = clusterId;
    const clusterPoints = [pointIdx];

    let i = 0;
    while (i < neighbors.length) {
      const neighborIdx = neighbors[i];
      if (neighborIdx === undefined) {
        i++;
        continue;
      }

      if (!visited[neighborIdx]) {
        visited[neighborIdx] = true;
        const neighborNeighbors = getNeighbors(neighborIdx);

        if (neighborNeighbors.length >= minPts) {
          // Add new neighbors to expand
          neighbors.push(
            ...neighborNeighbors.filter((n) => !neighbors.includes(n))
          );
        }
      }

      if (labels[neighborIdx] === -1) {
        labels[neighborIdx] = clusterId;
        clusterPoints.push(neighborIdx);
      }

      i++;
    }

    // Calculate cluster centroid
    let cx = 0,
      cy = 0;
    for (const idx of clusterPoints) {
      const point = points[idx];
      if (point) {
        cx += point.x;
        cy += point.y;
      }
    }
    const centroid = {
      x: cx / clusterPoints.length,
      y: cy / clusterPoints.length,
    };

    // Assign cluster color
    const color = generateClusterColor(clusterId);

    clusters.push({
      id: clusterId,
      points: clusterPoints,
      centroid,
      color,
    });
  };

  // Main DBSCAN loop
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;

    const neighbors = getNeighbors(i);

    if (neighbors.length < minPts) {
      // Mark as noise (labels[i] stays -1)
      continue;
    }

    // Start a new cluster
    expandCluster(i, neighbors);
    clusterId++;
  }

  // Collect noise points
  const noisePoints: number[] = [];
  for (let i = 0; i < n; i++) {
    if (labels[i] === -1) {
      noisePoints.push(i);
    }
  }

  return {
    clusters,
    labels,
    noisePoints,
  };
}

/**
 * Generate a distinct color for a cluster
 */
function generateClusterColor(clusterId: number): string {
  const goldenRatio = 0.618033988749895;
  const hue = (clusterId * goldenRatio) % 1;
  const saturation = 0.6 + ((clusterId * 0.1) % 0.3);
  const lightness = 0.5 + ((clusterId * 0.15) % 0.2);
  return `hsl(${hue * 360}, ${saturation * 100}%, ${lightness * 100}%)`;
}

/**
 * Auto-calculate optimal DBSCAN parameters based on data
 * Uses k-distance graph method to estimate eps
 */
export function estimateDBSCANParams(points: Point2D[]): {
  eps: number;
  minPts: number;
} {
  const n = points.length;

  // MinPts is typically 2 * dimensions (for 2D = 4) or ln(n)
  const minPts = Math.max(4, Math.ceil(Math.log(n)));

  // Calculate k-nearest neighbor distances for all points
  const kDistances: number[] = [];

  for (let i = 0; i < n; i++) {
    const distances: number[] = [];
    const pi = points[i];
    if (!pi) continue;

    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const pj = points[j];
        if (!pj) continue;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        distances.push(Math.sqrt(dx * dx + dy * dy));
      }
    }
    distances.sort((a, b) => a - b);
    kDistances.push(distances[minPts - 1] ?? distances[distances.length - 1] ?? 0);
  }

  // Sort k-distances
  kDistances.sort((a, b) => a - b);

  // Find the "elbow" - use the 90th percentile as a heuristic
  const elbowIndex = Math.floor(kDistances.length * 0.9);
  const eps = kDistances[elbowIndex] ?? 0.05;

  return { eps, minPts };
}
