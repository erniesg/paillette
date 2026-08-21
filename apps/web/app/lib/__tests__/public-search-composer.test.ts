import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUBLIC_SEARCH_MIN_SCORE,
  applyPaletteOrder,
  beginSearchIntent,
  buildImageQueryExecution,
  completeImageSubmission,
  createSearchIntentGate,
  createSearchComposerState,
  deriveImageDraftConstraints,
  deriveRetryTarget,
  getEditorModeUpdate,
  getPublicSearchErrorCopy,
  getSearchPresentation,
  getSubmittedConstraintChips,
  getSubmittedSearchSummary,
  selectEditorMode,
  settleLatestSearchIntent,
  snapshotAcceptedConstraints,
  supersedeSearchIntent,
  updateImageObjectUrl,
  validateImageSelection,
  type SubmittedSearch,
} from '../public-search-composer';

const image = (bytes: number[], name = 'query.png', type = 'image/png') =>
  new File([new Uint8Array(bytes)], name, { type });

const completedText: SubmittedSearch = {
  kind: 'text',
  query: 'oil paintings before 1800',
  facet: null,
  explicitConstraints: {
    dateRange: { startYear: 1700, endYear: 1799 },
    classifications: ['Painting'],
    mediumFamilies: ['oil'],
  },
};

describe('public search composer ownership', () => {
  it('keeps an image editor with no submission idle and non-querying', () => {
    const state = createSearchComposerState('image');

    expect(getSearchPresentation(state)).toEqual({
      hasActiveSearch: false,
      owner: null,
      shouldRunTextQuery: false,
      shouldRunImageQuery: false,
      showResultControls: false,
      showEmptyState: false,
      ownershipNotice: null,
    });
  });

  it('preserves completed text ownership when only the editor switches to image', () => {
    const state = selectEditorMode(
      createSearchComposerState('text', completedText),
      'image',
      completedText.explicitConstraints
    );

    expect(state.submittedSearch).toBe(completedText);
    expect(getSearchPresentation(state)).toMatchObject({
      owner: 'text',
      shouldRunTextQuery: true,
      shouldRunImageQuery: false,
      showResultControls: true,
      ownershipNotice: 'Showing Text results until an image is uploaded.',
    });
  });

  it('keeps editor buttons editor-only while browse and palette order remain active', () => {
    const state = {
      ...applyPaletteOrder(
        createSearchComposerState('text', completedText),
        'navy'
      ),
      isBrowsingCollection: true,
    };

    expect(selectEditorMode(state, 'colour')).toEqual({
      ...state,
      editorMode: 'colour',
    });
    expect(getEditorModeUpdate('image')).toEqual({ editorMode: 'image' });
  });

  it('makes an image the owner only after its digest plan resolves', async () => {
    const before = selectEditorMode(
      createSearchComposerState('text', completedText),
      'image'
    );
    let resolvePlan!: (value: {
      digest: string;
      request: { constraints: { classifications: string[] } };
    }) => void;
    const plan = new Promise<{
      digest: string;
      request: { constraints: { classifications: string[] } };
    }>((resolve) => {
      resolvePlan = resolve;
    });
    const pending = plan.then((resolved) =>
      completeImageSubmission(before, image([1, 2, 3]), resolved)
    );

    expect(before.submittedSearch).toBe(completedText);
    resolvePlan({
      digest: 'digest-123',
      request: { constraints: { classifications: ['Painting'] } },
    });

    const after = await pending;
    expect(after.submittedSearch).toMatchObject({
      kind: 'image',
      digest: 'digest-123',
      displayName: 'query.png',
      constraints: { classifications: ['Painting'] },
    });
    expect(getSearchPresentation(after)).toMatchObject({
      owner: 'image',
      shouldRunTextQuery: false,
      shouldRunImageQuery: true,
    });
  });

  it('snapshots only accepted hard constraints without sharing mutable cache data', () => {
    const cached = {
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
      mediumFamilies: ['oil'],
      artistIds: ['artist-1'],
    };
    const snapshot = snapshotAcceptedConstraints(cached);

    cached.dateRange.startYear = 1900;
    cached.classifications.push('Drawing');
    cached.mediumFamilies[0] = 'ink';
    cached.artistIds[0] = 'artist-2';

    expect(snapshot).toEqual({
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
      mediumFamilies: ['oil'],
      artistIds: ['artist-1'],
    });
  });

  it('derives image summaries and chips only from the submitted image owner', () => {
    const state = completeImageSubmission(
      createSearchComposerState('image', completedText),
      image([9, 8, 7], 'portrait.png'),
      {
        digest: 'digest-image',
        request: {
          constraints: {
            dateRange: { startYear: 1700, endYear: 1799 },
            classifications: ['Painting'],
          },
        },
      }
    );

    expect(getSubmittedSearchSummary(state.submittedSearch)).toEqual({
      type: 'image',
      label: 'portrait.png',
      detail: 'visual search',
    });
    expect(getSubmittedConstraintChips(state.submittedSearch)).toEqual([
      {
        key: 'dateRange',
        label: '1700 to 1799',
        removeLabel: 'Remove date filter 1700 to 1799',
      },
      {
        key: 'classifications',
        label: 'Painting',
        removeLabel: 'Remove classification filter Painting',
      },
    ]);
  });

  it('keeps palette ordering as local state rather than a submitted filter', () => {
    const state = applyPaletteOrder(
      createSearchComposerState('image', {
        kind: 'image',
        file: image([1]),
        digest: 'digest',
        displayName: 'query.png',
      }),
      'navy'
    );

    expect(state.submittedSearch).toMatchObject({ kind: 'image' });
    expect(state.paletteOrder).toEqual({
      colour: 'navy',
      refinement: 'local-palette',
    });
    expect(
      getSubmittedSearchSummary(state.submittedSearch)?.detail
    ).not.toMatch(/combined|filter/i);
  });
});

