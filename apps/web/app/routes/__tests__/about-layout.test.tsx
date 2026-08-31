import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@remix-run/react', () => ({
  Form: (props: ComponentProps<'form'>) => <form {...props} />,
  useActionData: () => undefined,
  useNavigation: () => ({ state: 'idle' }),
}));

vi.mock('~/components/site/public-shell', () => ({
  PublicSiteHeader: () => <div data-testid="public-header" />,
  PublicSiteFooter: () => <div data-testid="public-footer" />,
}));

vi.mock('~/components/technical/system-architecture-diagram', () => ({
  SystemArchitectureDiagram: () => <div data-testid="architecture-diagram" />,
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}));

import AboutPage, {
  ABOUT_BODY_GROUP_CLASS_NAME,
  ABOUT_MAIN_CLASS_NAME,
} from '../about';

describe('about page layout', () => {
  it('matches the centered production editorial frame', () => {
    expect(ABOUT_MAIN_CLASS_NAME).toBe(
      'mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20'
    );
    expect(ABOUT_BODY_GROUP_CLASS_NAME).toBe('mt-5 w-full space-y-5');
  });

  it('includes the system architecture in the About flow', () => {
    render(<AboutPage />);

    const heading = screen.getByRole('heading', {
      name: 'System architecture',
    });
    expect(heading.closest('section')).toHaveAttribute(
      'id',
      'technical-details'
    );
    expect(screen.getByTestId('architecture-diagram')).toBeInTheDocument();
    expect(screen.queryByText('Technical details')).toBeNull();

    const approachHeading = screen.getByRole('heading', { name: 'Approach' });
    expect(
      heading.compareDocumentPosition(approachHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('places illustrated query interpretation before the RRF approach', () => {
    render(<AboutPage />);

    const interpretationHeading = screen.getByRole('heading', {
      name: 'Query interpretation',
    });
    const approachHeading = screen.getByRole('heading', { name: 'Approach' });

    expect(
      interpretationHeading.compareDocumentPosition(approachHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByText(/all outputs compile into one search plan/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('figure', {
        name: /how the nga parser unpacks a query/i,
      })
    ).toBeInTheDocument();
  });

  it('states the NGA open-access scope alongside the existing sources', () => {
    render(<AboutPage />);

    expect(
      screen.getByRole('link', {
        name: 'National Gallery of Art, Washington',
      })
    ).toHaveAttribute(
      'href',
      'https://github.com/NationalGalleryOfArt/opendata'
    );
    expect(
      screen.getByText(/63,253 artwork records with an open-access/i)
    ).toBeInTheDocument();
  });

  it('keeps feedback on the same content width as the preceding sections', () => {
    render(<AboutPage />);

    const feedbackHeading = screen.getByRole('heading', { name: 'Feedback' });
    expect(feedbackHeading.nextElementSibling).toHaveClass(
      'mt-5',
      'w-full',
      'space-y-5'
    );
  });
});
