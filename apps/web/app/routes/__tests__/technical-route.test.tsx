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
let PERFORMANCE_METRICS: typeof import('../technical').PERFORMANCE_METRICS;

beforeAll(async () => {
  const technicalRoute = await import('../technical');
  TechnicalPage = technicalRoute.default;
  PERFORMANCE_METRICS = technicalRoute.PERFORMANCE_METRICS;
});

it('keeps performance to a compact four-number summary', () => {
  expect(PERFORMANCE_METRICS.map((item) => item.label)).toEqual([
    'p50',
    'p95',
    'p99',
    'Max tested throughput',
  ]);
});

it('renders the diagram and compact metrics without methodology prose', () => {
  render(<TechnicalPage />);

  expect(screen.getByTestId('architecture-diagram')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Performance' })).toBeInTheDocument();
  expect(screen.queryByText('Test-backed')).not.toBeInTheDocument();
  expect(screen.queryByText('Atomic daily quota boundary')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Retrieval and fusion' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Expected bottlenecks' })).not.toBeInTheDocument();
});
