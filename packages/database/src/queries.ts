/**
 * Database query helpers for D1
 * These provide type-safe query builders for common operations
 */

import type {
  UserRow,
  OrgRow,
  ArtworkRow,
  CollectionRow,
  AssetRow,
  AuditLogRow,
} from './types';

/**
 * User queries
 */
export const userQueries = {
  findById: (id: string) => ({
    sql: 'SELECT * FROM users WHERE id = ?',
    params: [id],
  }),

  findByEmail: (email: string) => ({
    sql: 'SELECT * FROM users WHERE email = ?',
    params: [email],
  }),

  create: (user: Omit<UserRow, 'created_at' | 'last_login_at'>) => ({
    sql: `INSERT INTO users (id, email, password_hash, name, role)
          VALUES (?, ?, ?, ?, ?)`,
    params: [user.id, user.email, user.password_hash, user.name, user.role],
  }),

  update: (id: string, updates: Partial<Omit<UserRow, 'id' | 'created_at'>>) => {
    const fields = Object.keys(updates).map((key) => `${key} = ?`);
    const values = Object.values(updates);
    return {
      sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      params: [...values, id],
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM users WHERE id = ?',
    params: [id],
  }),
};

/**
 * Org queries
 */
export const orgQueries = {
  findById: (id: string) => ({
    sql: 'SELECT * FROM orgs WHERE id = ?',
    params: [id],
  }),

  findBySlug: (slug: string) => ({
    sql: 'SELECT * FROM orgs WHERE slug = ?',
    params: [slug],
  }),

  findByOwner: (ownerId: string) => ({
    sql: 'SELECT * FROM orgs WHERE owner_id = ? ORDER BY created_at DESC',
    params: [ownerId],
  }),

  list: (limit = 50, offset = 0) => ({
    sql: 'SELECT * FROM orgs ORDER BY created_at DESC LIMIT ? OFFSET ?',
    params: [limit, offset],
  }),

  create: (
    org: Omit<OrgRow, 'created_at'> & { settings?: Record<string, any> }
  ) => ({
    sql: `INSERT INTO orgs (
      id, name, slug, description, location_country, location_city,
      location_address, website, settings, api_key, api_key_hash, owner_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      org.id,
      org.name,
      org.slug,
      org.description || null,
      org.location_country || null,
      org.location_city || null,
      org.location_address || null,
      org.website || null,
      org.settings ? JSON.stringify(org.settings) : '{}',
      org.api_key,
      org.api_key_hash,
      org.owner_id,
    ],
  }),

  update: (
    id: string,
    updates: Partial<Omit<OrgRow, 'id' | 'created_at' | 'owner_id'>>
  ) => {
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'settings' && typeof value === 'object') {
        fields.push('settings = ?');
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    return {
      sql: `UPDATE orgs SET ${fields.join(', ')} WHERE id = ?`,
      params: [...values, id],
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM orgs WHERE id = ?',
    params: [id],
  }),
};

/** @deprecated Use orgQueries. */
export const galleryQueries = orgQueries;

/**
 * Artwork queries
 */
export const artworkQueries = {
  findById: (id: string) => ({
    sql: 'SELECT * FROM artworks WHERE id = ?',
    params: [id],
  }),

  findByGallery: (galleryId: string, limit = 50, offset = 0) => ({
    sql: `SELECT * FROM artworks
          WHERE org_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
    params: [galleryId, limit, offset],
  }),

  findByOrg: (orgId: string, limit = 50, offset = 0) => ({
    sql: `SELECT * FROM artworks
          WHERE org_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
    params: [orgId, limit, offset],
  }),

  findByCollection: (collectionId: string, limit = 50, offset = 0) => ({
    sql: `SELECT a.* FROM artworks a
          JOIN collection_artworks ca ON a.id = ca.artwork_id
          WHERE ca.collection_id = ?
          ORDER BY ca.position, a.created_at DESC
          LIMIT ? OFFSET ?`,
    params: [collectionId, limit, offset],
  }),

  search: (galleryId: string, searchTerm: string, limit = 50) => ({
    sql: `SELECT * FROM artworks
          WHERE org_id = ?
          AND (
            title LIKE ? OR
            artist LIKE ? OR
            description LIKE ?
          )
          ORDER BY created_at DESC
          LIMIT ?`,
    params: [
      galleryId,
      `%${searchTerm}%`,
      `%${searchTerm}%`,
      `%${searchTerm}%`,
      limit,
    ],
  }),

  create: (artwork: Omit<ArtworkRow, 'created_at' | 'updated_at'>) => {
    const fields = [
      'id',
      'org_id',
      'collection_id',
      'image_url',
      'thumbnail_url',
      'original_filename',
      'image_hash',
      'image_url_processed',
      'processing_status',
      'frame_removal_confidence',
      'processed_at',
      'processing_error',
      'embedding_id',
      'title',
      'artist',
      'year',
      'date_text',
      'medium',
      'classification',
      'culture',
      'origin',
      'dimensions_height',
      'dimensions_width',
      'dimensions_depth',
      'dimensions_unit',
      'description',
      'provenance',
      'credit_line',
      'rights',
      'accession_number',
      'source_url',
      'source_institution',
      'source_collection',
      'source_record_id',
      'field_sources',
      'translations',
      'dominant_colors',
      'color_palette',
      'color_extracted_at',
      'color_extraction_version',
      'custom_metadata',
      'citation',
      'uploaded_by',
      'deleted_at',
    ];

    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((field) => {
      const value = artwork[field as keyof typeof artwork];
      if (
        [
          'field_sources',
          'translations',
          'dominant_colors',
          'color_palette',
          'custom_metadata',
          'citation',
        ].includes(
          field
        ) &&
        value &&
        typeof value === 'object'
      ) {
        return JSON.stringify(value);
      }
      return value ?? null;
    });

    return {
      sql: `INSERT INTO artworks (${fields.join(', ')}) VALUES (${placeholders})`,
      params: values,
    };
  },

  update: (id: string, updates: Partial<Omit<ArtworkRow, 'id' | 'created_at' | 'updated_at'>>) => {
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (
        [
          'field_sources',
          'translations',
          'dominant_colors',
          'color_palette',
          'custom_metadata',
          'citation',
        ].includes(
          key
        ) &&
        value &&
        typeof value === 'object'
      ) {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value ?? null);
      }
    });

    return {
      sql: `UPDATE artworks SET ${fields.join(', ')} WHERE id = ?`,
      params: [...values, id],
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM artworks WHERE id = ?',
    params: [id],
  }),

  count: (galleryId: string) => ({
    sql: 'SELECT COUNT(*) as count FROM artworks WHERE org_id = ?',
    params: [galleryId],
  }),
};

/**
 * Collection queries
 */
export const collectionQueries = {
  findById: (id: string) => ({
    sql: 'SELECT * FROM collections WHERE id = ?',
    params: [id],
  }),

  findByGallery: (galleryId: string) => ({
    sql: 'SELECT * FROM collections WHERE org_id = ? ORDER BY created_at DESC',
    params: [galleryId],
  }),

  findByOrg: (orgId: string) => ({
    sql: 'SELECT * FROM collections WHERE org_id = ? ORDER BY created_at DESC',
    params: [orgId],
  }),

  create: (collection: Omit<CollectionRow, 'created_at' | 'artwork_count'>) => ({
    sql: `INSERT INTO collections (id, org_id, name, description, thumbnail_artwork_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      collection.id,
      collection.org_id,
      collection.name,
      collection.description || null,
      collection.thumbnail_artwork_id || null,
      collection.created_by,
    ],
  }),

  update: (id: string, updates: Partial<Omit<CollectionRow, 'id' | 'created_at' | 'artwork_count'>>) => {
    const fields = Object.keys(updates).map((key) => `${key} = ?`);
    const values = Object.values(updates);
    return {
      sql: `UPDATE collections SET ${fields.join(', ')} WHERE id = ?`,
      params: [...values, id],
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM collections WHERE id = ?',
    params: [id],
  }),

  addArtwork: (collectionId: string, artworkId: string, position = 0) => ({
    sql: `INSERT INTO collection_artworks (collection_id, artwork_id, position)
          VALUES (?, ?, ?)`,
    params: [collectionId, artworkId, position],
  }),

  removeArtwork: (collectionId: string, artworkId: string) => ({
    sql: `DELETE FROM collection_artworks
          WHERE collection_id = ? AND artwork_id = ?`,
    params: [collectionId, artworkId],
  }),
};

