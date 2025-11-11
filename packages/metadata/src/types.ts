import { z } from 'zod';

/**
 * Schema for artwork metadata row in CSV
 * Supports both update (with artwork_id) and create (without artwork_id) operations
 */
export const ArtworkRowSchema = z.object({
  artwork_id: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(500),
  artist: z.string().max(255).optional(),
  year: z.coerce.number().int().min(1000).max(2100).optional(),
  medium: z.string().max(255).optional(),
  dimensions_height: z.coerce.number().positive().optional(),
  dimensions_width: z.coerce.number().positive().optional(),
  dimensions_depth: z.coerce.number().positive().optional(),
  dimensions_unit: z.enum(['cm', 'in', 'm']).optional(),
  description: z.string().max(5000).optional(),
  provenance: z.string().max(2000).optional(),
  image_filename: z.string().min(1).optional(),
});

export type ArtworkRow = z.infer<typeof ArtworkRowSchema>;

/**
 * Result of CSV parsing operation
 */
export interface CSVParseResult {
  success: boolean;
  rows: ArtworkRow[];
  errors: Array<{
    row: number;
    column: string;
    message: string;
    value: any;
  }>;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

/**
 * Result of batch metadata processing
 */
export interface BatchProcessResult {
  created: Array<{ id: string; title: string }>;
  updated: Array<{ id: string; title: string }>;
  failed: Array<{ row: number; error: string }>;
  stats: {
    total: number;
    created: number;
    updated: number;
    failed: number;
  };
}
