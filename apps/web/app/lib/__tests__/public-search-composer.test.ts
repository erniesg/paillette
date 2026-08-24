import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUBLIC_SEARCH_MIN_SCORE,
  applyPaletteOrder,
  beginSearchIntent,
  buildImageQueryExecution,
  completeImageSubmission,
  createSearchIntentGate,
  createSearchComposerState,
  createImagePreviewOwnership,
  deriveDisplayedSearchError,
  deriveImageDraftConstraints,
  getEditorModeUpdate,
  getInterpretationChips,
  getSearchEmptyState,
  getSearchUrlStateKey,
  getVisibleImagePreview,
  getPublicSearchErrorCopy,
  getSearchPresentation,
  getSubmittedConstraintChips,
  getSubmittedSearchSummary,
  selectEditorMode,
  settleLatestSearchIntent,
  snapshotAcceptedConstraints,
  supersedeSearchIntent,
  teardownImageSearch,
  transitionImagePreviewOwnership,
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
  it('explains an unsupported NGA derivation without offering score relaxation', () => {
    expect(
      getSearchEmptyState({
        relation: {
          kind: 'derived_from',
          workClassification: 'Drawing',
          sourceClassification: 'Photograph',
        },
        relationEvidence: {
          policy: 'catalogue_derivation',
          status: 'unverified',
        },
      })
    ).toEqual({
      title: 'No catalogue-verified matches.',
      detail:
        'The indexed NGA catalogue does not verify this historical relationship.',
      canLowerThreshold: false,
    });
  });

  it('labels NGA attribution relationships without implying direct authorship', () => {
    expect(
      getInterpretationChips({
        attribution: { relationship: 'after', targetText: 'Rembrandt' },
      })
    ).toEqual([{ key: 'attribution', label: 'After · Rembrandt' }]);
    expect(
      getInterpretationChips({
        attribution: { relationship: 'attributed_to', targetText: 'Rembrandt' },
      })
    ).toEqual([{ key: 'attribution', label: 'Attributed to · Rembrandt' }]);
  });

  it('keeps generic empty states eligible for visual-search recovery controls', () => {
    expect(getSearchEmptyState()).toMatchObject({ canLowerThreshold: true });
  });

  it('gives programmatic URL targets the same stable identity as their arrival', () => {
    const target = getSearchUrlStateKey(
      'paintings before 1800',
      'classification',
      'navy'
    );

    expect(target).toBe(
      getSearchUrlStateKey(
        'paintings before 1800',
        'classification',
        'navy'
      )
    );
    expect(target).not.toBe(
      getSearchUrlStateKey('paintings before 1800', null, 'navy')
    );
    expect(getSearchUrlStateKey('', null, null)).toBe('["","",""]');
  });

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
    parserVersion: 'nga-v6' as const,
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
    '28',
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

