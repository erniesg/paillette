# Paillette Sprint Implementation Plan
## Phased TDD Parallel Workstreams

**Date:** November 11, 2025
**Status:** Ready for Implementation
**Auth Team:** Separate team handles JWT authentication (mocked in our sprints)

---

## Design System & Communication Strategy

### Frontend-Backend API Contract

**Base URL:** `https://api.paillette.dev/v1`

**Response Format (Standardized):**
```typescript
// Success
{
  success: true,
  data: T,
  metadata?: {
    page?: number,
    pageSize?: number,
    total?: number,
    took?: number  // ms
  }
}

// Error
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: any
  }
}
```

**Authentication (Mocked for now):**
```typescript
// All requests include:
headers: {
  'Authorization': 'Bearer <mock-token>',
  'Content-Type': 'application/json'
}

// Mock user context:
{
  id: 'mock-user-123',
  role: 'admin',
  galleryIds: ['test-gallery-1']
}
```

### Design System (Consistent UI)

**Colors:**
```typescript
// apps/web/app/lib/design-tokens.ts
export const colors = {
  primary: {
    50: '#f5f3ff',
    500: '#8b5cf6',  // Purple (existing brand)
    900: '#4c1d95'
  },
  success: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
  neutral: {
    50: '#fafafa',
    100: '#f5f5f5',
    500: '#737373',
    900: '#171717'
  }
}
```

**Components (Radix UI + Tailwind):**
- Button: `<Button variant="primary|secondary|ghost" size="sm|md|lg" />`
- Input: `<Input type="text|file|color" error={string} />`
- Toast: `<Toast type="success|error|info" />`
- Progress: `<Progress value={number} max={number} />`
- Dialog: `<Dialog />` (from Radix)

**Typography:**
- Font: Inter (existing)
- Headings: `text-2xl font-bold` → `text-lg font-semibold`
- Body: `text-base text-neutral-700`

---

## SPRINT 1: CSV Metadata + Bulk Artwork Upload (Week 1)

**Duration:** 5 days
**Team Size:** 3 parallel workstreams
**Goal:** Enable bulk onboarding of gallery artworks via CSV + images

### 1.1 Backend Workstream - CSV Processing API

**Owner:** Backend Agent
**Duration:** Days 1-3
**Test Coverage Target:** 95%+

#### 1.1.1 Setup CSV Parser Package
- [ ] Install dependencies: `papaparse`, `zod`
- [ ] Create `packages/metadata/` package
- [ ] Add to monorepo workspace
- [ ] Setup Vitest for package

**Files:**
```
packages/metadata/
├── src/
│   ├── csv-parser.ts
│   ├── csv-validator.ts
│   ├── batch-processor.ts
│   └── types.ts
├── tests/
│   ├── csv-parser.test.ts
│   └── batch-processor.test.ts
└── package.json
```

#### 1.1.2 Write Tests for CSV Parser (TDD - RED)
- [ ] Test: Parse valid CSV with all columns
- [ ] Test: Parse CSV with optional columns missing
- [ ] Test: Reject invalid column types (year as string)
- [ ] Test: Detect duplicate artwork IDs
- [ ] Test: Handle UTF-8 special characters (Chinese, Tamil)
- [ ] Test: Validate required columns (title, artist, image_filename)
- [ ] Test: Reject rows exceeding schema limits

**Test File:** `packages/metadata/tests/csv-parser.test.ts`

```typescript
describe('CSVParser', () => {
  it('should parse valid CSV with all columns', async () => {
    const csv = `
      artwork_id,title,artist,year,medium,description
      art-001,Starry Night,Vincent van Gogh,1889,Oil on canvas,Famous painting
      art-002,Mona Lisa,Leonardo da Vinci,1503,Oil on poplar,Iconic portrait
    `.trim();

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].title).toBe('Starry Night');
    expect(result.rows[0].year).toBe(1889);
  });

  it('should validate column types', async () => {
    const csv = `artwork_id,year\nart-001,not-a-number`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].column).toBe('year');
    expect(result.errors[0].message).toContain('must be a number');
  });

  // ... 10 more tests
});
```

#### 1.1.3 Implement CSV Parser (TDD - GREEN)
- [ ] Implement CSV parsing with papaparse
- [ ] Add Zod schema validation
- [ ] Handle encoding (UTF-8, UTF-16)
- [ ] Return parsed rows + validation errors
- [ ] Make all tests pass

**Implementation:** `packages/metadata/src/csv-parser.ts`

```typescript
import Papa from 'papaparse';
import { z } from 'zod';

const ArtworkRowSchema = z.object({
  artwork_id: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(500),
  artist: z.string().max(255).optional(),
  year: z.coerce.number().int().min(1000).max(2100).optional(),
  medium: z.string().max(255).optional(),
  dimensions_height: z.coerce.number().positive().optional(),
  dimensions_width: z.coerce.number().positive().optional(),
  dimensions_unit: z.enum(['cm', 'in', 'm']).optional(),
  description: z.string().max(5000).optional(),
  image_filename: z.string().min(1).optional(),
});

export type ArtworkRow = z.infer<typeof ArtworkRowSchema>;

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

export class CSVParser {
  static async parse(csvContent: string): Promise<CSVParseResult> {
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
    });

    const rows: ArtworkRow[] = [];
    const errors: CSVParseResult['errors'] = [];

    for (let i = 0; i < parsed.data.length; i++) {
      const rowData = parsed.data[i];
      const rowNumber = i + 2; // +2 for header row and 0-index

      try {
        const validated = ArtworkRowSchema.parse(rowData);
        rows.push(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
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
}
```

#### 1.1.4 Write Tests for Batch Processor (TDD - RED)
- [ ] Test: Update existing artworks by ID
- [ ] Test: Create new artworks if ID not found
- [ ] Test: Handle transaction rollback on error
- [ ] Test: Process in batches of 100
- [ ] Test: Return detailed success/failure report

#### 1.1.5 Implement Batch Processor (TDD - GREEN)
- [ ] Create batch update logic (D1 transactions)
- [ ] Match CSV rows to existing artworks
- [ ] Insert new artworks if needed
- [ ] Handle errors gracefully

**Implementation:** `packages/metadata/src/batch-processor.ts`

