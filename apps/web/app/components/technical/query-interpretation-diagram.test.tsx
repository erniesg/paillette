import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryInterpretationDiagram } from './query-interpretation-diagram';

describe('QueryInterpretationDiagram', () => {
  it('maps the five high-level query parts to how they are found', () => {
    render(<QueryInterpretationDiagram />);

    const figure = screen.getByRole('figure', {
      name: /what an nga query is deconstructed into/i,
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

  it('shows what every query part controls without inventing internal field names', () => {
    render(<QueryInterpretationDiagram />);

    for (const output of [
      'Semantic retrieval: ships',
      'Hard filters: Painting · oil',
      'Hard displayed-date range: 1000–1799',
      'Return paintings · require depicted sculpture',
      'Catalogue relation: attributed to Rembrandt',
    ]) {
      expect(screen.getByText(output)).toBeInTheDocument();
    }
  });
});
