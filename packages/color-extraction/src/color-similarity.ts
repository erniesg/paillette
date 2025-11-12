import Color from 'colorjs.io';
import type { ColorPaletteItem } from './types';

/**
 * Color similarity calculations using DeltaE 2000
 */
export class ColorSimilarity {
  /**
   * Calculate DeltaE 2000 color distance between two hex colors
   * DeltaE 2000 is the most accurate perceptual color difference algorithm
   *
   * @param color1 - Hex color (e.g., "#FF5733")
   * @param color2 - Hex color (e.g., "#00AAFF")
   * @returns DeltaE distance (0 = identical, >100 = very different)
   */
  static deltaE2000(color1: string, color2: string): number {
    const c1 = new Color(color1);
    const c2 = new Color(color2);

    // Calculate DeltaE 2000
    const distance = c1.deltaE(c2, '2000');

    return distance;
  }

  /**
   * Check if two colors are within a given threshold
   *
   * @param color1 - Hex color
   * @param color2 - Hex color
   * @param threshold - Maximum DeltaE distance (default: 10)
   * @returns True if colors are within threshold
   */
  static isWithinThreshold(
    color1: string,
    color2: string,
    threshold: number = 10
  ): boolean {
    const distance = this.deltaE2000(color1, color2);
    return distance <= threshold;
  }

  /**
   * Find all colors in a palette that are similar to a search color
   *
   * @param searchColor - Hex color to search for
   * @param palette - Array of color palette items
   * @param threshold - Maximum DeltaE distance (default: 10)
   * @returns Array of matching colors with distances, sorted by distance
   */
  static findSimilarColors(
    searchColor: string,
    palette: ColorPaletteItem[],
    threshold: number = 10
  ): Array<{ color: ColorPaletteItem; distance: number }> {
    const matches: Array<{ color: ColorPaletteItem; distance: number }> = [];

    for (const paletteColor of palette) {
      const distance = this.deltaE2000(searchColor, paletteColor.color);

      if (distance <= threshold) {
        matches.push({
          color: paletteColor,
          distance,
        });
      }
    }

    // Sort by distance (ascending)
    matches.sort((a, b) => a.distance - b.distance);

    return matches;
  }

  /**
   * Check if a color is perceptually identical (below JND threshold)
   * Just Noticeable Difference (JND) for DeltaE 2000 is ~2.3
   *
   * @param color1 - Hex color
   * @param color2 - Hex color
   * @returns True if colors are perceptually identical
   */
  static isPerceptuallyIdentical(color1: string, color2: string): boolean {
    const JND_THRESHOLD = 2.3;
    const distance = this.deltaE2000(color1, color2);
    return distance < JND_THRESHOLD;
  }

  /**
   * Get the closest color from a palette to a search color
   *
   * @param searchColor - Hex color to search for
   * @param palette - Array of color palette items
   * @returns Closest color with distance, or null if palette is empty
   */
  static findClosestColor(
    searchColor: string,
    palette: ColorPaletteItem[]
  ): { color: ColorPaletteItem; distance: number } | null {
    if (palette.length === 0) return null;

    let closestColor = palette[0];
    let minDistance = this.deltaE2000(searchColor, closestColor.color);

    for (let i = 1; i < palette.length; i++) {
      const distance = this.deltaE2000(searchColor, palette[i].color);
      if (distance < minDistance) {
        minDistance = distance;
        closestColor = palette[i];
      }
    }

    return {
      color: closestColor,
      distance: minDistance,
    };
  }
}