```typescript
export class BatchMetadataProcessor {
  constructor(private db: D1Database) {}

  async processMetadata(
    galleryId: string,
    rows: ArtworkRow[],
    userId: string
  ): Promise<BatchProcessResult> {
    const results: BatchProcessResult = {
      created: [],
      updated: [],
      failed: [],
      stats: { total: rows.length, created: 0, updated: 0, failed: 0 },
    };

    // Process in batches of 100 for D1 performance
    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      await this.db.batch(
        batch.map((row) => {
          // Check if artwork exists
          const existing = this.db.prepare(
            'SELECT id FROM artworks WHERE id = ? OR (title = ? AND artist = ? AND gallery_id = ?)'
          ).bind(row.artwork_id, row.title, row.artist, galleryId);

          // Update or insert
          // ... (implementation)
        })
      );
    }

    return results;
  }
}
```

#### 1.1.6 Create API Endpoints
- [ ] `POST /api/v1/galleries/:id/metadata/upload` - CSV upload
- [ ] `POST /api/v1/galleries/:id/artworks/batch` - Bulk image upload
- [ ] `GET /api/v1/galleries/:id/upload-jobs/:jobId` - Check job status

**Files:**
```
apps/api/src/routes/
├── metadata.ts        # CSV upload endpoint
└── bulk-upload.ts     # Bulk artwork upload
```

#### 1.1.7 Write Integration Tests for API
- [ ] Test: Upload CSV returns validation results
- [ ] Test: Upload CSV with 1000 rows completes in <10s
- [ ] Test: Invalid CSV returns 400 with error details
- [ ] Test: Batch upload images to R2
- [ ] Test: Queue embedding generation jobs

**Test File:** `apps/api/src/routes/metadata.test.ts`

```typescript
describe('POST /api/v1/galleries/:id/metadata/upload', () => {
  it('should upload and process valid CSV', async () => {
    const csv = `title,artist,year\nTest Art,Test Artist,2024`;
    const formData = new FormData();
    formData.append('file', new Blob([csv]), 'metadata.csv');

    const res = await app.request(
      '/api/v1/galleries/test-gallery-1/metadata/upload',
      {
        method: 'POST',
        body: formData,
        headers: { Authorization: 'Bearer mock-token' },
      }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.stats.validRows).toBe(1);
  });

  // ... 8 more tests
});
```

#### 1.1.8 Implement API Endpoints (GREEN)
- [ ] Implement CSV upload with file parsing
- [ ] Implement bulk image upload to R2
- [ ] Create upload job tracking in D1
- [ ] Return detailed processing results

**Implementation:** `apps/api/src/routes/metadata.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { CSVParser } from '@paillette/metadata';
import { BatchMetadataProcessor } from '@paillette/metadata';

const metadata = new Hono<{ Bindings: Env }>();

metadata.post(
  '/galleries/:galleryId/metadata/upload',
  async (c) => {
    const { galleryId } = c.req.param();
    const user = c.get('user');

    // Get uploaded file
    const body = await c.req.parseBody();
    const file = body['file'] as File;

    if (!file) {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }

    // Parse CSV
    const csvContent = await file.text();
    const parseResult = await CSVParser.parse(csvContent);

    if (!parseResult.success) {
      return c.json({
        success: false,
        error: 'CSV validation failed',
        details: parseResult.errors,
      }, 400);
    }

    // Process metadata updates
    const processor = new BatchMetadataProcessor(c.env.DB);
    const result = await processor.processMetadata(
      galleryId,
      parseResult.rows,
      user.id
    );

    return c.json({
      success: true,
      data: result,
      metadata: {
        took: Date.now() - start,
      },
    });
  }
);

export default metadata;
```

**Checklist Summary - Backend:**
- [ ] 1.1.1 Setup CSV parser package
- [ ] 1.1.2 Write CSV parser tests (RED)
- [ ] 1.1.3 Implement CSV parser (GREEN)
- [ ] 1.1.4 Write batch processor tests (RED)
- [ ] 1.1.5 Implement batch processor (GREEN)
- [ ] 1.1.6 Create API endpoints
- [ ] 1.1.7 Write API integration tests (RED)
- [ ] 1.1.8 Implement API endpoints (GREEN)

---

### 1.2 Frontend Workstream - Upload UI

**Owner:** Frontend Agent
**Duration:** Days 1-4
**Test Coverage Target:** 85%+

#### 1.2.1 Create Upload Components
- [ ] `<CSVUploader />` - Drag & drop CSV files
- [ ] `<ImageBulkUploader />` - Multi-file image upload
- [ ] `<UploadProgress />` - Real-time progress bar
- [ ] `<UploadReport />` - Success/error summary

**Files:**
```
apps/web/app/components/upload/
├── csv-uploader.tsx
├── image-bulk-uploader.tsx
├── upload-progress.tsx
├── upload-report.tsx
└── upload-manager.tsx
```

#### 1.2.2 Write Component Tests (TDD - RED)
- [ ] Test: CSV uploader accepts .csv files only
- [ ] Test: Image uploader accepts .jpg, .png, .webp
- [ ] Test: Progress bar updates correctly
- [ ] Test: Error report shows validation errors
- [ ] Test: Success report shows summary stats

**Test File:** `apps/web/app/components/upload/csv-uploader.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CSVUploader } from './csv-uploader';

describe('CSVUploader', () => {
  it('should accept CSV files via drag and drop', async () => {
    const onUpload = vi.fn();
    render(<CSVUploader onUpload={onUpload} />);

    const csvContent = 'title,artist\nTest,Artist';
    const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

    const dropzone = screen.getByText(/drag.*drop/i);
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(file);
    });
  });

  it('should reject non-CSV files', async () => {
    render(<CSVUploader onUpload={vi.fn()} />);

    const file = new File(['image'], 'test.jpg', { type: 'image/jpeg' });
    const dropzone = screen.getByText(/drag.*drop/i);
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(await screen.findByText(/only csv files/i)).toBeInTheDocument();
  });

  // ... 6 more tests
});
```

#### 1.2.3 Implement Upload Components (TDD - GREEN)
- [ ] Implement CSV file dropzone (react-dropzone)
- [ ] Implement image multi-upload
- [ ] Add file validation
- [ ] Show preview before upload

**Implementation:** `apps/web/app/components/upload/csv-uploader.tsx`

