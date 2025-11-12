# TypeScript Cleanup Task

**Created:** 2025-11-12
**Priority:** Medium
**Status:** Not Started
**Target:** Zero TypeScript errors before production deployment

---

## Overview

After completing Sprint 5, there are **27 pre-existing TypeScript errors** in the codebase that need to be resolved before production deployment. These errors do not affect functionality but should be fixed for type safety and maintainability.

---

## Error Breakdown

### 1. Translation Components (7 errors)

**Files:**
- `app/components/translate/document-translator.tsx` (5 errors)
- `app/components/translate/text-translator.tsx` (2 errors)

**Issues:**

#### document-translator.tsx
```typescript
Line 47: 'refetch' is declared but its value is never read
  → Fix: Remove unused variable or use it

Line 56 (2x): Property 'status' does not exist on Query type
  → Fix: TanStack Query v5 API change - use queryResult.data.status or queryResult.isSuccess

Line 80 & 86: Argument of type 'File | undefined' is not assignable to parameter of type 'File'
  → Fix: Add type guards before API calls
  → Example: if (file) { await apiClient.translateDocument(file, ...) }
```

#### text-translator.tsx
```typescript
Line 13: 'Label' is declared but its value is never read
  → Fix: Remove unused import

Line 65: 'estimateMutation' is declared but its value is never read
  → Fix: Remove unused variable or use it for cost estimation display
```

**Estimated Time:** 20 minutes

---

### 2. API Client (16 errors)

**File:** `app/lib/api.ts`

**Issues:**

All errors are "data is of type 'unknown'" in 4 API methods:
- Lines 280-284 (4 errors)
- Lines 320-324 (4 errors)
- Lines 344-348 (4 errors)
- Lines 372-376 (4 errors)

**Root Cause:**
Fetch API returns `unknown` data type. Need proper type assertions or validation.

**Fix Strategy:**
```typescript
// Before (causes errors)
const data = await response.json();
if (data.success) { ... }

// After (type-safe)
const data = await response.json() as { success: boolean; data: T };
// OR use Zod validation
const result = ApiResponseSchema.parse(await response.json());
```

**Affected Methods:**
- Frame removal endpoints
- Translation endpoints
- Color extraction endpoints
- Embedding endpoints

**Estimated Time:** 30 minutes

---

### 3. Minor Issues (4 errors)

#### Color Search Route
```typescript
File: app/routes/galleries.$galleryId.color-search.tsx
Line 8: 'SearchResults' is declared but its value is never read
  → Fix: Remove unused import
```

#### Explore Route
```typescript
File: app/routes/galleries.$galleryId.explore.tsx
Line 348: 'image_url' does not exist - did you mean 'imageUrl'?
  → Fix: Change snake_case to camelCase (image_url → imageUrl)
```

#### E2E Tests
```typescript
File: e2e/performance.spec.ts
Line 78: 'page' is declared but its value is never read
  → Fix: Remove unused parameter or prefix with underscore: (_page)
```

#### Test Setup
```typescript
File: test/setup.ts
Line 2: 'expect' is declared but its value is never read
  → Fix: Remove unused import if not needed
```

**Estimated Time:** 10 minutes

---

## Implementation Plan

### Phase 1: Quick Wins (10 minutes)
Fix simple unused imports/variables:
- [ ] Remove `SearchResults` import from color-search route
- [ ] Fix `image_url` → `imageUrl` in explore route
- [ ] Remove/prefix `page` parameter in performance test
- [ ] Remove `expect` import from test setup
- [ ] Remove `Label` import from text-translator
- [ ] Remove `refetch` and `estimateMutation` unused variables

### Phase 2: API Client Type Safety (30 minutes)
Add proper type assertions to `app/lib/api.ts`:
- [ ] Create type definitions for API responses
- [ ] Add type assertions to frame removal methods (lines 280-284)
- [ ] Add type assertions to translation methods (lines 320-324)
- [ ] Add type assertions to color extraction methods (lines 344-348)
- [ ] Add type assertions to embedding methods (lines 372-376)

**Recommended Approach:**
```typescript
// Create response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// Use in methods
async removeFrame(artworkId: string): Promise<Artwork> {
  const response = await fetch(`${this.baseUrl}/artworks/${artworkId}/remove-frame`, {
    method: 'POST',
  });

  const result = await response.json() as ApiResponse<Artwork>;

  if (!result.success) {
    throw new Error(result.error || 'Frame removal failed');
  }

  return result.data;
}
```

### Phase 3: Translation Components (20 minutes)
Fix TanStack Query v5 API and type guards:
- [ ] Fix `status` access in document-translator (use query.isSuccess, query.isError)
- [ ] Add type guards for File | undefined (lines 80, 86)
- [ ] Consider using or removing unused variables

**TanStack Query v5 Changes:**
```typescript
// Old (v4)
const { data, status } = useQuery(...)
if (status === 'success') { ... }

// New (v5)
const { data, isSuccess, isError, isPending } = useQuery(...)
if (isSuccess) { ... }
```

---

## Testing Checklist

After fixes, verify:
- [ ] Run `npm run typecheck` - should show 0 errors
- [ ] Run all tests: `npm test`
- [ ] Test translation features manually
- [ ] Test frame removal manually
- [ ] Test color search manually
- [ ] Test embedding explorer manually

---

## Success Criteria

- ✅ Zero TypeScript errors (`npm run typecheck` clean)
- ✅ All existing tests passing
- ✅ No runtime regressions
- ✅ Type-safe API client
- ✅ Clean code without unused variables

---

## Total Estimated Time

| Phase | Time |
|-------|------|
| Phase 1: Quick Wins | 10 min |
| Phase 2: API Client | 30 min |
| Phase 3: Translation | 20 min |
| Testing | 15 min |
| **Total** | **~75 minutes** |

---

## Notes

- These are pre-existing errors, not introduced in Sprint 5
- Sprint 5 code is 100% type-safe with zero errors
- Fixing these will bring the entire codebase to production-grade type safety
- Priority is MEDIUM - doesn't block deployment but should be done before production
- Can be done in a single cleanup sprint or incrementally

---

## Related Issues

- Sprint 5 PR: https://github.com/erniesg/paillette/pull/13 (merged ✅)
- All sprints complete: 5/5 (100%)

---

## Next Steps

1. Create a new branch: `git checkout -b fix/typescript-cleanup`
2. Follow the 3-phase implementation plan
3. Run tests after each phase
4. Create PR when all errors are fixed
5. Merge and celebrate zero TypeScript errors! 🎉
