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
let TECHNICAL_MAIN_CLASS_NAME: typeof import('../technical').TECHNICAL_MAIN_CLASS_NAME;
let TECHNICAL_BODY_GROUP_CLASS_NAME: typeof import('../technical').TECHNICAL_BODY_GROUP_CLASS_NAME;

beforeAll(async () => {
  const technicalRoute = await import('../technical');
  TechnicalPage = technicalRoute.default;
  TECHNICAL_MAIN_CLASS_NAME = technicalRoute.TECHNICAL_MAIN_CLASS_NAME;
  TECHNICAL_BODY_GROUP_CLASS_NAME =
    technicalRoute.TECHNICAL_BODY_GROUP_CLASS_NAME;
});

it('matches the centered production About page layout', () => {
  expect(TECHNICAL_MAIN_CLASS_NAME).toBe(
    'mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20'
  );
  expect(TECHNICAL_BODY_GROUP_CLASS_NAME).toBe('mt-5 max-w-6xl space-y-5');
});

it('renders the architecture without an empty performance placeholder', () => {
  render(<TechnicalPage />);

  expect(screen.getByTestId('architecture-diagram')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Performance' })).toBeNull();
  expect(screen.queryByText('Staging run required')).toBeNull();
  expect(screen.queryByText('p50')).toBeNull();
  expect(screen.queryByText('Max tested throughput')).toBeNull();
  expect(document.querySelectorAll('main > section')).toHaveLength(1);
});
