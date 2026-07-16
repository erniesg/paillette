import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemArchitectureDiagram } from './system-architecture-diagram';

describe('SystemArchitectureDiagram', () => {
  it('names boundaries and exposes the complete text path', () => {
    render(<SystemArchitectureDiagram />);

    expect(
      screen.getByRole('figure', { name: /Paillette request architecture/i })
    ).toBeInTheDocument();

    for (const label of [
      'Remix web Worker',
      'Hono API Worker',
      'Vectorize · image/text',
      'Vectorize · captions',
      'D1 · metadata + usage',
      'R2 · image assets',
      'Jina embeddings',
      'Workers AI',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(9);
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringMatching(/submit/i),
      expect.stringMatching(/authenticate.*reserve/i),
      expect.stringMatching(/route/i),
      expect.stringMatching(/embed/i),
      expect.stringMatching(/retrieve/i),
      expect.stringMatching(/fuse/i),
      expect.stringMatching(/hydrate/i),
      expect.stringMatching(/record.*returns ranked results.*queryTime/i),
      expect.stringMatching(/load images/i),
    ]);
    expect(
      screen.getByText(/returns ranked results and queryTime/i)
    ).toBeInTheDocument();
  });
});
