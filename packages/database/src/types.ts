/**
 * Database row types matching the D1 schema
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'curator' | 'viewer';
  created_at: string;
  last_login_at: string | null;
}

export interface GalleryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  location_country: string | null;
  location_city: string | null;
  location_address: string | null;
  website: string | null;
  settings: string; // JSON
  api_key: string;
  api_key_hash: string;
  owner_id: string;
  created_at: string;
}

export interface ArtworkRow {
  id: string;
  gallery_id: string;
  collection_id: string | null;
  image_url: string;
  thumbnail_url: string;
  original_filename: string;
  image_hash: string;
  image_url_processed: string | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  frame_removal_confidence: number | null;
  processed_at: string | null;
  processing_error: string | null;
  embedding_id: string | null;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: 'cm' | 'in' | 'm' | null;
  description: string | null;
  provenance: string | null;
  translations: string; // JSON
  dominant_colors: string | null; // JSON
  color_palette: string | null; // JSON
  custom_metadata: string; // JSON
  citation: string | null; // JSON
  created_at: string;
  updated_at: string;
  uploaded_by: string;
}

export interface CollectionRow {
  id: string;
  gallery_id: string;
  name: string;
  description: string | null;
  artwork_count: number;
  thumbnail_artwork_id: string | null;
  created_at: string;
  created_by: string;
}

export interface AuditLogRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  user_id: string | null;
  changes: string | null; // JSON
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
