/**
 * Batch Metadata Processor
 * Handles batch create and update operations for artwork metadata
 */

import { randomUUID } from 'crypto';
import type { ArtworkRow, BatchProcessResult } from './types';

export class BatchMetadataProcessor {
  constructor(private db: D1Database) {}

  /**
   * Process a batch of artwork metadata rows
   * Supports both create (no artwork_id) and update (with artwork_id) operations
   * Also supports matching by image_filename
   *
   * @param rows - Validated artwork rows from CSV
   * @param orgId - Org ID for new artworks
   * @param userId - User ID performing the operation
   * @returns Batch process result with created, updated, and failed items
   */
  async processBatch(
    rows: ArtworkRow[],
    orgId: string,
    userId: string
  ): Promise<BatchProcessResult> {
    const created: Array<{ id: string; title: string }> = [];
    const updated: Array<{ id: string; title: string }> = [];
    const failed: Array<{ row: number; error: string }> = [];

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 for header row and 0-index

      try {
        if (row.artwork_id) {
          // UPDATE operation: artwork_id provided
          await this.updateArtwork(row, orgId, userId);
          updated.push({ id: row.artwork_id, title: row.title });
        } else if (row.image_filename) {
          // Try to match by image_filename
          const existing = await this.findArtworkByFilename(
            row.image_filename,
            orgId
          );

          if (existing) {
            // UPDATE existing artwork matched by filename
            await this.updateArtwork(
              { ...row, artwork_id: existing.id },
              orgId,
              userId
            );
            updated.push({ id: existing.id, title: row.title });
          } else {
            // CREATE new artwork
            const artworkId = await this.createArtwork(row, orgId, userId);
            created.push({ id: artworkId, title: row.title });
          }
        } else {
          // CREATE operation: no artwork_id or image_filename
          const artworkId = await this.createArtwork(row, orgId, userId);
          created.push({ id: artworkId, title: row.title });
        }
      } catch (error) {
        failed.push({
          row: rowNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      created,
      updated,
      failed,
      stats: {
        total: rows.length,
        created: created.length,
        updated: updated.length,
        failed: failed.length,
      },
    };
  }

  /**
   * Create a new artwork record
   */
  private async createArtwork(
    row: ArtworkRow,
    orgId: string,
    userId: string
  ): Promise<string> {
    const artworkId = randomUUID();
    const now = new Date().toISOString();

    const originalFilename = row.image_filename || null;

    await this.db
      .prepare(
        `INSERT INTO artworks (
          id, org_id, collection_id, image_url, thumbnail_url,
          original_filename, image_hash,
          image_url_processed, processing_status, frame_removal_confidence, processed_at, processing_error,
          embedding_id,
          title, artist, year, medium,
          dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
          description, provenance, field_sources, translations,
          dominant_colors, color_palette, custom_metadata, citation,
          created_at, updated_at, uploaded_by, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        artworkId,
        orgId,
        null, // collection_id
        null, // image_url
        null, // thumbnail_url
        originalFilename,
        null, // image_hash
        null, // image_url_processed
        null, // processing_status
        null, // frame_removal_confidence
        null, // processed_at
        null, // processing_error
        null, // embedding_id
        row.title,
        row.artist || null,
        row.year || null,
        row.medium || null,
        row.dimensions_height || null,
        row.dimensions_width || null,
        row.dimensions_depth || null,
        row.dimensions_unit || null,
        row.description || null,
        row.provenance || null,
        '{}', // field_sources
        '{}', // translations
        null, // dominant_colors
        null, // color_palette
        '{}', // custom_metadata
        null, // citation
        now,
        now,
        userId,
        null // deleted_at
      )
      .run();

    return artworkId;
  }

  /**
   * Update an existing artwork record
   */
  private async updateArtwork(
    row: ArtworkRow & { artwork_id: string },
    orgId: string,
    userId: string
  ): Promise<void> {
    // Check if artwork exists
    const existing = await this.db
      .prepare('SELECT * FROM artworks WHERE id = ? AND org_id = ?')
      .bind(row.artwork_id, orgId)
      .first();

    if (!existing) {
      throw new Error(`Artwork with ID ${row.artwork_id} not found in org`);
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const params: any[] = [];

    // Map CSV fields to DB columns
    const fieldMap: Record<string, any> = {
      title: row.title,
      artist: row.artist,
      year: row.year,
      medium: row.medium,
      dimensions_height: row.dimensions_height,
      dimensions_width: row.dimensions_width,
      dimensions_depth: row.dimensions_depth,
      dimensions_unit: row.dimensions_unit,
      description: row.description,
      provenance: row.provenance,
    };

    // Only update fields that are provided (not undefined)
    Object.entries(fieldMap).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (updates.length === 0) {
      // No fields to update, but still considered success
      return;
    }

    // Add updated_at timestamp
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());

    // Add artwork_id for WHERE clause
    params.push(row.artwork_id);

    await this.db
      .prepare(`UPDATE artworks SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  /**
   * Find artwork by image filename
   */
  private async findArtworkByFilename(
    filename: string,
    orgId: string
  ): Promise<{ id: string } | null> {
    const result = await this.db
      .prepare(
        'SELECT id FROM artworks WHERE original_filename = ? AND org_id = ?'
      )
      .bind(filename, orgId)
      .first<{ id: string }>();

    return result;
  }
}
