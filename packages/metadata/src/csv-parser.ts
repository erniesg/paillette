import Papa from 'papaparse';
import { z } from 'zod';
import { ArtworkRowSchema, type ArtworkRow, type CSVParseResult } from './types';

/**
 * CSV Parser for artwork metadata
 * Handles validation, type coercion, and error reporting
 */
export class CSVParser {
  /**
   * Parse CSV content and validate against artwork schema
   * @param csvContent - Raw CSV string content
   * @returns Parse result with validated rows and errors
   */
  static async parse(csvContent: string): Promise<CSVParseResult> {
    // Parse CSV using PapaParse
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      transform: (value) => value.trim(),
    });

    const rows: ArtworkRow[] = [];
    const errors: CSVParseResult['errors'] = [];

    // Validate each row
    for (let i = 0; i < parsed.data.length; i++) {
      const rowData = parsed.data[i] as Record<string, any>;
      const rowNumber = i + 2; // +2 for header row and 0-index

      try {
        // Validate row against schema
        const validated = ArtworkRowSchema.parse(rowData);
        rows.push(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          // Collect all validation errors for this row
          error.errors.forEach((err) => {
            errors.push({
              row: rowNumber,
              column: err.path.join('.'),
              message: err.message,
              value: rowData[err.path[0] as string],
            });
          });
        }
      }
    }

    return {
      success: errors.length === 0,
      rows,
      errors,
      stats: {
        totalRows: parsed.data.length,
        validRows: rows.length,
        invalidRows: errors.length,
      },
    };
  }

  /**
   * Validate CSV content without parsing entire file
   * Useful for quick validation of large files
   * @param csvContent - Raw CSV string
   * @returns True if CSV has valid structure
   */
  static validateStructure(csvContent: string): {
    valid: boolean;
    error?: string;
  } {
    try {
      const lines = csvContent.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        return { valid: false, error: 'CSV file is empty' };
      }

      if (lines.length === 1) {
        return { valid: false, error: 'CSV file has no data rows' };
      }

      // Check for required 'title' column
      const header = lines[0].toLowerCase();
      if (!header.includes('title')) {
        return {
          valid: false,
          error: 'CSV must include required column: title',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get sample rows from CSV for preview
   * @param csvContent - Raw CSV string
   * @param limit - Number of rows to return (default: 5)
   * @returns Parsed sample rows
   */
  static getSample(csvContent: string, limit: number = 5): ArtworkRow[] {
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      transform: (value) => value.trim(),
      preview: limit,
    });

    const rows: ArtworkRow[] = [];

    for (const rowData of parsed.data) {
      try {
        const validated = ArtworkRowSchema.parse(rowData);
        rows.push(validated);
      } catch {
        // Skip invalid rows in sample
        continue;
      }
    }

    return rows;
  }
}
