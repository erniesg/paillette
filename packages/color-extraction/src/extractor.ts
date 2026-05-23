import { Vibrant } from 'node-vibrant/node';
import type { ColorExtractionResult, ColorPaletteItem, RGB } from './types';

type VibrantSwatchLike = {
  getRgb?: () => number[];
  rgb?: number[];
  _rgb?: number[];
  getPopulation?: () => number;
  population?: number;
  _population?: number;
};

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
  private static calculatePercentages(swatches: VibrantSwatchLike[]): number[] {
    const totalPopulation = swatches.reduce(
      (sum, swatch) => sum + this.getPopulation(swatch),
      0
    );

    if (totalPopulation === 0) {
      // If no population data, use equal distribution
      const equal = 100 / swatches.length;
      return swatches.map(() => equal);
    }

    return swatches.map(
      (swatch) => (this.getPopulation(swatch) / totalPopulation) * 100
    );
  }

  private static getPopulation(swatch: VibrantSwatchLike): number {
    if (typeof swatch.getPopulation === 'function') {
      return swatch.getPopulation();
    }

    return swatch.population ?? swatch._population ?? 0;
  }

  private static getRgb(swatch: VibrantSwatchLike): number[] {
    if (typeof swatch.getRgb === 'function') {
      return swatch.getRgb();
    }

    const rgb = swatch.rgb ?? swatch._rgb;
    if (!rgb || rgb.length < 3) {
      throw new Error('Swatch does not contain RGB data');
    }

    return rgb;
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
      const swatches = Object.values(palette)
        .filter(Boolean)
        .map((swatch) => swatch as unknown as VibrantSwatchLike);

      if (swatches.length === 0) {
        throw new Error('Failed to extract colors from image');
      }

      // Sort by population (most common first)
      swatches.sort((a, b) => this.getPopulation(b) - this.getPopulation(a));

      // Take top N colors
      const topSwatches = swatches.slice(0, colorCount);

      // Calculate percentages based on population
      const percentages = this.calculatePercentages(topSwatches);

      // Convert to ColorPaletteItem format
      const dominantColors: ColorPaletteItem[] = topSwatches.map(
        (swatch, index) => {
          const rgb = this.getRgb(swatch);
          const rgbObj: RGB = {
            r: Math.round(rgb[0] ?? 0),
            g: Math.round(rgb[1] ?? 0),
            b: Math.round(rgb[2] ?? 0),
          };

          return {
            color: this.rgbToHex(rgbObj),
            rgb: rgbObj,
            percentage: percentages[index] ?? 0,
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

      const swatches = Object.values(palette)
        .filter(Boolean)
        .map((swatch) => swatch as unknown as VibrantSwatchLike);

      if (swatches.length === 0) {
        throw new Error('Failed to extract colors from buffer');
      }

      swatches.sort((a, b) => this.getPopulation(b) - this.getPopulation(a));
      const topSwatches = swatches.slice(0, colorCount);
      const percentages = this.calculatePercentages(topSwatches);

      const dominantColors: ColorPaletteItem[] = topSwatches.map(
        (swatch, index) => {
          const rgb = this.getRgb(swatch);
          const rgbObj: RGB = {
            r: Math.round(rgb[0] ?? 0),
            g: Math.round(rgb[1] ?? 0),
            b: Math.round(rgb[2] ?? 0),
          };

          return {
            color: this.rgbToHex(rgbObj),
            rgb: rgbObj,
            percentage: percentages[index] ?? 0,
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
    const [dominantColor] = result.dominantColors;
    if (!dominantColor) {
      throw new Error('No dominant color extracted');
    }

    return dominantColor.color;
  }

  /**
   * Validate if a color is grayscale
   * (All RGB components are within a threshold of each other)
   */
  static isGrayscale(rgb: RGB, threshold: number = 30): boolean {
    const { r, g, b } = rgb;
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
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
        const rgb1 = palette[i]!.rgb;
        const rgb2 = palette[j]!.rgb;

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
