# Artwork Management API

## Overview

The Artwork Management API provides full CRUD operations for artwork images and metadata, including R2 storage integration for scalable image hosting.

## Endpoints

### Upload Artwork

**POST** `/api/v1/artworks/upload`

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
  "translations": { // optional
    "es": {
      "title": "Título en español",
      "description": "Descripción en español"
    }
  },
  "custom_metadata": {}, // optional, any JSON
  "citation": { // optional
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
    "artwork": { /* artwork object */ },
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

### List Artworks

**GET** `/api/v1/artworks`

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
  "data": [/* array of artwork objects */],
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

**GET** `/api/v1/artworks/:id`

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

**PATCH** `/api/v1/artworks/:id`

Update artwork metadata (not the image).

**Request:**
```json
{
  "title": "Updated Title",
  "artist": "Updated Artist",
  "description": "Updated description",
  // ... any artwork fields except gallery_id
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { /* updated artwork object */ }
}
```

---

### Delete Artwork

**DELETE** `/api/v1/artworks/:id`

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

| Pattern | Example | Extracted |
|---------|---------|-----------|
| `artist_title_year.jpg` | `monet_waterlilies_1919.jpg` | artist, title, year |
| `artist - title (year).jpg` | `monet - Water Lilies (1919).jpg` | artist, title, year |
| `title_year.jpg` | `waterlilies_1919.jpg` | title, year |
| `title.jpg` | `waterlilies.jpg` | title |

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
- [ ] Color palette extraction
- [ ] EXIF metadata extraction
- [ ] Batch upload support
- [ ] Embedding generation for AI search
- [ ] Image transformations (resize, crop, filters)
- [ ] CDN integration for optimized delivery
- [ ] Authentication & authorization
