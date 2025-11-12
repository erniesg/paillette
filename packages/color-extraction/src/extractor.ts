import { Vibrant } from 'node-vibrant/node';
import type {
  ColorExtractionResult,
  ColorPaletteItem,
  RGB,
} from './types';

/**
 * Color extraction service using node-vibrant (MMCQ algorithm)
 */
export class ColorExtractor {
  /**
   * Convert RGB array to hex color
   */
  private static rgbToHex(rgb: RGB): string {
    const { r, g, b } = rgb;
    return (
      '#' +
      [r, g, b]
        .map((c) => Math.round(c).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  /**
   * Calculate percentages for color palette based on population
   */
  private static calculatePercentages(
    swatches: Array<{ population: number }>
  ): number[] {
    const totalPopulation = swatches.reduce((sum, s) => sum + s.population, 0);

    if (totalPopulation === 0) {
      // If no population data, use equal distribution
      const equal = 100 / swatches.length;
      return swatches.map(() => equal);
    }

    return swatches.map((s) => (s.population / totalPopulation) * 100);
  }

  /**
   * Extract dominant colors from an image URL
   *
   * @param imageUrl - URL of the image to analyze
   * @param colorCount - Number of colors to extract (default: 5)
   * @returns Color extraction result with dominant colors
   */
  static async extract(
    imageUrl: string,
    colorCount: number = 5
  ): Promise<ColorExtractionResult> {
    try {
      // Use node-vibrant to extract palette
      const palette = await Vibrant.from(imageUrl)
        .maxColorCount(colorCount * 2) // Get more colors to ensure we have enough
        .quality(1) // Higher quality = slower but more accurate
        .getPalette();

      // Convert palette to array of swatches
      const swatches = Object.values(palette).filter((swatch) => swatch !== null);

      if (swatches.length === 0) {
        throw new Error('Failed to extract colors from image');
      }

      // Sort by population (most common first)
      swatches.sort((a, b) => (b?.population || 0) - (a?.population || 0));

      // Take top N colors
      const topSwatches = swatches.slice(0, colorCount);

      // Calculate percentages based on population
      const percentages = this.calculatePercentages(topSwatches);

      // Convert to ColorPaletteItem format
      const dominantColors: ColorPaletteItem[] = topSwatches.map(
        (swatch, index) => {
          const rgb = swatch!.getRgb();
          const rgbObj: RGB = {
            r: Math.round(rgb[0]),
            g: Math.round(rgb[1]),
            b: Math.round(rgb[2]),
          };

          return {
            color: this.rgbToHex(rgbObj),
            rgb: rgbObj,
            percentage: percentages[index],
          };
        }
      );

      return {
        dominantColors,
        palette: dominantColors,
        extractedAt: new Date().toISOString(),
        imageUrl,
      };
    } catch (error) {
      throw new Error(
        `Failed to extract colors from ${imageUrl}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Extract dominant colors from an image buffer
   *
   * @param buffer - Image buffer
   * @param colorCount - Number of colors to extract (default: 5)
   * @returns Color extraction result with dominant colors
   */
  static async extractFromBuffer(
    buffer: Buffer,
    colorCount: number = 5
  ): Promise<Omit<ColorExtractionResult, 'imageUrl'>> {
    try {
      // Use node-vibrant with buffer
      const palette = await Vibrant.from(buffer)
        .maxColorCount(colorCount * 2)
        .quality(1)
        .getPalette();

      const swatches = Object.values(palette).filter((swatch) => swatch !== null);

      if (swatches.length === 0) {
        throw new Error('Failed to extract colors from buffer');
      }

      swatches.sort((a, b) => (b?.population || 0) - (a?.population || 0));
      const topSwatches = swatches.slice(0, colorCount);
      const percentages = this.calculatePercentages(topSwatches);

      const dominantColors: ColorPaletteItem[] = topSwatches.map(
        (swatch, index) => {
          const rgb = swatch!.getRgb();
          const rgbObj: RGB = {
            r: Math.round(rgb[0]),
            g: Math.round(rgb[1]),
            b: Math.round(rgb[2]),
          };

          return {
            color: this.rgbToHex(rgbObj),
            rgb: rgbObj,
            percentage: percentages[index],
          };
        }
      );

      return {
        dominantColors,
        palette: dominantColors,
        extractedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(
        `Failed to extract colors from buffer: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get the single most dominant color from an image
   *
   * @param imageUrl - URL of the image
   * @returns Single dominant color
   */
  static async getDominantColor(imageUrl: string): Promise<string> {
    const result = await this.extract(imageUrl, 1);
    return result.dominantColors[0].color;
  }

  /**
   * Validate if a color is grayscale
   * (All RGB components are within a threshold of each other)
   */
  static isGrayscale(rgb: RGB, threshold: number = 30): boolean {
    const { r, g, b } = rgb;
    const maxDiff = Math.max(
      Math.abs(r - g),
      Math.abs(g - b),
      Math.abs(r - b)
    );
    return maxDiff < threshold;
  }

  /**
   * Calculate color diversity score for a palette
   * Higher score = more diverse colors
   *
   * @param palette - Color palette
   * @returns Diversity score (0-100)
   */
  static calculateDiversity(palette: ColorPaletteItem[]): number {
    if (palette.length < 2) return 0;

    let totalDistance = 0;
    let comparisons = 0;

    // Calculate average color distance between all pairs
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const rgb1 = palette[i].rgb;
        const rgb2 = palette[j].rgb;

        // Euclidean distance in RGB space
        const distance = Math.sqrt(
          Math.pow(rgb1.r - rgb2.r, 2) +
            Math.pow(rgb1.g - rgb2.g, 2) +
            Math.pow(rgb1.b - rgb2.b, 2)
        );

        totalDistance += distance;
        comparisons++;
      }
    }

    const avgDistance = totalDistance / comparisons;

    // Normalize to 0-100 (max RGB distance is ~441)
    return Math.min((avgDistance / 441) * 100, 100);
  }
}
