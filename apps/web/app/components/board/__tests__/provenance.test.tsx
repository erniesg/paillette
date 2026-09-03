import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LightTableCard } from '../light-table-card';
import { markGlyph, markLabel, provenanceAttributes } from '../provenance';

describe('provenanceAttributes', () => {
  it('returns nothing for an unmarked card', () => {
    expect(provenanceAttributes(undefined)).toEqual({});
  });

  it('records the flag and the hand that made it', () => {
    expect(provenanceAttributes({ flag: 'pick', hand: 'human' })).toEqual({
      'data-flag': 'pick',
      'data-hand': 'human',
    });
  });

  it("draws the agent's unconfirmed mark as provisional", () => {
    expect(
      provenanceAttributes({ flag: 'pick', hand: 'agent', provisional: true })
    ).toEqual({
      'data-flag': 'pick',
      'data-hand': 'agent',
      'data-provisional': '',
    });
  });

  it('never treats a human mark as provisional', () => {
    // The human made it, so there is nobody left to confirm it. A dashed line
    // here would say the mark is waiting on something, and it is not.
    const attributes = provenanceAttributes({
      flag: 'reject',
      hand: 'human',
      provisional: true,
    });

    expect(attributes['data-provisional']).toBeUndefined();
  });

  it('flags a card the agent is currently touching', () => {
    expect(
      provenanceAttributes({ flag: 'pick', hand: 'agent' }, { agentActive: true })
    ).toMatchObject({ 'data-agent-active': '' });
  });
});

describe('mark descriptions', () => {
  it('uses Lightroom glyphs', () => {
    expect(markGlyph({ flag: 'pick', hand: 'human' })).toBe('P');
    expect(markGlyph({ flag: 'reject', hand: 'human' })).toBe('X');
  });

  it('says who marked it and why, because the ink is only visual', () => {
    expect(
      markLabel({
        flag: 'reject',
        hand: 'agent',
        provisional: true,
        reason: 'too busy for above a sofa',
      })
    ).toBe(
      'Rejected by the agent, not yet confirmed — too busy for above a sofa'
    );
  });

  it('describes a human mark plainly', () => {
    expect(markLabel({ flag: 'pick', hand: 'human' })).toBe('Picked by you');
  });
});

describe('LightTableCard', () => {
  const work = {
    id: 'w1',
    title: 'Lumber Schooners at Evening',
    artist: 'Fitz Henry Lane',
    dateText: '1860',
    accession: '1980.29.1',
    thumbnailUrl: 'https://example.test/thumb.jpg',
  };

  it('shows the work, its label and its catalogue line', () => {
    render(<LightTableCard work={work} rank={3} />);

    expect(screen.getByText('Lumber Schooners at Evening')).toBeVisible();
    expect(screen.getByText('Fitz Henry Lane')).toBeVisible();
    // The date is the more useful catalogue datum on a card this size, so it
    // takes the mono slot when a work has one.
    expect(screen.getByText('1860')).toBeVisible();
  });

  it('falls back to the accession number when a work is undated', () => {
    render(
      <LightTableCard work={{ ...work, dateText: undefined }} rank={3} />
    );
    expect(screen.getByText('1980.29.1')).toBeVisible();
  });

  it('falls back to the rank when a work has neither', () => {
    render(<LightTableCard work={{ id: 'w2', title: 'Untitled' }} rank={7} />);
    expect(screen.getByText('#07')).toBeVisible();
  });

  it('contains the image rather than cropping it', () => {
    // Cropping a work to fit a tidy grid is editing the evidence the human is
    // being asked to judge.
    render(<LightTableCard work={work} />);
    expect(screen.getByAltText(work.title)).toHaveClass('object-contain');
  });

  it("carries the agent's ink and dashes onto the tile", () => {
    const { container } = render(
      <LightTableCard
        work={work}
        mark={{ flag: 'pick', hand: 'agent', provisional: true, reason: 'warm' }}
        agentActive
      />
    );

    const slide = container.querySelector('.lt-slide');
    expect(slide).toHaveAttribute('data-flag', 'pick');
    expect(slide).toHaveAttribute('data-hand', 'agent');
    expect(slide).toHaveAttribute('data-provisional', '');
    expect(slide).toHaveAttribute('data-agent-active', '');
  });

  it('announces a mark that is otherwise only ink and dashes', () => {
    render(
      <LightTableCard
        work={work}
        mark={{ flag: 'pick', hand: 'agent', provisional: true, reason: 'warm' }}
      />
    );

    expect(
      screen.getByText('Picked by the agent, not yet confirmed — warm')
    ).toBeInTheDocument();
  });

  /*
   * The name of this test was already right and the assertion was wrong: it
   * required a *disabled button*, which is still a button and, worse, is not
   * a tab stop. That took the whole board out of the tab order and killed the
   * culling keys, which act on whichever card holds focus.
   *
   * With nothing to open there is no control, and the card carries the tab
   * stop itself.
   */
  it('is not a button when there is nothing to open', () => {
    render(<LightTableCard work={work} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('tabindex', '0');
    // Named by the work, so a screen reader reaching the card knows which one
    // the culling keys are about to act on.
    expect(card).toHaveAccessibleName(
      'Lumber Schooners at Evening — Fitz Henry Lane'
    );
  });

  it('offers exactly one control when there is something to open', () => {
    render(<LightTableCard work={work} onSelect={() => {}} />);

    const open = screen.getByRole('button');
    expect(open).toBeEnabled();
    expect(open).toHaveAccessibleName(/^Open /);
  });
});
