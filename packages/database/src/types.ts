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

export interface OrgRow {
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

/** @deprecated Use OrgRow. */
export type GalleryRow = OrgRow;

export interface ArtworkRow {
  id: string;
  org_id: string;
  collection_id: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  original_filename: string | null;
  image_hash: string | null;
  image_url_processed: string | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  frame_removal_confidence: number | null;
  processed_at: string | null;
  processing_error: string | null;
  embedding_id: string | null;
  title: string;
  artist: string | null;
  year: number | null;
  date_text: string | null;
  medium: string | null;
  classification: string | null;
  culture: string | null;
  origin: string | null;
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: 'cm' | 'in' | 'm' | null;
  description: string | null;
  provenance: string | null;
  credit_line: string | null;
  rights: string | null;
  accession_number: string | null;
  source_url: string | null;
  source_institution: string | null;
  source_collection: string | null;
  source_record_id: string | null;
  field_sources: string; // JSON
  translations: string; // JSON
  dominant_colors: string | null; // JSON
  color_palette: string | null; // JSON
  color_extracted_at: string | null;
  color_extraction_version: string | null;
  custom_metadata: string; // JSON
  citation: string | null; // JSON
  created_at: string;
  updated_at: string;
  uploaded_by: string;
  deleted_at: string | null;
}

export interface CollectionRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  artwork_count: number;
  thumbnail_artwork_id: string | null;
  created_at: string;
  created_by: string;
}

export interface AssetRow {
  id: string;
  artwork_id: string;
  org_id: string;
  role: 'original' | 'thumb' | 'web' | 'processed' | 'mask' | 'metadata' | 'other';
  storage_provider: 'r2' | 'external';
  bucket: string | null;
  object_key: string;
  url: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  checksum: string | null;
  metadata: string; // JSON
  created_at: string;
  updated_at: string;
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
