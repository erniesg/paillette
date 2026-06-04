# Artwork Management API

## Overview

The Artwork Management API provides org-scoped CRUD operations for artwork images, artwork metadata records, and collections. Mutating routes require a bearer token, personal API key, or test/dev `X-User-Id` principal.

Canonical routes use `/api/v1/orgs/:orgId`. Legacy `/api/v1/galleries/:galleryId` aliases remain mounted for existing clients.

## Endpoints

### Upload Artwork

**POST** `/api/v1/orgs/:orgId/artworks/upload`

Upload a new artwork with image and metadata.

**Request:**

- Content-Type: `multipart/form-data`
- Body:
  - `image` (File, required): Image file (JPEG, PNG, WebP, GIF, TIFF)
  - `metadata` (JSON string, required): Artwork metadata

**Metadata Schema:**

```json
{
  "gallery_id": "uuid",
  "collection_id": "uuid", // optional
  "title": "Artwork Title", // optional, auto-extracted from filename
  "artist": "Artist Name", // optional
  "year": 2024, // optional
  "medium": "Oil on canvas", // optional
  "dimensions_height": 100.5, // optional
  "dimensions_width": 80.0, // optional
  "dimensions_depth": 2.5, // optional
  "dimensions_unit": "cm", // cm | in | m
  "description": "Artwork description", // optional
  "provenance": "Provenance information", // optional
  "translations": {
    // optional
    "es": {
      "title": "Título en español",
      "description": "Descripción en español"
    }
  },
  "custom_metadata": {}, // optional, any JSON
  "citation": {
    // optional
    "format": "apa",
    "text": "Citation text"
  }
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "artwork": {
      /* artwork object */
    },
    "upload_info": {
      "size": 1234567,
      "content_type": "image/jpeg",
      "hash": "sha256hash..."
    }
  }
}
```

**Features:**

- Automatic filename parsing (e.g., `artist_title_year.jpg`)
- Duplicate detection via image hash
- Image validation (size, type, dimensions)
- Automatic thumbnail generation (planned)

---

### Upsert Artwork Record

**POST** `/api/v1/orgs/:orgId/artworks/upsert`

Create or update a metadata record. Existing records are matched in this order:

- `id` within the route org
- `source_record_id` plus optional `source_institution` within the route org
- `accession_number` within the route org

**Request:**

```json
{
  "id": "optional-client-record-id",
  "title": "Artwork Title",
  "artist": "Artist Name",
  "medium": "Ink on paper",
  "description": "Catalogue description",
  "accession_number": "ACC-001",
  "source_institution": "National Gallery Singapore",
  "source_collection": "National Collection",
  "source_record_id": "SRC-001",
  "field_sources": { "title": "ngs" },
  "custom_metadata": {}
}
```

**Response:** `200 OK` for updates, `201 Created` for creates.

---

### List Artworks

**GET** `/api/v1/orgs/:orgId/artworks`

List artworks with filtering, sorting, and pagination.

**Query Parameters:**

- `gallery_id` (uuid): Filter by gallery
- `collection_id` (uuid): Filter by collection
- `artist` (string): Filter by artist (partial match)
- `year` (number): Filter by exact year
- `year_min` (number): Filter by minimum year
- `year_max` (number): Filter by maximum year
- `medium` (string): Filter by medium (partial match)
- `search` (string): Full-text search (title, artist, description)
- `limit` (number, 1-100, default: 20): Results per page
- `offset` (number, default: 0): Pagination offset
- `sort_by` (enum, default: `created_at`): Sort field
  - `created_at`, `updated_at`, `title`, `artist`, `year`
- `sort_order` (enum, default: `desc`): Sort order
  - `asc`, `desc`

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    /* array of artwork objects */
  ],
  "pagination": {
    "total": 100,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

---

### Get Artwork

**GET** `/api/v1/orgs/:orgId/artworks/:id`

Get a single artwork by ID.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "gallery_id": "uuid",
    "collection_id": "uuid",
    "image_url": "https://images.paillette.art/...",
    "thumbnail_url": "https://images.paillette.art/..._thumb.jpg",
    "original_filename": "artwork.jpg",
    "title": "Artwork Title",
    "artist": "Artist Name",
    "year": 2024,
    "medium": "Oil on canvas",
    "dimensions": {
      "height": 100.5,
      "width": 80.0,
      "depth": 2.5,
      "unit": "cm"
    },
    "description": "Artwork description",
    "provenance": "Provenance information",
    "translations": {},
    "colors": {
      "dominant": ["#FF0000", "#00FF00"],
      "palette": ["#FF0000", "#00FF00", "#0000FF"]
    },
    "custom_metadata": {},
    "citation": {
      "format": "apa",
      "text": "Citation text"
    },
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "uploaded_by": "user-id"
  }
}
```

---

### Update Artwork

**PATCH** `/api/v1/orgs/:orgId/artworks/:id`

Update artwork metadata (not the image).

**Request:**

```json
{
  "title": "Updated Title",
  "artist": "Updated Artist",
  "description": "Updated description"
  // ... any artwork fields except gallery_id
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    /* updated artwork object */
  }
}
```

---

### Delete Artwork

**DELETE** `/api/v1/orgs/:orgId/artworks/:id`

Delete an artwork and its associated images from R2 storage.

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Artwork deleted successfully"
}
```

