import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NoImagePlaceholder } from './no-image-placeholder';

describe('NoImagePlaceholder', () => {
  it('shows visible no-image text by default', () => {
    render(<NoImagePlaceholder />);

    expect(screen.getByText('No image')).toBeVisible();
  });

  it('can keep the label screen-reader only for compact slots', () => {
    render(<NoImagePlaceholder showLabel={false} />);

    expect(screen.getByText('No image')).toHaveClass('sr-only');
  });
});
