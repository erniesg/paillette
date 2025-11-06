/**
 * Database query helpers for D1
 * These provide type-safe query builders for common operations
 */

import type {
  UserRow,
  GalleryRow,
  ArtworkRow,
  CollectionRow,
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
 * Gallery queries
 */
export const galleryQueries = {
  findById: (id: string) => ({
    sql: 'SELECT * FROM galleries WHERE id = ?',
    params: [id],
  }),

  findBySlug: (slug: string) => ({
    sql: 'SELECT * FROM galleries WHERE slug = ?',
    params: [slug],
  }),

  findByOwner: (ownerId: string) => ({
    sql: 'SELECT * FROM galleries WHERE owner_id = ? ORDER BY created_at DESC',
    params: [ownerId],
  }),

  list: (limit = 50, offset = 0) => ({
    sql: 'SELECT * FROM galleries ORDER BY created_at DESC LIMIT ? OFFSET ?',
    params: [limit, offset],
  }),

  create: (
    gallery: Omit<GalleryRow, 'created_at'> & { settings?: Record<string, any> }
  ) => ({
    sql: `INSERT INTO galleries (
      id, name, slug, description, location_country, location_city,
      location_address, website, settings, api_key, api_key_hash, owner_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      gallery.id,
      gallery.name,
      gallery.slug,
      gallery.description || null,
      gallery.location_country || null,
      gallery.location_city || null,
      gallery.location_address || null,
      gallery.website || null,
      gallery.settings ? JSON.stringify(gallery.settings) : '{}',
      gallery.api_key,
      gallery.api_key_hash,
      gallery.owner_id,
    ],
  }),

  update: (
    id: string,
    updates: Partial<Omit<GalleryRow, 'id' | 'created_at' | 'owner_id'>>
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
      sql: `UPDATE galleries SET ${fields.join(', ')} WHERE id = ?`,
      params: [...values, id],
    };
  },

  delete: (id: string) => ({
    sql: 'DELETE FROM galleries WHERE id = ?',
    params: [id],
  }),
};

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
          WHERE gallery_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
    params: [galleryId, limit, offset],
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
          WHERE gallery_id = ?
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
      'gallery_id',
      'collection_id',
      'image_url',
      'thumbnail_url',
      'original_filename',
      'image_hash',
      'embedding_id',
      'title',
      'artist',
      'year',
      'medium',
      'dimensions_height',
      'dimensions_width',
      'dimensions_depth',
      'dimensions_unit',
      'description',
      'provenance',
      'translations',
      'dominant_colors',
      'color_palette',
      'custom_metadata',
      'citation',
      'uploaded_by',
    ];

    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((field) => {
      const value = artwork[field as keyof typeof artwork];
      if (
        ['translations', 'dominant_colors', 'color_palette', 'custom_metadata', 'citation'].includes(
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
        ['translations', 'dominant_colors', 'color_palette', 'custom_metadata', 'citation'].includes(
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
    sql: 'SELECT COUNT(*) as count FROM artworks WHERE gallery_id = ?',
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
    sql: 'SELECT * FROM collections WHERE gallery_id = ? ORDER BY created_at DESC',
    params: [galleryId],
  }),

  create: (collection: Omit<CollectionRow, 'created_at' | 'artwork_count'>) => ({
    sql: `INSERT INTO collections (id, gallery_id, name, description, thumbnail_artwork_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      collection.id,
      collection.gallery_id,
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
