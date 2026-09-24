/**
 * The one-work version of the public wall-label writer.
 *
 * The service already grounds labels in the collection record (and its stored
 * vision caption where available). This small boundary deliberately accepts
 * only the requested work back: a response for another work is never a
 * suggestion for the label currently being edited.
 */

export const LABEL_SUGGESTION_MAX_CHARS = 320;
export const LABEL_SUGGESTION_TIMEOUT_MS = 10_000;

export type LabelSuggestionErrorCode =
  | 'rate_limited'
  | 'unavailable'
  | 'not_authorized'
  | 'invalid_response';

export class LabelSuggestionError extends Error {
  constructor(readonly code: LabelSuggestionErrorCode) {
    super(code);
    this.name = 'LabelSuggestionError';
  }
}

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

const aborted = () => new DOMException('The request was aborted.', 'AbortError');

const statusError = (status: number): LabelSuggestionError => {
  if (status === 429) return new LabelSuggestionError('rate_limited');
  if (status === 401 || status === 403) return new LabelSuggestionError('not_authorized');
  return new LabelSuggestionError('unavailable');
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
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, LABEL_SUGGESTION_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  let response: Response;
  try {
    response = await fetch('/api/public-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collectionId,
        artworkIds: [artworkId],
        title: exhibitionTitle,
        statement: exhibitionStatement,
      }),
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted) throw aborted();
    throw new LabelSuggestionError('unavailable');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }

  if (!response.ok) throw statusError(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LabelSuggestionError('invalid_response');
  }
  const label = labelFor(payload, artworkId);
  if (!label) throw new LabelSuggestionError('invalid_response');
  return label;
};
