import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders badge with text', () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByText(/test badge/i)).toBeInTheDocument();
  });

  it('accepts variant prop - default', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText(/default/i)).toBeInTheDocument();
  });

  it('accepts variant prop - secondary', () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    expect(screen.getByText(/secondary/i)).toBeInTheDocument();
  });

  it('accepts variant prop - destructive', () => {
    render(<Badge variant="destructive">Destructive</Badge>);
    expect(screen.getByText(/destructive/i)).toBeInTheDocument();
  });

  it('accepts variant prop - warning', () => {
    render(<Badge variant="warning">Warning</Badge>);
    expect(screen.getByText(/warning/i)).toBeInTheDocument();
  });

  it('accepts variant prop - success', () => {
    render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText(/success/i)).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    render(<Badge className="custom-class">Custom</Badge>);
    const badge = screen.getByText(/custom/i);
    expect(badge).toHaveClass('custom-class');
  });
});
