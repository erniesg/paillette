import { describe, expect, it } from 'vitest';

import {
  applyPaletteOrder,
  completeImageSubmission,
  createSearchComposerState,
  getSearchPresentation,
  getSubmittedConstraintChips,
  getSubmittedSearchSummary,
  selectEditorMode,
  snapshotAcceptedConstraints,
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
});