```typescript
import { useDropzone } from 'react-dropzone';
import { useState } from 'react';

interface CSVUploaderProps {
  onUpload: (file: File) => void;
}

export function CSVUploader({ onUpload }: CSVUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    maxFiles: 1,
    onDrop: (acceptedFiles, rejectedFiles) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        setError('Only CSV files are accepted');
        return;
      }

      if (acceptedFiles.length > 0) {
        onUpload(acceptedFiles[0]);
      }
    },
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
          transition-colors
          ${isDragActive
            ? 'border-primary-500 bg-primary-50'
            : 'border-neutral-300 hover:border-neutral-400'
          }
        `}
      >
        <input {...getInputProps()} />

        <svg className="mx-auto h-12 w-12 text-neutral-400" /* ... */ />

        {isDragActive ? (
          <p className="mt-2 text-sm text-primary-600">Drop CSV file here</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-600">
              Drag and drop CSV file, or click to select
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              CSV format: title, artist, year, medium, description
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-2 text-sm text-error">{error}</div>
      )}
    </div>
  );
}
```

#### 1.2.4 Create API Integration Layer
- [ ] Setup TanStack Query mutations
- [ ] Create upload hooks: `useCSVUpload`, `useBulkImageUpload`
- [ ] Handle progress tracking
- [ ] Handle errors and retries

**Files:**
```
apps/web/app/lib/api/
├── upload.ts          # Upload API client
└── hooks.ts           # React Query hooks
```

**Implementation:** `apps/web/app/lib/api/hooks.ts`

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import { uploadCSV, uploadImages, getUploadJobStatus } from './upload';

export function useCSVUpload(galleryId: string) {
  return useMutation({
    mutationFn: (file: File) => uploadCSV(galleryId, file),
    onSuccess: (data) => {
      // Show success toast
      console.log('CSV uploaded:', data);
    },
    onError: (error) => {
      // Show error toast
      console.error('CSV upload failed:', error);
    },
  });
}

export function useBulkImageUpload(galleryId: string) {
  return useMutation({
    mutationFn: (files: File[]) => uploadImages(galleryId, files),
    onSuccess: (data) => {
      console.log('Images uploaded:', data);
    },
  });
}

export function useUploadJobStatus(jobId: string) {
  return useQuery({
    queryKey: ['upload-job', jobId],
    queryFn: () => getUploadJobStatus(jobId),
    refetchInterval: 2000, // Poll every 2 seconds
    enabled: !!jobId,
  });
}
```

#### 1.2.5 Create Upload Manager Page
- [ ] Create route: `/galleries/:id/upload`
- [ ] Multi-step wizard: Upload CSV → Upload Images → Review → Confirm
- [ ] Real-time progress tracking
- [ ] Error handling with retry

**File:** `apps/web/app/routes/galleries.$id.upload.tsx`

```typescript
import { useState } from 'react';
import { useParams } from '@remix-run/react';
import { CSVUploader } from '~/components/upload/csv-uploader';
import { ImageBulkUploader } from '~/components/upload/image-bulk-uploader';
import { UploadProgress } from '~/components/upload/upload-progress';
import { useCSVUpload, useBulkImageUpload } from '~/lib/api/hooks';

export default function GalleryUploadPage() {
  const { id: galleryId } = useParams();
  const [step, setStep] = useState<'csv' | 'images' | 'processing' | 'done'>('csv');
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);

  const csvUpload = useCSVUpload(galleryId!);
  const imageUpload = useBulkImageUpload(galleryId!);

  const handleCSVUpload = async (file: File) => {
    const result = await csvUpload.mutateAsync(file);
    if (result.success) {
      setStep('images');
    }
  };

  const handleImagesUpload = async (files: File[]) => {
    const result = await imageUpload.mutateAsync(files);
    if (result.success) {
      setUploadJobId(result.data.jobId);
      setStep('processing');
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Bulk Upload Artworks</h1>

      {/* Step indicator */}
      <div className="flex items-center justify-between mb-8">
        <Step number={1} label="Upload CSV" active={step === 'csv'} />
        <Step number={2} label="Upload Images" active={step === 'images'} />
        <Step number={3} label="Processing" active={step === 'processing'} />
      </div>

      {/* Content */}
      {step === 'csv' && (
        <CSVUploader onUpload={handleCSVUpload} />
      )}

      {step === 'images' && (
        <ImageBulkUploader onUpload={handleImagesUpload} />
      )}

      {step === 'processing' && uploadJobId && (
        <UploadProgress jobId={uploadJobId} onComplete={() => setStep('done')} />
      )}

      {step === 'done' && (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-success mb-4">Upload Complete!</h2>
          <a href={`/galleries/${galleryId}`} className="text-primary-500">
            View Gallery →
          </a>
        </div>
      )}
    </div>
  );
}
```

#### 1.2.6 Write E2E Tests
- [ ] Test: Complete upload flow (CSV → Images → Processing → Success)
- [ ] Test: Error handling (invalid CSV)
- [ ] Test: Cancel upload mid-process
- [ ] Test: Retry failed uploads

**Test File:** `apps/web/tests/e2e/bulk-upload.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Bulk Upload Flow', () => {
  test('should complete full upload workflow', async ({ page }) => {
    await page.goto('/galleries/test-gallery-1/upload');

    // Step 1: Upload CSV
    await page.setInputFiles('input[type="file"]', 'fixtures/artworks.csv');
    await expect(page.locator('text=Upload CSV')).toBeVisible();
    await page.click('button:has-text("Next")');

    // Step 2: Upload Images
    await page.setInputFiles(
      'input[type="file"][accept*="image"]',
      ['fixtures/art1.jpg', 'fixtures/art2.jpg']
    );
    await page.click('button:has-text("Upload")');

    // Step 3: Wait for processing
    await expect(page.locator('text=Processing')).toBeVisible();
    await expect(page.locator('text=Upload Complete')).toBeVisible({ timeout: 30000 });

    // Verify gallery has new artworks
    await page.goto('/galleries/test-gallery-1');
    await expect(page.locator('.artwork-card')).toHaveCount(2);
  });
});
```

**Checklist Summary - Frontend:**
- [ ] 1.2.1 Create upload components
- [ ] 1.2.2 Write component tests (RED)
- [ ] 1.2.3 Implement components (GREEN)
- [ ] 1.2.4 Create API integration layer
- [ ] 1.2.5 Create upload manager page
- [ ] 1.2.6 Write E2E tests

---

### 1.3 Integration & Testing Workstream

**Owner:** Testing Agent
**Duration:** Days 2-5
**Runs in parallel with 1.1 and 1.2**

#### 1.3.1 Setup Mock Auth Middleware
- [ ] Create mock auth middleware for development
- [ ] Environment-based auth switching
- [ ] Document auth contract for real implementation

**File:** `apps/api/src/middleware/auth.mock.ts`

```typescript
import type { MiddlewareHandler } from 'hono';

export const mockAuth = (): MiddlewareHandler => {
  return async (c, next) => {
    // Mock user context
    c.set('user', {
      id: 'mock-user-123',
      email: 'dev@paillette.dev',
      role: 'admin',
      galleryIds: ['test-gallery-1', 'test-gallery-2'],
    });

    await next();
  };
};

// In index.ts:
// const authMiddleware = env.ENVIRONMENT === 'local' ? mockAuth() : realJWTAuth();
```

