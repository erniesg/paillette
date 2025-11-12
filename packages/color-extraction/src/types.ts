import { z } from 'zod';

/**
 * RGB color representation
 */
export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

/**
 * Color palette item with percentage
 */
export interface ColorPaletteItem {
  color: string; // hex color e.g., "#FF5733"
  rgb: RGB;
  percentage: number; // 0-100
}

/**
 * Color extraction result
 */
export interface ColorExtractionResult {
  dominantColors: ColorPaletteItem[];
  palette: ColorPaletteItem[];
  extractedAt: string; // ISO timestamp
  imageUrl: string;
}

/**
 * Color search query
 */
export const ColorSearchQuerySchema = z.object({
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(5),
  matchMode: z.enum(['any', 'all']).default('any'),
  threshold: z.number().min(0).max(30).default(10), // DeltaE distance threshold
  limit: z.number().int().positive().max(100).default(20),
});

export type ColorSearchQuery = z.infer<typeof ColorSearchQuerySchema>;

/**
 * Color search result item
 */
export interface ColorSearchResultItem {
  artworkId: string;
  title: string;
  imageUrl: string;
  matchedColors: Array<{
    searchColor: string;
    artworkColor: string;
    distance: number; // DeltaE 2000 distance
  }>;
  averageDistance: number;
  dominantColors: ColorPaletteItem[];
}

/**
 * Color search result
 */
export interface ColorSearchResult {
  results: ColorSearchResultItem[];
  query: ColorSearchQuery;
  totalResults: number;
  took: number; // ms
}
