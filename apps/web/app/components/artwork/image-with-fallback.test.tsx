import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageWithFallback } from './image-with-fallback';

const fallback = <div>No image</div>;

describe('ImageWithFallback', () => {
  it('renders the fallback when no source is provided', () => {
    render(<ImageWithFallback src={null} alt="Artwork" fallback={fallback} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('replaces a failed image with the fallback', () => {
    render(
      <ImageWithFallback
        src="https://example.test/missing.jpg"
        alt="Artwork"
        fallback={fallback}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Artwork' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('tries the secondary source before showing the fallback', () => {
    render(
      <ImageWithFallback
        src="https://example.test/missing-thumb.webp"
        fallbackSrc="https://example.test/full.jpg"
        alt="Artwork"
        fallback={fallback}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Artwork' }));

    expect(screen.getByRole('img', { name: 'Artwork' })).toHaveAttribute(
      'src',
      'https://example.test/full.jpg'
    );
    expect(screen.queryByText('No image')).not.toBeInTheDocument();
  });

  it('shows the fallback after both sources fail', () => {
    render(
      <ImageWithFallback
        src="https://example.test/missing-thumb.webp"
        fallbackSrc="https://example.test/missing-full.jpg"
        alt="Artwork"
        fallback={fallback}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Artwork' }));
    fireEvent.error(screen.getByRole('img', { name: 'Artwork' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('retries when the source changes after a failed load', () => {
    const { rerender } = render(
      <ImageWithFallback
        src="https://example.test/missing.jpg"
        alt="Artwork"
        fallback={fallback}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Artwork' }));
    rerender(
      <ImageWithFallback
        src="https://example.test/available.jpg"
        alt="Artwork"
        fallback={fallback}
      />
    );

    expect(screen.getByRole('img', { name: 'Artwork' })).toHaveAttribute(
      'src',
      'https://example.test/available.jpg'
    );
  });
});