#### 1.3.2 Create Integration Test Suite
- [ ] Test: CSV upload → Database update → Verify in DB
- [ ] Test: Image upload → R2 storage → Verify URL works
- [ ] Test: Concurrent uploads (stress test)
- [ ] Test: Large CSV (10,000 rows)

#### 1.3.3 Create Test Fixtures
- [ ] Sample CSV files (valid, invalid, edge cases)
- [ ] Sample artwork images (various formats)
- [ ] Mock API responses

**Files:**
```
apps/api/tests/fixtures/
├── valid-artworks.csv
├── invalid-artworks.csv
├── large-dataset-1000.csv
└── images/
    ├── test-artwork-1.jpg
    └── test-artwork-2.png
```

#### 1.3.4 Performance Testing
- [ ] Test: 1000-row CSV processes in < 10s
- [ ] Test: 100 concurrent image uploads
- [ ] Test: Memory usage stays under 100MB

#### 1.3.5 Documentation
- [ ] API documentation (OpenAPI spec)
- [ ] CSV format guide for users
- [ ] Troubleshooting guide

**Checklist Summary - Integration:**
- [ ] 1.3.1 Setup mock auth middleware
- [ ] 1.3.2 Create integration test suite
- [ ] 1.3.3 Create test fixtures
- [ ] 1.3.4 Performance testing
- [ ] 1.3.5 Documentation

---

## SPRINT 2: Color Extraction & Search (Week 2)

**Duration:** 5 days
**Team Size:** 2 parallel workstreams

### 2.1 Backend Workstream - Color Extraction Service

**Owner:** Color Extraction Agent
**Research Phase:** Days 1-2
**Implementation:** Days 2-5

#### 2.1.1 Research & Setup (Days 1-2)
- [ ] Research: Test quantize.js vs k-means performance
- [ ] Research: Validate color similarity algorithms (DeltaE 2000)
- [ ] Decide: MMCQ or K-means (recommendation: MMCQ for speed)
- [ ] Install: `colorjs.io` for DeltaE calculations
- [ ] Setup: `packages/color-extraction/` package

#### 2.1.2 Write Tests for Color Extraction (TDD - RED)
- [ ] Test: Extract 5 dominant colors from image
- [ ] Test: Colors returned with percentages summing to ~100%
- [ ] Test: Handle grayscale images
- [ ] Test: Handle nearly monochrome images
- [ ] Test: Process 200x200px image in < 200ms

**Test File:** `packages/color-extraction/tests/extractor.test.ts`

```typescript
describe('ColorExtractor', () => {
  it('should extract 5 dominant colors from artwork', async () => {
    const imageBuffer = await readFile('fixtures/starry-night.jpg');
    const colors = await ColorExtractor.extract(imageBuffer, 5);

    expect(colors).toHaveLength(5);
    expect(colors[0]).toHaveProperty('color'); // hex
    expect(colors[0]).toHaveProperty('percentage');
    expect(colors[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);

    const totalPercentage = colors.reduce((sum, c) => sum + c.percentage, 0);
    expect(totalPercentage).toBeGreaterThan(95);
    expect(totalPercentage).toBeLessThan(105);
  });

  // ... 8 more tests
});
```

#### 2.1.3 Implement Color Extraction (GREEN)
- [ ] Implement MMCQ algorithm (quantize.js)
- [ ] Integrate with Cloudflare Images API for resizing
- [ ] Add color palette generation
- [ ] Optimize for edge performance

**Implementation:** `packages/color-extraction/src/extractor.ts`

#### 2.1.4 Write Tests for Color Search (TDD - RED)
- [ ] Test: Search by single color returns similar artworks
- [ ] Test: Search by multiple colors (AND logic)
- [ ] Test: Search by multiple colors (OR logic)
- [ ] Test: Threshold filtering works correctly
- [ ] Test: Results sorted by color distance

#### 2.1.5 Implement Color Search API
- [ ] `POST /api/v1/galleries/:id/search/color`
- [ ] Calculate color similarity using DeltaE 2000
- [ ] Support multiple search colors
- [ ] Add threshold parameter
- [ ] Return sorted results

**Implementation:** `apps/api/src/routes/color-search.ts`

#### 2.1.6 Queue Integration
- [ ] Enqueue color extraction on artwork upload
- [ ] Create queue consumer for color processing
- [ ] Update artwork record with color palette
- [ ] Add retry logic for failures

#### 2.1.7 Database Migration
- [ ] Add `dominant_colors` TEXT column to artworks
- [ ] Add `color_palette` TEXT column to artworks
- [ ] Create index on `gallery_id` + `dominant_colors`
- [ ] Migrate existing artworks (backfill job)

**Migration File:** `packages/database/migrations/003_add_color_columns.sql`

```sql
-- Add color columns to artworks table
ALTER TABLE artworks ADD COLUMN dominant_colors TEXT;
ALTER TABLE artworks ADD COLUMN color_palette TEXT;

-- Create index for color search
CREATE INDEX idx_artworks_gallery_colors
ON artworks(gallery_id, dominant_colors)
WHERE dominant_colors IS NOT NULL;
```

**Checklist Summary - Color Backend:**
- [ ] 2.1.1 Research & setup
- [ ] 2.1.2 Write color extraction tests (RED)
- [ ] 2.1.3 Implement color extraction (GREEN)
- [ ] 2.1.4 Write color search tests (RED)
- [ ] 2.1.5 Implement color search API (GREEN)
- [ ] 2.1.6 Queue integration
- [ ] 2.1.7 Database migration

---

### 2.2 Frontend Workstream - Color Search UI

**Owner:** Frontend Agent
**Duration:** Days 2-5

#### 2.2.1 Create Color Picker Component
- [ ] Install `react-color` or use native `<input type="color">`
- [ ] Create `<ColorPicker />` component
- [ ] Support multiple color selection
- [ ] Show selected colors as chips

**File:** `apps/web/app/components/search/color-picker.tsx`

#### 2.2.2 Create Color Search Interface
- [ ] Add color search tab to search page
- [ ] Show color picker UI
- [ ] Add match mode toggle (any/all colors)
- [ ] Add threshold slider (0-30)
- [ ] Display results in grid

**File:** `apps/web/app/routes/galleries.$id.search.tsx`

