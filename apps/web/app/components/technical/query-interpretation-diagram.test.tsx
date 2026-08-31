import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryInterpretationDiagram } from './query-interpretation-diagram';

describe('QueryInterpretationDiagram', () => {
  it('explains each deterministic parser stage and the output it produces', () => {
    render(<QueryInterpretationDiagram />);

    const figure = screen.getByRole('figure', {
      name: /how the nga parser unpacks a query/i,
    });

    for (const stage of [
      'Normalize the string',
      'Parse displayed time',
      'Extract catalogue metadata',
      'Resolve artwork relationships',
      'Resolve artist attribution',
      'Build the semantic remainder',
      'Compile one search plan',
    ]) {
      expect(within(figure).getByText(stage)).toBeInTheDocument();
    }

    expect(
      within(figure).getByText(/unicode nfkd/i)
    ).toBeInTheDocument();
    for (const table of within(figure).getAllByRole('table')) {
      expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    }
    expect(within(figure).getAllByRole('rowheader')).toHaveLength(12);
    expect(
      within(figure).getByText(/controlled classification and medium vocabularies/i)
    ).toBeInTheDocument();
    expect(
      within(figure).getByText(/ambiguous relationship is left unresolved/i)
    ).toBeInTheDocument();
    expect(
      within(figure).getByText(/exact-year token is rejected when accession/i)
    ).toBeInTheDocument();
    expect(
      within(figure).getByText(/hybrid retrieval modes.*combine rankings with rrf/i)
    ).toBeInTheDocument();
  });

  it('traces metadata, temporal, semantic, relation, and attribution queries into concrete plans', () => {
    render(<QueryInterpretationDiagram />);

    expect(
      screen.getByText('oil paintings of ships before 1800')
    ).toBeInTheDocument();
    expect(
      screen.getByText('dateRange: 1000–1799')
    ).toBeInTheDocument();
    expect(screen.getByText('classification: Painting')).toBeInTheDocument();
    expect(screen.getByText('medium: oil')).toBeInTheDocument();
    expect(screen.getByText('retrievalQuery: “ships”')).toBeInTheDocument();

    expect(
      screen.getByText('painting showing a sculpture')
    ).toBeInTheDocument();
    expect(screen.getByText('Painting —depicts→ Sculpture')).toBeInTheDocument();
    expect(
      screen.getByText(/subject is evidence-checked, not returned as a sculpture result/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText('drawings attributed to Rembrandt')
    ).toBeInTheDocument();
    expect(
      screen.getByText('relationship: attributed_to')
    ).toBeInTheDocument();
    expect(screen.getByText('target: Rembrandt')).toBeInTheDocument();
    expect(
      screen.getByText(/catalogue attribution evidence is required/i)
    ).toBeInTheDocument();
  });
});
