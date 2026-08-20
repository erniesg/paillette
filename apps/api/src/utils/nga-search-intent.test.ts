import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchesNgaSearchConstraints, parseNgaSearchIntent } from './nga-search-intent';

describe('parseNgaSearchIntent', () => {
  it('ships a versioned evaluation corpus with at least 80 representative queries', () => {
    const corpus = readFileSync(
      resolve(process.cwd(), '../../eval/nga-constraint-queries.yaml'),
      'utf8'
    );
    expect(corpus.match(/^\s+- \{ id:/gm)?.length || 0).toBeGreaterThanOrEqual(80);
  });
  it.each([
    ['PAINTINGS FROM THE 18TH CENTURY', 1700, 1799, ['Painting']],
    ['paintings from eighteenth century', 1700, 1799, ['Painting']],
    ['paintings from XVIII century', 1700, 1799, ['Painting']],
    ['paintings from 1750s', 1750, 1759, ['Painting']],
    ['paintings between 1720 and 1780', 1720, 1780, ['Painting']],
    ['paintings around 1750', 1740, 1760, ['Painting']],
    ['early 18th century paintings', 1700, 1733, ['Painting']],
    ['mid 18th century paintings', 1734, 1766, ['Painting']],
    ['late 18th century paintings', 1767, 1799, ['Painting']],
  ])('parses %s', (query, startYear, endYear, classifications) => {
    expect(parseNgaSearchIntent(query).constraints).toMatchObject({ dateRange: { startYear, endYear }, classifications });
  });

  it('corrects safe controlled-vocabulary typos', () => {
    const intent = parseNgaSearchIntent('landscpae paintngs from 18th centry');
    expect(intent.constraints).toMatchObject({ dateRange: { startYear: 1700, endYear: 1799 }, classifications: ['Painting'] });
    expect(intent.semanticQuery).toContain('landscpae');
    expect(intent.corrections).toEqual(expect.arrayContaining([{ from: 'paintngs', to: 'painting' }, { from: 'centry', to: 'century' }]));
  });

  it.each(['painting of a sculpture', 'works after Rembrandt', '18th-century style'])('does not invent a hard constraint for ambiguous query %s', (query) => {
    const intent = parseNgaSearchIntent(query);
    if (query.includes('sculpture')) expect(intent.constraints.classifications).toBeUndefined();
    if (query.includes('Rembrandt')) expect(intent.constraints.dateRange).toBeUndefined();
  });

  it('uses explicit constraints without reparsing removed chips', () => {
    const intent = parseNgaSearchIntent('landscape', { dateRange: { startYear: 1700, endYear: 1799 } });
    expect(intent.semanticQuery).toBe('landscape');
    expect(intent.constraints.classifications).toBeUndefined();
  });
});

describe('matchesNgaSearchConstraints', () => {
  it('requires interval overlap and every hard facet', () => {
    const constraints = parseNgaSearchIntent('oil paintings from 18th century').constraints;
    expect(matchesNgaSearchConstraints({ yearStart: 1695, yearEnd: 1710, classification: 'Painting', medium: 'oil on panel' }, constraints)).toBe(true);
    expect(matchesNgaSearchConstraints({ yearStart: 1800, yearEnd: 1810, classification: 'Painting', medium: 'oil on panel' }, constraints)).toBe(false);
    expect(matchesNgaSearchConstraints({ yearStart: 1750, yearEnd: 1750, classification: 'Drawing', medium: 'oil on panel' }, constraints)).toBe(false);
  });
});