```typescript
// Add color search mode
export default function SearchPage() {
  const [searchMode, setSearchMode] = useState<'text' | 'image' | 'color'>('text');
  const [selectedColors, setSelectedColors] = useState<string[]>([]);

  return (
    <div>
      {/* Mode selector */}
      <Tabs value={searchMode} onValueChange={setSearchMode}>
        <TabsList>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="image">Image</TabsTrigger>
          <TabsTrigger value="color">Color</TabsTrigger>
        </TabsList>

        <TabsContent value="color">
          <ColorSearchPanel
            colors={selectedColors}
            onColorsChange={setSelectedColors}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

#### 2.2.3 Display Color Palettes on Artworks
- [ ] Show color palette on artwork cards
- [ ] Add color dots to grid view
- [ ] Click color dot → search by that color
- [ ] Hover shows percentage

**Component:** `<ArtworkColorPalette />`

```typescript
export function ArtworkColorPalette({ colors }: { colors: ColorPaletteItem[] }) {
  return (
    <div className="flex gap-1 mt-2">
      {colors.map((color, i) => (
        <button
          key={i}
          className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
          style={{ backgroundColor: color.color }}
          onClick={() => searchByColor(color.color)}
          title={`${color.color} (${color.percentage.toFixed(1)}%)`}
        />
      ))}
    </div>
  );
}
```

#### 2.2.4 Write Component Tests
- [ ] Test: Color picker selects colors
- [ ] Test: Color search submits correctly
- [ ] Test: Results display with color matches highlighted
- [ ] Test: Click color dot triggers search

#### 2.2.5 E2E Test
- [ ] Test: Search by color returns relevant artworks
- [ ] Test: Multi-color search works
- [ ] Test: Threshold adjustment changes results

**Checklist Summary - Color Frontend:**
- [ ] 2.2.1 Create color picker component
- [ ] 2.2.2 Create color search interface
- [ ] 2.2.3 Display color palettes on artworks
- [ ] 2.2.4 Write component tests
- [ ] 2.2.5 E2E test

---

## SPRINT 3: Frame Removal (Week 3)

**Duration:** 5 days
**Research Required:** Yes (Days 1-2)

### 3.1 Research & Architecture (Days 1-2)

**Owner:** Frame Removal Research Agent

#### 3.1.1 Research Phase
- [ ] Test OpenCV edge detection on sample artworks
- [ ] Test Replicate SAM API with 10 sample images
- [ ] Compare success rates (OpenCV vs SAM)
- [ ] Measure processing times
- [ ] Calculate cost projections
- [ ] **Decision:** Choose primary + fallback method

**Deliverable:** Research report with recommendation

#### 3.1.2 Architecture Design
- [ ] Design: Hybrid approach (OpenCV primary, SAM fallback)
- [ ] Design: Confidence scoring system
- [ ] Design: Manual review queue for failures
- [ ] Design: Before/after preview UI flow

---

### 3.2 Backend Implementation (Days 3-5)

**Owner:** Frame Removal Backend Agent

#### 3.2.1 Implement OpenCV Detection
- [ ] Install: OpenCV-compatible library for Workers (or use external service)
- [ ] Implement: Edge detection algorithm
- [ ] Implement: Rectangle detection
- [ ] Implement: Perspective transform
- [ ] Return: Cropped image + confidence score

**Note:** OpenCV doesn't run in Cloudflare Workers directly. Options:
1. Use external Python service (Replicate/Modal/etc.)
2. Use WebAssembly OpenCV build
3. Skip OpenCV, use SAM exclusively

**Recommendation:** Use Replicate for both OpenCV + SAM (simpler architecture)

#### 3.2.2 Implement SAM Integration
- [ ] Install: Replicate SDK
- [ ] Implement: SAM API calls with center prompt
- [ ] Implement: Mask to bounding box conversion
- [ ] Implement: Image cropping
- [ ] Add: Cost tracking

**File:** `packages/image-processing/src/frame-remover.ts`

```typescript
import Replicate from 'replicate';

export class FrameRemover {
  constructor(private replicateToken: string) {}

  async removeFrame(imageUrl: string): Promise<FrameRemovalResult> {
    const replicate = new Replicate({ auth: this.replicateToken });

    // Strategy 1: SAM with center prompt (assume artwork is centered)
    const imageSize = await getImageDimensions(imageUrl);
    const centerPoint = [imageSize.width / 2, imageSize.height / 2];

    const output = await replicate.run('meta/sam-2', {
      input: {
        image: imageUrl,
        point_coords: [centerPoint],
        point_labels: [1], // 1 = foreground (artwork)
      },
    });

    // Extract bounding box from mask
    const bbox = this.extractBoundingBox(output.mask);

    // Crop image using Cloudflare Images
    const croppedUrl = `${imageUrl}?crop=${bbox.x},${bbox.y},${bbox.width},${bbox.height}`;

    return {
      originalUrl: imageUrl,
      croppedUrl,
      confidence: this.calculateConfidence(bbox, imageSize),
      method: 'sam',
    };
  }

  private calculateConfidence(bbox: BBox, imageSize: ImageSize): number {
    // Calculate confidence based on:
    // - Bbox covers 20-90% of image (reasonable crop)
    // - Bbox is roughly centered
    // - Bbox has reasonable aspect ratio
    // Returns 0-1
  }
}
```

#### 3.2.3 Queue Consumer
- [ ] Create queue: `frame-removal-queue`
- [ ] Implement consumer: Process frame removal jobs
- [ ] Update artwork with cropped image
- [ ] Store original image as `original_image_url`
- [ ] Flag low-confidence results for review

#### 3.2.4 API Endpoints
- [ ] `POST /api/v1/artworks/:id/remove-frame` - Trigger frame removal
- [ ] `GET /api/v1/artworks/:id/frame-removal-status` - Check status
- [ ] `POST /api/v1/artworks/:id/accept-crop` - Accept cropped version
- [ ] `POST /api/v1/artworks/:id/reject-crop` - Reject and keep original

---

### 3.3 Frontend Implementation (Days 3-5)

**Owner:** Frame Removal Frontend Agent

#### 3.3.1 Before/After Preview Component
- [ ] Install: `react-compare-slider` (or similar)
- [ ] Create: `<FrameRemovalPreview />` component
- [ ] Show: Original vs cropped side-by-side
- [ ] Add: Accept / Reject / Manual Crop buttons

**Component:** `apps/web/app/components/frame-removal-preview.tsx`

```typescript
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';