/**
 * Asset queries
 */
export const assetQueries = {
  findByArtwork: (artworkId: string) => ({
    sql: 'SELECT * FROM assets WHERE artwork_id = ? ORDER BY role, created_at DESC',
    params: [artworkId],
  }),

  findByOrg: (orgId: string, limit = 100, offset = 0) => ({
    sql: `SELECT * FROM assets
          WHERE org_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
    params: [orgId, limit, offset],
  }),

  create: (asset: Omit<AssetRow, 'created_at' | 'updated_at'>) => {
    const fields = [
      'id',
      'artwork_id',
      'org_id',
      'role',
      'storage_provider',
      'bucket',
      'object_key',
      'url',
      'mime_type',
      'width',
      'height',
      'size_bytes',
      'checksum',
      'metadata',
    ];

    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((field) => {
      const value = asset[field as keyof typeof asset];
      if (field === 'metadata' && value && typeof value === 'object') {
        return JSON.stringify(value);
      }
      return value ?? null;
    });

    return {
      sql: `INSERT INTO assets (${fields.join(', ')}) VALUES (${placeholders})`,
      params: values,
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM assets WHERE id = ?',
    params: [id],
  }),
};

/**
 * Audit log queries
 */
export const auditLogQueries = {
  create: (log: Omit<AuditLogRow, 'id' | 'created_at'>) => ({
    sql: `INSERT INTO audit_logs (
      entity_type, entity_id, action, user_id, changes, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      log.entity_type,
      log.entity_id,
      log.action,
      log.user_id || null,
      log.changes ? JSON.stringify(log.changes) : null,
      log.ip_address || null,
      log.user_agent || null,
    ],
  }),

  findByEntity: (entityType: string, entityId: string, limit = 50) => ({
    sql: `SELECT * FROM audit_logs
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    params: [entityType, entityId, limit],
  }),

  findByUser: (userId: string, limit = 50) => ({
    sql: `SELECT * FROM audit_logs
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    params: [userId, limit],
  }),
};
