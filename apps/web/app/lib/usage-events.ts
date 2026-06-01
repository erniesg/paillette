export type PublicArtworkInteractionType =
  | 'view'
  | 'click'
  | 'download'
  | 'citation_copy';

export type PublicUsageEventPayload = {
  eventType?: 'search' | 'browse' | 'artwork_interaction';
  queryType?: string;
  orgId?: string;
  galleryId?: string;
  search?: Record<string, unknown>;
  interaction?: {
    type: PublicArtworkInteractionType;
    action?: string;
    artworkId: string;
    orgId?: string;
    galleryId?: string;
    rank?: number | null;
    score?: number | null;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
};

export const trackPublicUsageEvent = (
  orgId: string,
  payload: PublicUsageEventPayload
) => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = `/api/public-usage/${encodeURIComponent(orgId)}`;
  const body = JSON.stringify({
    eventType: 'artwork_interaction',
    ...payload,
  });

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      url,
      new Blob([body], { type: 'application/json' })
    );
    if (sent) {
      return;
    }
  }

  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch(() => undefined);
};