describe('transactional image preview ownership', () => {
  const acceptedFile = image([1], 'accepted.png');
  const candidateFile = image([2], 'candidate.png');

  it('clears and revokes a pending candidate over a prior Text owner', () => {
    const staged = transitionImagePreviewOwnership(
      createImagePreviewOwnership(),
      {
        type: 'stage',
        preview: { file: candidateFile, url: 'blob:candidate' },
      }
    );
    expect(getVisibleImagePreview(staged.state)).toEqual({
      file: candidateFile,
      url: 'blob:candidate',
    });
    expect(staged.revoke).toEqual([]);

    const cancelled = transitionImagePreviewOwnership(staged.state, {
      type: 'cancel-candidate',
    });
    expect(cancelled).toEqual({
      state: { accepted: null, candidate: null },
      revoke: ['blob:candidate'],
    });
    expect(getVisibleImagePreview(cancelled.state)).toBeNull();
  });

  it('restores the exact accepted preview when a candidate over an Image owner is superseded', async () => {
    let state = createImagePreviewOwnership({
      file: acceptedFile,
      url: 'blob:accepted',
    });
    const staged = transitionImagePreviewOwnership(state, {
      type: 'stage',
      preview: { file: candidateFile, url: 'blob:candidate' },
    });
    state = staged.state;
    expect(staged.revoke).toEqual([]);

    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let resolve!: (value: string) => void;
    const task = new Promise<string>((done) => {
      resolve = done;
    });
    const settling = settleLatestSearchIntent({
      gate,
      token: upload,
      task,
      onSuccess: () => {
        state = transitionImagePreviewOwnership(state, {
          type: 'promote-candidate',
        }).state;
      },
    });

    supersedeSearchIntent(gate);
    const cancelled = transitionImagePreviewOwnership(state, {
      type: 'cancel-candidate',
    });
    state = cancelled.state;
    resolve('digest');

    await expect(settling).resolves.toBe('stale');
    expect(cancelled.revoke).toEqual(['blob:candidate']);
    expect(getVisibleImagePreview(state)).toEqual({
      file: acceptedFile,
      url: 'blob:accepted',
    });
  });

  it('promotes a successful candidate and revokes each owned URL exactly once', () => {
    const staged = transitionImagePreviewOwnership(
      createImagePreviewOwnership({
        file: acceptedFile,
        url: 'blob:accepted',
      }),
      {
        type: 'stage',
        preview: { file: candidateFile, url: 'blob:candidate' },
      }
    );
    const promoted = transitionImagePreviewOwnership(staged.state, {
      type: 'promote-candidate',
    });
    expect(promoted).toEqual({
      state: {
        accepted: { file: candidateFile, url: 'blob:candidate' },
        candidate: null,
      },
      revoke: ['blob:accepted'],
    });

    const cleared = transitionImagePreviewOwnership(promoted.state, {
      type: 'clear',
    });
    expect(cleared).toEqual({
      state: { accepted: null, candidate: null },
      revoke: ['blob:candidate'],
    });
    expect(
      transitionImagePreviewOwnership(cleared.state, { type: 'clear' }).revoke
    ).toEqual([]);
  });

  it('revokes a failed current candidate while preserving the accepted preview', async () => {
    let state = transitionImagePreviewOwnership(
      createImagePreviewOwnership({
        file: acceptedFile,
        url: 'blob:accepted',
      }),
      {
        type: 'stage',
        preview: { file: candidateFile, url: 'blob:candidate' },
      }
    ).state;
    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let revoked: string[] = [];

    await settleLatestSearchIntent({
      gate,
      token: upload,
      task: Promise.reject(new Error('read failed')),
      onSuccess: () => undefined,
      onError: () => {
        const cancelled = transitionImagePreviewOwnership(state, {
          type: 'cancel-candidate',
        });
        state = cancelled.state;
        revoked = cancelled.revoke;
      },
    });

    expect(revoked).toEqual(['blob:candidate']);
    expect(getVisibleImagePreview(state)).toEqual({
      file: acceptedFile,
      url: 'blob:accepted',
    });
  });

  it('invalidates a pending generation before teardown and makes its late resolve inert', async () => {
    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let resolve!: (value: string) => void;
    const task = new Promise<string>((done) => {
      resolve = done;
    });
    const stateMutations: string[] = [];
    const searchParamMutations: string[] = [];
    const errorMutations: string[] = [];
    const settledMutations: string[] = [];
    const urlMutations: string[] = [];
    const settling = settleLatestSearchIntent({
      gate,
      token: upload,
      task,
      onSuccess: (digest) => {
        stateMutations.push(`owner:${digest}`, `plan:${digest}`);
        urlMutations.push('create:submitted-preview');
        searchParamMutations.push('set:image');
      },
      onError: (error) => errorMutations.push(String(error)),
      onSettled: () => settledMutations.push('settled'),
    });

    const cleared = teardownImageSearch({
      gate,
      ownership: {
        accepted: { file: acceptedFile, url: 'blob:accepted' },
        candidate: { file: candidateFile, url: 'blob:candidate' },
      },
      revokeObjectUrl: (url) => {
        expect(gate.generation).toBe(upload + 1);
        urlMutations.push(`revoke:${url}`);
      },
    });
    const effectsAfterTeardown = [...urlMutations];
    resolve('late-digest');

    await expect(settling).resolves.toBe('stale');
    expect(cleared).toEqual({ accepted: null, candidate: null });
    expect(effectsAfterTeardown).toEqual([
      'revoke:blob:accepted',
      'revoke:blob:candidate',
    ]);
    expect(urlMutations).toEqual(effectsAfterTeardown);
    expect(stateMutations).toEqual([]);
    expect(searchParamMutations).toEqual([]);
    expect(errorMutations).toEqual([]);
    expect(settledMutations).toEqual([]);
  });

  it('invalidates a pending generation before teardown and makes its late reject inert', async () => {
    const gate = createSearchIntentGate();
    const upload = beginSearchIntent(gate);
    let reject!: (error: Error) => void;
    const task = new Promise<string>((_resolve, fail) => {
      reject = fail;
    });
    const stateMutations: string[] = [];
    const searchParamMutations: string[] = [];
    const errorMutations: string[] = [];
    const settledMutations: string[] = [];
    const urlMutations: string[] = [];
    const settling = settleLatestSearchIntent({
      gate,
      token: upload,
      task,
      onSuccess: (digest) => {
        stateMutations.push(`owner:${digest}`, `plan:${digest}`);
        urlMutations.push('create:submitted-preview');
        searchParamMutations.push('set:image');
      },
      onError: (error) => errorMutations.push(String(error)),
      onSettled: () => settledMutations.push('settled'),
    });

    const cleared = teardownImageSearch({
      gate,
      ownership: {
        accepted: { file: acceptedFile, url: 'blob:accepted' },
        candidate: { file: candidateFile, url: 'blob:candidate' },
      },
      revokeObjectUrl: (url) => {
        expect(gate.generation).toBe(upload + 1);
        urlMutations.push(`revoke:${url}`);
      },
    });
    const effectsAfterTeardown = [...urlMutations];
    reject(new Error('late read failure'));

    await expect(settling).resolves.toBe('stale');
    expect(cleared).toEqual({ accepted: null, candidate: null });
    expect(effectsAfterTeardown).toEqual([
      'revoke:blob:accepted',
      'revoke:blob:candidate',
    ]);
    expect(urlMutations).toEqual(effectsAfterTeardown);
    expect(stateMutations).toEqual([]);
    expect(searchParamMutations).toEqual([]);
    expect(errorMutations).toEqual([]);
    expect(settledMutations).toEqual([]);
  });
});

