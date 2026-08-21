import {
  normalizePublicSearchConstraints,
  type PublicSearchConstraints,
} from '@paillette/types/public-search-core';

export type EditorMode = 'text' | 'image' | 'colour';
export type SearchFacet = 'artist' | 'classification';

export type SubmittedSearch =
  | {
      kind: 'text';
      query: string;
      facet: SearchFacet | null;
      explicitConstraints?: PublicSearchConstraints;
    }
  | {
      kind: 'colour';
      query: string;
      facet: SearchFacet | null;
      explicitConstraints?: PublicSearchConstraints;
      colour: string;
      refinement: 'local-palette';
    }
  | {
      kind: 'image';
      file: File;
      digest: string;
      constraints?: PublicSearchConstraints;
      displayName: string;
    };

export type SearchComposerState = {
  editorMode: EditorMode;
  submittedSearch: SubmittedSearch | null;
  isBrowsingCollection: boolean;
  imageDraftConstraints?: PublicSearchConstraints;
  paletteOrder?: {
    colour: string;
    refinement: 'local-palette';
  };
};

type ImagePlanSnapshot = {
  digest: string;
  request: { constraints?: PublicSearchConstraints };
};

export type ConstraintChip = {
  key: keyof PublicSearchConstraints;
  label: string;
  removeLabel: string;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ObjectUrlApi = {
  createObjectURL: (file: File) => string;
  revokeObjectURL: (url: string) => void;
};

export const updateImageObjectUrl = (
  current: string | null,
  file: File | null,
  urlApi: ObjectUrlApi = URL
) => {
  if (current) urlApi.revokeObjectURL(current);
  return file ? urlApi.createObjectURL(file) : null;
};

export const snapshotAcceptedConstraints = (
  constraints?: PublicSearchConstraints
): PublicSearchConstraints | undefined => {
  if (constraints === undefined) return undefined;
  return normalizePublicSearchConstraints({
    ...(constraints.dateRange
      ? {
          dateRange: {
            startYear: constraints.dateRange.startYear,
            endYear: constraints.dateRange.endYear,
          },
        }
      : {}),
    ...(constraints.classifications
      ? { classifications: [...constraints.classifications] }
      : {}),
    ...(constraints.mediumFamilies
      ? { mediumFamilies: [...constraints.mediumFamilies] }
      : {}),
    ...(constraints.artistIds ? { artistIds: [...constraints.artistIds] } : {}),
  });
};

export const createSearchComposerState = (
  editorMode: EditorMode = 'text',
  submittedSearch: SubmittedSearch | null = null
): SearchComposerState => ({
  editorMode,
  submittedSearch,
  isBrowsingCollection: false,
});

export const selectEditorMode = (
  state: SearchComposerState,
  editorMode: EditorMode,
  acceptedConstraints?: PublicSearchConstraints
): SearchComposerState => ({
  ...state,
  editorMode,
  ...(editorMode === 'image' && acceptedConstraints !== undefined
    ? {
        imageDraftConstraints: snapshotAcceptedConstraints(acceptedConstraints),
      }
    : {}),
});

export const completeImageSubmission = (
  state: SearchComposerState,
  file: File,
  plan: ImagePlanSnapshot
): SearchComposerState => ({
  ...state,
  editorMode: 'image',
  submittedSearch: {
    kind: 'image',
    file,
    digest: plan.digest,
    constraints: snapshotAcceptedConstraints(plan.request.constraints),
    displayName: file.name || 'uploaded image',
  },
  imageDraftConstraints: snapshotAcceptedConstraints(plan.request.constraints),
});

export const applyPaletteOrder = (
  state: SearchComposerState,
  colour: string
): SearchComposerState => ({
  ...state,
  paletteOrder: { colour, refinement: 'local-palette' },
});

export const getSearchPresentation = (state: SearchComposerState) => {
  const owner = state.isBrowsingCollection
    ? ('browse' as const)
    : state.submittedSearch?.kind || null;
  const hasActiveSearch = state.isBrowsingCollection || owner !== null;
  const submittedMode = state.submittedSearch?.kind || null;
  const ownershipNotice =
    state.editorMode === 'image' &&
    submittedMode !== null &&
    submittedMode !== 'image'
      ? `Showing ${submittedMode === 'text' ? 'Text' : 'Colour'} results until an image is uploaded.`
      : null;

  return {
    hasActiveSearch,
    owner,
    shouldRunTextQuery:
      !state.isBrowsingCollection &&
      (submittedMode === 'text' || submittedMode === 'colour'),
    shouldRunImageQuery:
      !state.isBrowsingCollection && submittedMode === 'image',
    showResultControls: hasActiveSearch,
    showEmptyState: hasActiveSearch,
    ownershipNotice,
  };
};

export const getSubmittedSearchSummary = (
  submittedSearch: SubmittedSearch | null
): { type: string; label: string; detail?: string } | null => {
  if (!submittedSearch) return null;
  if (submittedSearch.kind === 'image') {
    return {
      type: 'image',
      label: submittedSearch.displayName,
      detail: 'visual search',
    };
  }
  if (submittedSearch.kind === 'colour') {
    return {
      type: submittedSearch.facet || 'colour',
      label: submittedSearch.query,
      detail: `Palette order: ${submittedSearch.colour}`,
    };
  }
  return {
    type: submittedSearch.facet || 'text',
    label: submittedSearch.query,
  };
};

export const getConstraintChips = (
  constraints?: PublicSearchConstraints
): ConstraintChip[] => {
  if (!constraints) return [];

  const chips: ConstraintChip[] = [];
  if (constraints.dateRange) {
    const label = `${constraints.dateRange.startYear} to ${constraints.dateRange.endYear}`;
    chips.push({
      key: 'dateRange',
      label,
      removeLabel: `Remove date filter ${label}`,
    });
  }
  for (const classification of constraints.classifications || []) {
    chips.push({
      key: 'classifications',
      label: classification,
      removeLabel: `Remove classification filter ${classification}`,
    });
  }
  for (const medium of constraints.mediumFamilies || []) {
    chips.push({
      key: 'mediumFamilies',
      label: medium,
      removeLabel: `Remove medium filter ${medium}`,
    });
  }
  for (const artist of constraints.artistIds || []) {
    chips.push({
      key: 'artistIds',
      label: artist,
      removeLabel: `Remove artist filter ${artist}`,
    });
  }
  return chips;
};

export const getSubmittedConstraintChips = (
  submittedSearch: SubmittedSearch | null
): ConstraintChip[] =>
  getConstraintChips(
    submittedSearch?.kind === 'image'
      ? submittedSearch.constraints
      : submittedSearch?.explicitConstraints
  );

export const removeConstraintChip = (
  constraints: PublicSearchConstraints | undefined,
  chip: ConstraintChip
): PublicSearchConstraints | undefined => {
  if (!constraints) return undefined;
  const next = snapshotAcceptedConstraints(constraints) || {};
  if (chip.key === 'dateRange') {
    delete next.dateRange;
  } else {
    const values = next[chip.key]?.filter((value) => value !== chip.label);
    if (values?.length) {
      next[chip.key] = values;
    } else {
      delete next[chip.key];
    }
  }
  return next;
};

export const validateImageSelection = (
  files: readonly File[]
): { ok: true; file: File } | { ok: false; message: string } => {
  if (files.length === 0) {
    return { ok: false, message: 'Choose one JPEG, PNG, or WebP image.' };
  }
  if (files.length !== 1) {
    return { ok: false, message: 'Choose exactly one image.' };
  }
  const file = files[0];
  if (!file) {
    return { ok: false, message: 'Choose one JPEG, PNG, or WebP image.' };
  }
  if (file.size === 0) {
    return { ok: false, message: 'Image must not be empty.' };
  }
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return {
      ok: false,
      message: 'Image must be a JPEG, PNG, or WebP file.',
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: 'Image must be 10 MiB or smaller.' };
  }
  return { ok: true, file };
};