**Note:** This also deletes:

- Original image from R2
- Thumbnail image from R2
- Database record
- Collection associations

---

## Collections

### List Collections

**GET** `/api/v1/orgs/:orgId/collections`

### Create Collection

**POST** `/api/v1/orgs/:orgId/collections`

```json
{
  "id": "optional-stable-id",
  "name": "National Collection",
  "description": "Collection description",
  "thumbnail_artwork_id": "optional-artwork-id"
}
```

### Upsert Collection

**POST** `/api/v1/orgs/:orgId/collections/upsert`

Uses `id` when provided to update an existing collection or create it if missing.

### Get, Update, Delete Collection

- **GET** `/api/v1/orgs/:orgId/collections/:collectionId`
- **PATCH** `/api/v1/orgs/:orgId/collections/:collectionId`
- **DELETE** `/api/v1/orgs/:orgId/collections/:collectionId`

### Collection Membership

- **POST** `/api/v1/orgs/:orgId/collections/:collectionId/artworks`
- **DELETE** `/api/v1/orgs/:orgId/collections/:collectionId/artworks/:artworkId`

The add route body is:

```json
{
  "artwork_id": "artwork-id",
  "position": 0
}
```

---

## MCP Parity

The same source-scoped operations are exposed through the MCP endpoint at
`/api/v1/mcp` using Streamable HTTP JSON-RPC.

MCP clients can call:

- `list_orgs`
- `search_artworks`
- `lookup_artwork`
- `colour_search`
- `list_collections`
- `upsert_collection`
- `upsert_artwork_record`
- `add_artwork_to_collection`
- `remove_artwork_from_collection`
- `translate_text`
- `extract_images`

Use `collection` or `orgId` to target a source such as `ngs`. API keys can call
all exposed tools; OAuth tokens need `mcp:all` or the relevant grouped scopes
such as `mcp:read`, `mcp:write`, `artworks:read`, `artworks:write`,
`collections:read`, `collections:write`, `translations:create`, or
`extract:create`.

OAuth protected resource metadata is available at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/api/v1/mcp`

---

## Image Requirements

### Supported Formats

- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- WebP (`.webp`)
- GIF (`.gif`)
- TIFF (`.tif`, `.tiff`)

### Size Limits

- **Max file size:** 50 MB
- **Max dimensions:** 10,000 × 10,000 px
- **Min dimensions:** 100 × 100 px

### Filename Parsing

The API can automatically extract metadata from filenames:

| Pattern                     | Example                           | Extracted           |
| --------------------------- | --------------------------------- | ------------------- |
| `artist_title_year.jpg`     | `monet_waterlilies_1919.jpg`      | artist, title, year |
| `artist - title (year).jpg` | `monet - Water Lilies (1919).jpg` | artist, title, year |
| `title_year.jpg`            | `waterlilies_1919.jpg`            | title, year         |
| `title.jpg`                 | `waterlilies.jpg`                 | title               |

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": [] // Optional, for validation errors
  }
}
```

### Common Error Codes

- `MISSING_FILE`: Image file not provided
- `INVALID_METADATA`: Metadata validation failed
- `VALIDATION_ERROR`: Request validation failed
- `INVALID_IMAGE`: Image validation failed (size, type, dimensions)
- `DUPLICATE_IMAGE`: Image hash already exists in gallery
- `NOT_FOUND`: Artwork not found
- `UPLOAD_FAILED`: Upload to R2 failed
- `QUERY_FAILED`: Database query failed
- `UPDATE_FAILED`: Update operation failed
- `DELETE_FAILED`: Delete operation failed

---

## Future Enhancements

- [ ] Thumbnail generation via Cloudflare Images
- [ ] EXIF metadata extraction
- [ ] Batch upload support
- [ ] Image transformations (resize, crop, filters)
- [ ] CDN integration for optimized delivery
