import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryInterpretationDiagram } from './query-interpretation-diagram';

describe('QueryInterpretationDiagram', () => {
  it('maps the five high-level query parts to how they are found', () => {
    render(<QueryInterpretationDiagram />);

    const figure = screen.getByRole('figure', {
      name: /what a query is deconstructed into/i,
    });
    const table = within(figure).getByRole('table');

    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(5);

    for (const part of [
      'Descriptive meaning',
      'Catalogue metadata',
      'Displayed time',
      'Artwork relationship',
      'Artist attribution',
    ]) {
      expect(within(table).getByText(part)).toBeInTheDocument();
    }
  });

  it('shows a concrete emitted field for every query part', () => {
    render(<QueryInterpretationDiagram />);

    for (const output of [
      'retrievalQuery: “ships”',
      'classification: Painting',
      'medium: oil',
      'dateRange: 1000–1799',
      'return: Painting',
      'depicts: Sculpture',
      'relationship: attributed_to',
      'target: Rembrandt',
    ]) {
      expect(screen.getByText(output)).toBeInTheDocument();
    }
  });
});