export function FrameRemovalPreview({ artwork }: { artwork: Artwork }) {
  const acceptCrop = useAcceptCrop(artwork.id);
  const rejectCrop = useRejectCrop(artwork.id);

  return (
    <Dialog>
      <DialogContent className="max-w-4xl">
        <h2>Frame Removal Preview</h2>

        <ReactCompareSlider
          itemOne={<ReactCompareSliderImage src={artwork.original_image_url} alt="Original" />}
          itemTwo={<ReactCompareSliderImage src={artwork.image_url} alt="Cropped" />}
        />

        <div className="flex gap-4 mt-4">
          <Button variant="primary" onClick={() => acceptCrop.mutate()}>
            Accept Crop
          </Button>
          <Button variant="secondary" onClick={() => rejectCrop.mutate()}>
            Use Original
          </Button>
          <Button variant="ghost" onClick={() => openManualCropEditor()}>
            Manual Crop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### 3.3.2 Bulk Frame Removal UI
- [ ] Add: "Remove Frames" button on gallery page
- [ ] Show: Progress for bulk processing
- [ ] Display: Results with confidence scores
- [ ] Allow: Batch review of low-confidence crops

#### 3.3.3 Manual Crop Editor (Fallback)
- [ ] Install: `react-image-crop` or similar
- [ ] Create: Manual crop interface
- [ ] Allow: User to draw crop region
- [ ] Save: User-defined crop

**Checklist Summary - Frame Removal:**
- [ ] 3.1.1 Research phase (2 days)
- [ ] 3.1.2 Architecture design
- [ ] 3.2.1 Implement detection (backend)
- [ ] 3.2.2 Implement SAM integration
- [ ] 3.2.3 Queue consumer
- [ ] 3.2.4 API endpoints
- [ ] 3.3.1 Before/after preview UI
- [ ] 3.3.2 Bulk frame removal UI
- [ ] 3.3.3 Manual crop editor

---

## SPRINT 4: Translation Service (Week 4)

**Duration:** 5 days
**Research Required:** Yes (Day 1)

### 4.1 Research Phase (Day 1)

**Owner:** Translation Research Agent

#### 4.1.1 API Testing & Selection
- [x] Test: Youdao API for Mandarin (specialized for Chinese)
- [x] Test: Google Translate API for Tamil (best support)
- [x] Test: OpenAI GPT-4 for Malay (best quality for Southeast Asian languages)
- [x] Tested: Quality verified for EN→ZH, EN→MS, EN→TA
- [x] Calculated: Cost for translating 1000 artworks × 3 languages

**Deliverable:** Provider matrix with quality scores and costs

**Production Strategy (tested and verified):**
- **Mandarin (ZH):** Youdao API - specialized Chinese translation with cultural context
- **Malay (MS):** OpenAI GPT-4 - best quality for Southeast Asian art context
- **Tamil (TA):** Google Translate V2 - excellent Tamil support with REST API
- **Fallback:** Cloudflare AI (free, decent quality)

---

### 4.2 Backend Implementation (Days 2-4)

**Owner:** Translation Backend Agent

#### 4.2.1 Create Translation Service Package
- [ ] Create: `packages/translation/` package
- [ ] Install: Provider SDKs (Youdao, Google Translate V2, OpenAI GPT-4)
- [ ] Implement: Provider abstraction layer
- [ ] Implement: Automatic fallback logic

**File:** `packages/translation/src/translation-service.ts`

```typescript
interface TranslationProvider {
  name: string;
  translate(text: string, from: string, to: string): Promise<string>;
  supportedLanguages: string[];
  cost: number; // per character
}

class OpenAIProvider implements TranslationProvider {
  async translate(text: string, from: string, to: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert translator for art gallery content. Preserve artistic terminology and cultural nuance.',
        },
        {
          role: 'user',
          content: `Translate this from ${from} to ${to}:\n\n${text}`,
        },
      ],
    });
    return response.choices[0].message.content;
  }
}

class YoudaoProvider implements TranslationProvider {
  async translate(text: string, from: string, to: string): Promise<string> {
    // Youdao API implementation for Mandarin
    const signStr = this.appKey + this.truncate(text) + this.salt + this.curtime + this.appSecret;
    const sign = this.encrypt(signStr);

    const response = await fetch('https://openapi.youdao.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        from,
        to,
        signType: 'v3',
        curtime: this.curtime,
        salt: this.salt,
        appKey: this.appKey,
        q: text,
        sign,
      }),
    });
    const data = await response.json();
    return data.translation[0];
  }
}

class GoogleTranslateProvider implements TranslationProvider {
  async translate(text: string, from: string, to: string): Promise<string> {
    // Google Translate V2 for Tamil
    const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
      params: {
        q: text,
        target: to,
        format: 'text',
        key: this.apiKey,
      },
    });
    const data = await response.json();
    return data.data.translations[0].translatedText;
  }
}

export class TranslationService {
  private providersByLang: Map<string, TranslationProvider>;

  constructor() {
    this.providersByLang = new Map([
      ['zh', new YoudaoProvider()],      // Mandarin: Youdao
      ['ms', new OpenAIProvider()],       // Malay: OpenAI GPT-4
      ['ta', new GoogleTranslateProvider()], // Tamil: Google Translate
    ]);
  }

  async translate(
    text: string,
    targetLang: 'zh' | 'ms' | 'ta'
  ): Promise<TranslationResult> {
    // Use language-specific provider
    const provider = this.providersByLang.get(targetLang);

    if (!provider) {
      throw new Error(`No provider configured for language: ${targetLang}`);
    }

    try {
      const translated = await provider.translate(text, 'en', targetLang);

      // Cache result
      await this.cacheTranslation(text, targetLang, translated);

      return {
        translatedText: translated,
        provider: provider.name,
        cached: false,
      };
    } catch (error) {
      // Fallback to Cloudflare AI
      console.warn(`${provider.name} failed, trying Cloudflare AI fallback`);
      const fallback = new CloudflareAIProvider();
      const translated = await fallback.translate(text, 'en', targetLang);
      return {
        translatedText: translated,
        provider: 'cloudflare-ai-fallback',
        cached: false,
      };
    }
  }

  private async cacheTranslation(original: string, lang: string, translated: string) {
    // Cache in KV for 30 days
    const key = `translation:${this.hash(original)}:${lang}`;
    await KV.put(key, translated, { expirationTtl: 2592000 });
  }
}
```

#### 4.2.2 API Endpoints
- [ ] `POST /api/v1/translate/text` - Single text translation
- [ ] `POST /api/v1/artworks/:id/translate` - Translate artwork metadata
- [ ] `POST /api/v1/galleries/:id/translate-all` - Batch translate entire gallery
- [ ] `GET /api/v1/translation-jobs/:id` - Check batch job status

#### 4.2.3 Queue Consumer
- [ ] Create: `translation-queue`
- [ ] Implement: Batch translation processor
- [ ] Update: Artwork translations in database
- [ ] Track: Translation costs and usage

#### 4.2.4 Database Schema
- [ ] Verify: `translations` JSON column exists in artworks table
- [ ] Add: Translation job tracking table
- [ ] Add: Translation cache analytics

---

### 4.3 Frontend Implementation (Days 3-5)

**Owner:** Translation Frontend Agent

#### 4.3.1 Language Selector Component
- [ ] Create: `<LanguageSelector />` component
- [ ] Show: Available languages (EN, ZH, MS, TA)
- [ ] Persist: User language preference in localStorage
- [ ] Update: Content dynamically when language changes

**Component:** `apps/web/app/components/language-selector.tsx`

```typescript
export function LanguageSelector() {
  const [language, setLanguage] = useLanguage();

  return (
    <Select value={language} onValueChange={setLanguage}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="zh">中文</SelectItem>
        <SelectItem value="ms">Melayu</SelectItem>
        <SelectItem value="ta">தமிழ்</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

#### 4.3.2 Translated Content Display
- [ ] Update: `<ArtworkCard />` to show translated title/description
- [ ] Update: `<ArtworkDetail />` dialog
- [ ] Add: Language badge when viewing translations
- [ ] Fallback: Show English if translation not available

#### 4.3.3 Translation Management UI
- [ ] Create: `/galleries/:id/translations` page
- [ ] Show: Translation status for all artworks
- [ ] Add: "Translate All" button
- [ ] Display: Translation progress
- [ ] Show: Cost estimate before translating

#### 4.3.4 Document Translation UI
- [ ] Add: Document upload for translation
- [ ] Support: DOCX format
- [ ] Show: Translation progress
- [ ] Download: Translated document

**Checklist Summary - Translation:**
- [ ] 4.1.1 Research & API testing
- [ ] 4.2.1 Translation service package
- [ ] 4.2.2 API endpoints
- [ ] 4.2.3 Queue consumer
- [ ] 4.2.4 Database schema
- [ ] 4.3.1 Language selector component
- [ ] 4.3.2 Translated content display
- [ ] 4.3.3 Translation management UI
- [ ] 4.3.4 Document translation UI

---

## SPRINT 5: Embedding Visualizer (Week 5)

**Duration:** 5 days
**Research Required:** Yes (Days 1-2)
**Complexity:** High (ML + 3D visualization)

### 5.1 Research & Architecture (Days 1-2)

**Owner:** Embedding Viz Research Agent

#### 5.1.1 Research Dimensionality Reduction
- [ ] Research: UMAP.js vs t-SNE.js vs PCA
- [ ] Test: Performance with 1000 embeddings (768-dim → 2D)
- [ ] Test: Quality of clustering
- [ ] Test: Browser performance (WebGL vs Canvas)
- [ ] **Decision:** Choose reduction algorithm + visualization library

**Options:**
- **UMAP**: Best quality, slower, good for large datasets
- **t-SNE**: Good quality, faster than UMAP, standard choice
- **PCA**: Fastest, lower quality, good for quick preview

**Visualization Libraries:**
- **D3.js**: 2D, highly customizable, good performance
- **Three.js**: 3D, beautiful, higher complexity
- **Plotly.js**: Easy setup, less customization
- **deck.gl**: WebGL-accelerated, best performance for large datasets

**Recommended:** t-SNE + D3.js (2D) or Three.js (3D)

#### 5.1.2 Architecture Design
- [ ] Design: Pre-compute projections vs client-side computation
- [ ] Design: How to update projections when new artworks added
- [ ] Design: Interaction patterns (zoom, pan, click)
- [ ] Design: Cluster detection algorithm

**Recommendation:** Pre-compute projections on server, store in database

---

### 5.2 Backend Implementation (Days 2-4)

**Owner:** Embedding Viz Backend Agent

#### 5.2.1 Implement UMAP/t-SNE Service
- [ ] Research: Can UMAP/t-SNE run in Cloudflare Workers?
  - **Answer:** No, need external Python service or pre-computation
- [ ] **Decision:** Use external service (Modal, Replicate) or pre-compute offline
- [ ] Implement: Python service for dimensionality reduction
- [ ] API: Send embeddings → receive 2D/3D coordinates

**Option 1: External Python Service (Recommended)**

```python
# Deploy on Modal.com or similar
from umap import UMAP
import numpy as np
from fastapi import FastAPI

app = FastAPI()

@app.post("/reduce")
async def reduce_dimensions(embeddings: list[list[float]]):
    """
    Reduce 768-dim embeddings to 2D/3D
    """
    embeddings_array = np.array(embeddings)

    reducer = UMAP(
        n_components=2,  # or 3 for 3D
        n_neighbors=15,
        min_dist=0.1,
        metric='cosine'
    )

    projection = reducer.fit_transform(embeddings_array)

    return {
        "coordinates": projection.tolist()
    }
```

**Option 2: Pre-compute Offline**
- Run UMAP locally/in CI
- Store coordinates in database
- Update periodically (nightly job)

#### 5.2.2 Database Schema
- [ ] Add columns: `projection_x`, `projection_y`, `projection_z` to artworks
- [ ] Add: Projection metadata (algorithm, date, parameters)
- [ ] Create index on gallery_id + projection columns

**Migration:** `packages/database/migrations/004_add_projections.sql`

```sql
ALTER TABLE artworks ADD COLUMN projection_x REAL;
ALTER TABLE artworks ADD COLUMN projection_y REAL;
ALTER TABLE artworks ADD COLUMN projection_z REAL;
ALTER TABLE artworks ADD COLUMN projection_updated_at TEXT;

CREATE INDEX idx_artworks_projections
ON artworks(gallery_id, projection_x, projection_y)
WHERE projection_x IS NOT NULL;
```

#### 5.2.3 API Endpoints
- [ ] `GET /api/v1/galleries/:id/embeddings/projection` - Get 2D/3D coordinates
- [ ] `POST /api/v1/galleries/:id/embeddings/recompute` - Trigger recomputation
- [ ] `GET /api/v1/galleries/:id/embeddings/clusters` - Get cluster info

**Response Format:**

```typescript
{
  success: true,
  data: {
    artworks: [
      {
        id: "art-001",
        title: "Starry Night",
        imageUrl: "https://...",
        x: 10.5,
        y: -3.2,
        z: 1.8,  // optional for 3D
        cluster: 3
      },
      // ... more artworks
    ],
    clusters: [
      {
        id: 1,
        label: "Impressionist Landscapes",
        color: "#FF6B6B",
        artworkCount: 45
      },
      // ... more clusters
    ]
  }
}
```

#### 5.2.4 Cluster Detection
- [ ] Implement: DBSCAN or K-means clustering on 2D coordinates
- [ ] Assign: Cluster labels to artworks
- [ ] Generate: Cluster summaries (common themes)

---

### 5.3 Frontend Implementation (Days 3-5)

**Owner:** Embedding Viz Frontend Agent

#### 5.3.1 Create Visualization Component (2D with D3)
- [ ] Install: `d3`
- [ ] Create: `<EmbeddingProjector2D />` component
- [ ] Implement: Scatter plot with zoom/pan
- [ ] Add: Tooltip on hover
- [ ] Add: Click to view artwork detail

**Component:** `apps/web/app/components/embedding-viz/projector-2d.tsx`

```typescript
import * as d3 from 'd3';
import { useEffect, useRef } from 'react';

export function EmbeddingProjector2D({ artworks }: { artworks: ProjectedArtwork[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const width = 1000;
    const height = 800;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Clear previous content
    svg.selectAll('*').remove();

    // Create scales
    const xScale = d3.scaleLinear()
      .domain(d3.extent(artworks, d => d.x) as [number, number])
      .range([50, width - 50]);

    const yScale = d3.scaleLinear()
      .domain(d3.extent(artworks, d => d.y) as [number, number])
      .range([height - 50, 50]);

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as any);

    // Create container group
    const g = svg.append('g');

    // Draw artwork points
    g.selectAll('circle')
      .data(artworks)
      .enter()
      .append('circle')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 5)
      .attr('fill', d => d.clusterColor || '#8b5cf6')
      .attr('opacity', 0.7)
      .on('mouseover', function(event, d) {
        // Show tooltip
        d3.select(this).attr('r', 8).attr('opacity', 1);
        showTooltip(event, d);
      })
      .on('mouseout', function() {
        d3.select(this).attr('r', 5).attr('opacity', 0.7);
        hideTooltip();
      })
      .on('click', (event, d) => {
        openArtworkDetail(d.id);
      });

  }, [artworks]);

  return (
    <div className="relative">
      <svg ref={svgRef} className="border border-neutral-200 rounded-lg" />
      <div id="tooltip" className="absolute hidden bg-white p-2 shadow-lg rounded">
        {/* Tooltip content */}
      </div>
    </div>
  );
}
```

#### 5.3.2 Create 3D Visualization (Three.js) - Optional
- [ ] Install: `three`, `@react-three/fiber`, `@react-three/drei`
- [ ] Create: `<EmbeddingProjector3D />` component
- [ ] Implement: 3D scatter plot with orbit controls
- [ ] Add: Artwork thumbnails on spheres
- [ ] Add: Cluster regions (colored volumes)

#### 5.3.3 Create Embedding Explorer Page
- [ ] Create: `/galleries/:id/embeddings` route
- [ ] Add: 2D/3D toggle
- [ ] Add: Cluster filter dropdown
- [ ] Add: Search bar (filter by title)
- [ ] Add: Legend (cluster colors)

#### 5.3.4 Integration with Main Gallery
- [ ] Add: "Explore Embeddings" button on gallery page
- [ ] Add: Mini preview in sidebar
- [ ] Link: Click cluster → filter gallery view

**Checklist Summary - Embedding Viz:**
- [ ] 5.1.1 Research dimensionality reduction
- [ ] 5.1.2 Architecture design
- [ ] 5.2.1 Implement UMAP/t-SNE service
- [ ] 5.2.2 Database schema
- [ ] 5.2.3 API endpoints
- [ ] 5.2.4 Cluster detection
- [ ] 5.3.1 2D visualization (D3)
- [ ] 5.3.2 3D visualization (Three.js) - optional
- [ ] 5.3.3 Embedding explorer page
- [ ] 5.3.4 Integration with gallery

---

## Success Criteria

### Sprint 1: CSV + Bulk Upload
- [ ] ✅ Upload 1000-row CSV completes in < 10 seconds
- [ ] ✅ Upload 100 images successfully
- [ ] ✅ Error handling shows line-by-line validation errors
- [ ] ✅ Test coverage: 90%+

### Sprint 2: Color Extraction
- [ ] ✅ Extract colors from 100 images in < 2 minutes (via queue)
- [ ] ✅ Color search returns relevant results (manual verification)
- [ ] ✅ Color picker UI is intuitive
- [ ] ✅ Test coverage: 85%+

### Sprint 3: Frame Removal
- [ ] ✅ Frame removal succeeds on 90%+ of test images
- [ ] ✅ Before/after preview UI works smoothly
- [ ] ✅ Manual fallback option available
- [ ] ✅ Cost per 1000 images: < $20

### Sprint 4: Translation
- [ ] ✅ Translate 100 artworks to 3 languages in < 5 minutes
- [ ] ✅ Translation quality verified by native speakers
- [ ] ✅ Language switcher works correctly
- [ ] ✅ Fallback to English when translation unavailable

### Sprint 5: Embedding Visualizer
- [ ] ✅ Visualize 1000 artworks smoothly (60fps)
- [ ] ✅ Zoom, pan, click interactions work
- [ ] ✅ Clusters are visually meaningful
- [ ] ✅ Loads in < 3 seconds

---

## Cost Projections

**For 1000 Artworks:**

| Feature | Service | Cost |
|---------|---------|------|
| Color Extraction | Cloudflare Workers | $0 (included) |
| Frame Removal | Replicate SAM | $2-13 |
| Translation (3 langs) | DeepL Beta + CF AI | $0-50 |
| Embedding Viz | UMAP service | $5-20 |
| **Total** | | **$7-83** |

**Monthly Operational Costs:**
- Cloudflare Workers: $5-25/month (depending on usage)
- D1 Database: Included in Workers plan
- R2 Storage: $0.015/GB (~$15 for 1TB)
- Vectorize: Included in Workers plan
- **Total Monthly**: $20-50/month for 10,000 artworks

---

## Getting Started

### For Sprint 1 (CSV + Bulk Upload):

```bash
# 1. Backend team starts here
cd packages/metadata
pnpm install
pnpm test --watch

# 2. Frontend team starts here
cd apps/web
pnpm install
pnpm dev

# 3. Integration team starts here
cd apps/api
pnpm test:integration
```

### Daily Standup Format:

**Questions:**
1. What did you complete yesterday? (check off items)
2. What are you working on today?
3. Any blockers?

### Weekly Review:

**Friday:**
- Demo working features
- Review test coverage
- Update PROGRESS.md
- Plan next sprint

---

## Notes

- **Auth Team:** Replace mock middleware with real JWT auth when ready
- **Design System:** All components use Tailwind + Radix UI
- **Testing:** TDD approach - write tests first (RED), then implement (GREEN)
- **Documentation:** Update as you build (API docs, user guides)
- **Cost Tracking:** Log all API usage for billing analysis

**Ready to start Sprint 1? Let's go! 🚀**