describe('displayed error ownership and retry', () => {
  const browseError = new Error('browse failed');
  const rankedError = new Error('ranked failed');

  it('owns and retries a displayed Browse failure', () => {
    expect(
      deriveDisplayedSearchError({
        isBrowsingCollection: true,
        shouldShowRankedSearch: true,
        submittedKind: 'image',
        browseError,
        rankedError: null,
      })
    ).toEqual({
      error: browseError,
      source: 'browse',
      retryTarget: 'browse',
    });
  });

  it('owns and retries the ranked failure when Browse succeeds', () => {
    expect(
      deriveDisplayedSearchError({
        isBrowsingCollection: true,
        shouldShowRankedSearch: true,
        submittedKind: 'image',
        browseError: null,
        rankedError,
      })
    ).toEqual({
      error: rankedError,
      source: 'ranked',
      retryTarget: 'image',
    });
  });

  it('gives Browse failure the same precedence for display and retry when both fail', () => {
    expect(
      deriveDisplayedSearchError({
        isBrowsingCollection: true,
        shouldShowRankedSearch: true,
        submittedKind: 'text',
        browseError,
        rankedError,
      })
    ).toEqual({
      error: browseError,
      source: 'browse',
      retryTarget: 'browse',
    });
  });

  it('owns and retries an ordinary ranked Text failure', () => {
    expect(
      deriveDisplayedSearchError({
        isBrowsingCollection: false,
        shouldShowRankedSearch: true,
        submittedKind: 'colour',
        browseError,
        rankedError,
      })
    ).toEqual({
      error: rankedError,
      source: 'ranked',
      retryTarget: 'text',
    });
  });

  it('does not display an unrelated ranked error during unranked Browse', () => {
    expect(
      deriveDisplayedSearchError({
        isBrowsingCollection: true,
        shouldShowRankedSearch: false,
        submittedKind: 'text',
        browseError: null,
        rankedError,
      })
    ).toBeNull();
  });

  it('keeps status-aware failure copy', () => {
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
