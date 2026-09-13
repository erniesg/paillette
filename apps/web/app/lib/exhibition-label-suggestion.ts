/**
 * The one-work version of the public wall-label writer.
 *
 * The service already grounds labels in the collection record (and its stored
 * vision caption where available). This small boundary deliberately accepts
 * only the requested work back: a response for another work is never a
 * suggestion for the label currently being edited.
 */

export const LABEL_SUGGESTION_MAX_CHARS = 320;

export class LabelSuggestionError extends Error {}

type LabelResponse = {
  success?: unknown;
  data?: {
    labels?: unknown;
  };
};

const labelFor = (payload: unknown, artworkId: string): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as LabelResponse;
  if (envelope.success !== true || !envelope.data || !Array.isArray(envelope.data.labels)) {
    return null;
  }

  const entry = envelope.data.labels.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      (candidate as { artworkId?: unknown }).artworkId === artworkId
  ) as { label?: unknown } | undefined;
  if (!entry || typeof entry.label !== 'string') return null;
  const label = entry.label.trim();
  return label && label.length <= LABEL_SUGGESTION_MAX_CHARS ? label : null;
};

export const requestLabelSuggestion = async ({
  collectionId,
  artworkId,
  exhibitionTitle,
  exhibitionStatement,
  signal,
}: {
  collectionId: string;
  artworkId: string;
  exhibitionTitle: string;
  exhibitionStatement: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const response = await fetch('/api/public-labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionId,
      artworkIds: [artworkId],
      title: exhibitionTitle,
      statement: exhibitionStatement,
    }),
    signal,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LabelSuggestionError('The label service returned an invalid response.');
  }
  const label = response.ok ? labelFor(payload, artworkId) : null;
  if (!label) throw new LabelSuggestionError('The label service returned no usable label.');
  return label;
};
