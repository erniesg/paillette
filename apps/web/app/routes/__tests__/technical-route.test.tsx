import { render, screen } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('~/components/site/public-shell', () => ({
  PublicSiteHeader: () => <div data-testid="public-header" />,
  PublicSiteFooter: () => <div data-testid="public-footer" />,
}));

vi.mock('~/components/technical/system-architecture-diagram', () => ({
  SystemArchitectureDiagram: () => <div data-testid="architecture-diagram" />,
}));

let TechnicalPage: typeof import('../technical').default;
let RETRIEVAL_CHANNELS: typeof import('../technical').RETRIEVAL_CHANNELS;
let FUSED_RETRIEVAL_SOURCES: typeof import('../technical').FUSED_RETRIEVAL_SOURCES;
let TECHNICAL_EVIDENCE: typeof import('../technical').TECHNICAL_EVIDENCE;

beforeAll(async () => {
  const technicalRoute = await import('../technical');
  TechnicalPage = technicalRoute.default;
  RETRIEVAL_CHANNELS = technicalRoute.RETRIEVAL_CHANNELS;
  FUSED_RETRIEVAL_SOURCES = technicalRoute.FUSED_RETRIEVAL_SOURCES;
  TECHNICAL_EVIDENCE = technicalRoute.TECHNICAL_EVIDENCE;
});

it('separates retrieval channels and evidence levels', () => {
  expect(RETRIEVAL_CHANNELS.map((item) => item.name)).toEqual([
    'Keyword',
    'Metadata',
    'Captions',
    'Image embeddings',
    'Colour',
  ]);
  expect(TECHNICAL_EVIDENCE.map((item) => item.level)).toEqual([
    'Measured',
    'Test-backed',
    'Structural',
    'Pending',
  ]);
  expect(TECHNICAL_EVIDENCE[1].value).toBe('100 + 10');
  expect(TECHNICAL_EVIDENCE[2].value).toBe('2 × 1,024D');
  expect(TECHNICAL_EVIDENCE[3].value).toBe('p50 / p95 / p99');
  expect(TECHNICAL_EVIDENCE[3].description).toMatch(/not yet measured/i);
});

it('distinguishes five conceptual search modes from three current fusion sources', () => {
  render(<TechnicalPage />);

  expect(RETRIEVAL_CHANNELS).toHaveLength(5);
  expect(FUSED_RETRIEVAL_SOURCES).toEqual([
    'image_embedding',
    'generated_caption_embedding',
    'metadata',
  ]);
  expect(
    screen.getByText(/five user-facing search modes/i)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/not five separate RRF input lists/i)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/keyword matching runs within metadata retrieval/i)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/colour language and refinement affect routing/i)
  ).toBeInTheDocument();
  expect(screen.getByText('RRF_K = 60')).toBeInTheDocument();
});
