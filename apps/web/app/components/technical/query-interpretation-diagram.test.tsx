import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { QueryInterpretationDiagram } from './query-interpretation-diagram';

describe('QueryInterpretationDiagram', () => {
  it('makes every phrase in the primary query an explicit plan role', async () => {
    const user = userEvent.setup();
    render(<QueryInterpretationDiagram />);

    const ships = screen.getByRole('button', {
      name: /ships.*descriptive meaning/i,
    });
    const oil = screen.getByRole('button', { name: /oil.*medium filter/i });
    const date = screen.getByRole('button', {
      name: /before 1800.*displayed time/i,
    });

    expect(
      screen.getByRole('button', {
        name: /paintings.*classification filter/i,
      })
    ).toBeInTheDocument();
    expect(ships).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('region', { name: 'Descriptive meaning' })
    ).toHaveTextContent(/oil.*painting.*displayed-date constraints still apply/i);

    await user.click(oil);
    expect(oil).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('region', { name: 'Catalogue metadata' })
    ).toHaveTextContent(/oil stays relevant.*hard filter/i);

    await user.hover(date);
    expect(
      screen.getByRole('region', { name: 'Displayed time' })
    ).toHaveTextContent(/1000–1799/);
    await user.unhover(date);
    expect(
      screen.getByRole('region', { name: 'Catalogue metadata' })
    ).toHaveTextContent(/oil stays relevant/i);
  });

  it('uses alternate examples for mutually exclusive relationship and attribution modes', async () => {
    const user = userEvent.setup();
    render(<QueryInterpretationDiagram />);

    await user.click(
      screen.getByRole('tab', { name: 'Artwork relationship' })
    );
    expect(
      screen.getByRole('button', {
        name: /showing.*relationship connector/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Artwork relationship' })
    ).toHaveTextContent(/return paintings.*depicted sculpture/i);

    await user.click(screen.getByRole('tab', { name: 'Artist attribution' }));
    expect(
      screen.getByRole('button', {
        name: /by rembrandt.*artist attribution/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Artist attribution' })
    ).toHaveTextContent(/catalogue evidence.*rembrandt/i);
  });

  it('keeps the complete five-part reference collapsed until requested', async () => {
    const user = userEvent.setup();
    render(<QueryInterpretationDiagram />);

    const summary = screen.getByText('View all details');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');

    await user.click(summary);
    expect(details).toHaveAttribute('open');

    const table = within(details!).getByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(5);
  });
});