describe('image draft constraint ownership', () => {
  const acceptedA = {
    parserVersion: 'nga-v5' as const,
    originalQuery: 'oil paintings before 1800',
    semanticQuery: 'oil paintings',
    constraints: {
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
    },
    corrections: [],
    unresolved: [],
  };

  it('clears old draft filters when the current Text owner has no completed interpretation', () => {
    const textB: SubmittedSearch = {
      kind: 'text',
      query: 'drawings after 1900',
      facet: null,
    };

    expect(deriveImageDraftConstraints(textB, undefined)).toBeUndefined();
  });

  it('rejects an accepted interpretation that belongs to an older Text owner', () => {
    const textB: SubmittedSearch = {
      kind: 'text',
      query: 'drawings after 1900',
      facet: null,
    };

    expect(deriveImageDraftConstraints(textB, acceptedA)).toBeUndefined();
  });

  it('snapshots only an interpretation matching the current submitted Text owner', () => {
    expect(deriveImageDraftConstraints(completedText, acceptedA)).toEqual({
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
    });
  });
});

describe('uncached image execution', () => {
  const canonicalQueryKey = [
    'search',
    'image',
    '27',
    'nga',
    'digest-123',
    30,
    0.2,
    'null',
  ] as const;

  it('releases inactive image results immediately and never treats them as fresh', () => {
    expect(
      buildImageQueryExecution({
        orgId: 'nga',
        canonicalQueryKey,
        executionId: 1,
        hasMounted: true,
        canSearchOnPage: true,
        submittedKind: 'image',
      })
    ).toMatchObject({
      enabled: true,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });

  it('executes an explicit same-digest submission once under a new execution identity', () => {
    const first = buildImageQueryExecution({
      orgId: 'nga',
      canonicalQueryKey,
      executionId: 1,
      hasMounted: true,
      canSearchOnPage: true,
      submittedKind: 'image',
    });
    const repeated = buildImageQueryExecution({
      orgId: 'nga',
      canonicalQueryKey,
      executionId: 2,
      hasMounted: true,
      canSearchOnPage: true,
      submittedKind: 'image',
    });

    expect(first.canonicalQueryKey).toBe(canonicalQueryKey);
    expect(repeated.canonicalQueryKey).toBe(canonicalQueryKey);
    expect(first.queryKey).not.toEqual(repeated.queryKey);
    expect(first.queryKey).toEqual([...canonicalQueryKey, 'submission', 1]);
    expect(repeated.queryKey).toEqual([...canonicalQueryKey, 'submission', 2]);
  });

  it('never enables a locked NGS image query', () => {
    expect(
      buildImageQueryExecution({
        orgId: 'ngs',
        canonicalQueryKey,
        executionId: 1,
        hasMounted: true,
        canSearchOnPage: false,
        submittedKind: 'image',
      })
    ).toEqual({
      canonicalQueryKey,
      queryKey: ['search', 'image', 'locked', 'ngs'],
      enabled: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});

describe('search intent generations', () => {
  it('ignores a stale upload resolution after later Text intent', async () => {
    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let resolve!: (value: string) => void;
    const task = new Promise<string>((done) => {
      resolve = done;
    });
    const committed: string[] = [];
    const settling = settleLatestSearchIntent({
      gate,
      token: upload,
      task,
      onSuccess: (value) => committed.push(value),
    });

    supersedeSearchIntent(gate);
    resolve('image-owner');

    await expect(settling).resolves.toBe('stale');
    expect(committed).toEqual([]);
  });

  it('ignores stale upload rejection without replacing the current error', async () => {
    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let reject!: (error: Error) => void;
    const task = new Promise<string>((_resolve, fail) => {
      reject = fail;
    });
    const errors: string[] = [];
    const settling = settleLatestSearchIntent({
      gate,
      token: upload,
      task,
      onSuccess: () => undefined,
      onError: (error) => errors.push(String(error)),
    });

    supersedeSearchIntent(gate);
    reject(new Error('read failed'));

    await expect(settling).resolves.toBe('stale');
    expect(errors).toEqual([]);
  });

  it('rolls back image controls when the current rebuild fails', async () => {
    const gate = createSearchIntentGate();
    const rebuild = beginSearchIntent(gate);
    const controls = { topK: 30, minScore: 0.2 };
    let committed = controls;
    let error = '';

    await expect(
      settleLatestSearchIntent({
        gate,
        token: rebuild,
        task: Promise.reject(new TypeError('Image bytes could not be read.')),
        onSuccess: () => {
          committed = { topK: 40, minScore: 0.1 };
        },
        onError: (reason) => {
          error = reason instanceof Error ? reason.message : String(reason);
        },
      })
    ).resolves.toBe('error');

    expect(committed).toBe(controls);
    expect(error).toBe('Image bytes could not be read.');
  });

  it('does not let an older rebuild overwrite newer committed settings', async () => {
    const gate = createSearchIntentGate();
    const older = beginSearchIntent(gate);
    let resolveOlder!: (value: { topK: number; minScore: number }) => void;
    const olderTask = new Promise<{ topK: number; minScore: number }>(
      (resolve) => {
        resolveOlder = resolve;
      }
    );
    let controls = { topK: 30, minScore: 0.2 };
    const olderSettling = settleLatestSearchIntent({
      gate,
      token: older,
      task: olderTask,
      onSuccess: (next) => {
        controls = next;
      },
    });

    const newer = beginSearchIntent(gate);
    await settleLatestSearchIntent({
      gate,
      token: newer,
      task: Promise.resolve({ topK: 40, minScore: 0.1 }),
      onSuccess: (next) => {
        controls = next;
      },
    });
    resolveOlder({ topK: 20, minScore: 0.3 });

    await expect(olderSettling).resolves.toBe('stale');
    expect(controls).toEqual({ topK: 40, minScore: 0.1 });
  });
});

describe('retry and failure copy', () => {
  it.each([
    [{ isBrowsingCollection: true, submittedKind: 'image' as const }, 'browse'],
    [{ isBrowsingCollection: false, submittedKind: 'image' as const }, 'image'],
    [{ isBrowsingCollection: false, submittedKind: 'text' as const }, 'text'],
    [{ isBrowsingCollection: false, submittedKind: null }, null],
  ])('derives the production retry target for %o', (input, target) => {
    expect(deriveRetryTarget(input)).toBe(target);
  });

  it('distinguishes image validation, rate-limit, unavailable, and general errors', () => {
    expect(
      getPublicSearchErrorCopy(
        { status: 400, message: 'Image must not be empty.' },
        'image'
      )
    ).toBe('Image must not be empty.');
    expect(getPublicSearchErrorCopy({ status: 429 }, 'image')).toMatch(
      /Visual search is busy/
    );
    expect(getPublicSearchErrorCopy({ status: 503 }, 'image')).toMatch(
      /temporarily unavailable/
    );
    expect(getPublicSearchErrorCopy(new Error('network failed'), 'image')).toBe(
      'Visual search failed.'
    );
  });
});

describe('public search defaults', () => {
  it('submits the UI default minimum score of 0.2', () => {
    expect(DEFAULT_PUBLIC_SEARCH_MIN_SCORE).toBe(0.2);
  });
});

describe('image selection validation', () => {
  it.each([
    [[], 'Choose one JPEG, PNG, or WebP image.'],
    [[image([1]), image([2], 'second.png')], 'Choose exactly one image.'],
    [[image([], 'empty.png')], 'Image must not be empty.'],
    [
      [image([1], 'query.gif', 'image/gif')],
      'Image must be a JPEG, PNG, or WebP file.',
    ],
    [
      [
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
          type: 'image/png',
        }),
      ],
      'Image must be 10 MiB or smaller.',
    ],
  ])(
    'rejects invalid upload selection %# with specific recovery copy',
    (files, message) => {
      expect(validateImageSelection(files)).toEqual({ ok: false, message });
    }
  );

  it('accepts one non-empty JPEG, PNG, or WebP image', () => {
    const file = image([1, 2, 3], 'valid.webp', 'image/webp');
    expect(validateImageSelection([file])).toEqual({ ok: true, file });
  });
});

describe('image object URL lifecycle', () => {
  it('revokes the previous preview on replace and the active preview on clear', () => {
    const revoked: string[] = [];
    const created: File[] = [];
    const urlApi = {
      createObjectURL(file: File) {
        created.push(file);
        return `blob:preview-${created.length}`;
      },
      revokeObjectURL(url: string) {
        revoked.push(url);
      },
    };
    const firstFile = image([1], 'first.png');
    const secondFile = image([2], 'second.png');

    const first = updateImageObjectUrl(null, firstFile, urlApi);
    expect(first).toBe('blob:preview-1');
    expect(revoked).toEqual([]);

    const second = updateImageObjectUrl(first, secondFile, urlApi);
    expect(second).toBe('blob:preview-2');
    expect(revoked).toEqual(['blob:preview-1']);

    expect(updateImageObjectUrl(second, null, urlApi)).toBeNull();
    expect(revoked).toEqual(['blob:preview-1', 'blob:preview-2']);
    expect(created).toEqual([firstFile, secondFile]);
  });

  it('preserves the current preview when replacement URL creation throws', () => {
    const revoked: string[] = [];
    const urlApi = {
      createObjectURL() {
        throw new Error('blob allocation failed');
      },
      revokeObjectURL(url: string) {
        revoked.push(url);
      },
    };

    expect(() =>
      updateImageObjectUrl('blob:current', image([2]), urlApi)
    ).toThrow('blob allocation failed');
    expect(revoked).toEqual([]);
  });
});
