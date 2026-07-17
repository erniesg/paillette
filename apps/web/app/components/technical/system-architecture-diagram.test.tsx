import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemArchitectureDiagram } from './system-architecture-diagram';

describe('SystemArchitectureDiagram', () => {
  it('shows the complete system as concise labelled nodes', () => {
    render(<SystemArchitectureDiagram />);

    expect(
      screen.getByRole('figure', { name: /Paillette system architecture/i })
    ).toBeInTheDocument();

    for (const label of [
      'Visitor',
      'Remix web',
      'Hono API',
      'Jina / Workers AI',
      'Vectorize',
      'D1',
      'Artwork assets',
      'Ranked artworks',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not repeat the architecture as prose', () => {
    render(<SystemArchitectureDiagram />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/request lifecycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/routed hybrid/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/runtime boundaries/i)).not.toBeInTheDocument();
  });
});
