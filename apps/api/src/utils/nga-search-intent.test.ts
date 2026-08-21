import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  matchesNgaSearchConstraints,
  parseNgaSearchIntent,
} from './nga-search-intent';

type CorpusQuery = {
  id: string;
  text: string;
  startYear?: number;
  endYear?: number;
  classification?: string;
  medium?: string;
  semanticQuery?: string;
  ambiguous?: boolean;
};

const constraintCorpusPath = resolve(
  process.cwd(),
  '../../eval/nga-constraint-queries.yaml'
);

const splitInlineMap = (value: string): string[] => {
  const fields: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (value[index] === ',' && !quoted) {
      fields.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(value.slice(start).trim());
  return fields;
};

const loadConstraintCorpus = (): CorpusQuery[] =>
  readFileSync(constraintCorpusPath, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const inlineMap = line.match(/^\s*-\s*\{\s*(.*?)\s*\}\s*$/)?.[1];
      if (!inlineMap) return [];
      const fields = Object.fromEntries(
        splitInlineMap(inlineMap).map((field) => {
          const separator = field.indexOf(':');
          if (separator < 1) throw new Error(`Invalid corpus field: ${field}`);
          const key = field.slice(0, separator).trim();
          const rawValue = field.slice(separator + 1).trim();
          return [
            key,
            rawValue.startsWith('"') && rawValue.endsWith('"')
              ? rawValue.slice(1, -1)
              : rawValue,
          ];
        })
      );
      if (!fields.id || !fields.text) {
        throw new Error(`Corpus row requires id and text: ${line}`);
      }
      return [
        {
          id: fields.id,
          text: fields.text,
          ...(fields.startYear === undefined
            ? {}
            : { startYear: Number(fields.startYear) }),
          ...(fields.endYear === undefined
            ? {}
            : { endYear: Number(fields.endYear) }),
          ...(fields.classification === undefined
            ? {}
            : { classification: fields.classification }),
          ...(fields.medium === undefined ? {} : { medium: fields.medium }),
          ...(fields.semanticQuery === undefined
            ? {}
            : { semanticQuery: fields.semanticQuery }),
          ...(fields.ambiguous === undefined
            ? {}
            : { ambiguous: fields.ambiguous === 'true' }),
        },
      ];
    });

describe('parseNgaSearchIntent', () => {
  it('reports the nga-v4 parser contract', () => {
    expect(parseNgaSearchIntent('paintings').parserVersion).toBe('nga-v4');
  });

  it('ships a versioned evaluation corpus with at least 80 representative queries', () => {
    expect(loadConstraintCorpus().length).toBeGreaterThanOrEqual(80);
  });

  it('executes every declared evaluation-corpus expectation', () => {
    for (const queryCase of loadConstraintCorpus()) {
      const intent = parseNgaSearchIntent(queryCase.text);
      const expectedDate =
        queryCase.startYear === undefined
          ? undefined
          : {
              startYear: queryCase.startYear,
              endYear: queryCase.endYear!,
            };

      expect
        .soft(intent.constraints.dateRange, queryCase.id)
        .toEqual(expectedDate);
      expect
        .soft(intent.constraints.classifications, queryCase.id)
        .toEqual(
          queryCase.classification ? [queryCase.classification] : undefined
        );
      expect
        .soft(intent.constraints.mediumFamilies, queryCase.id)
        .toEqual(queryCase.medium ? [queryCase.medium] : undefined);
      if (queryCase.semanticQuery !== undefined) {
        expect
          .soft(intent.semanticQuery, queryCase.id)
          .toBe(queryCase.semanticQuery);
      }
      if (queryCase.ambiguous) {
        expect.soft(intent.constraints, queryCase.id).toEqual({});
      }
    }
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
    expect(parseNgaSearchIntent(query).constraints).toMatchObject({
      dateRange: { startYear, endYear },
      classifications,
    });
  });

  it.each([
    ['paintings from first half of 18th century', 1700, 1749, ['Painting']],
    [
      'paintings from the second half of eighteenth century',
      1750,
      1799,
      ['Painting'],
    ],
    [
      'drawings from first quarter of the XIX century',
      1800,
      1824,
      ['Drawing'],
    ],
    [
      'drawings from second quarter nineteenth century',
      1825,
      1849,
      ['Drawing'],
    ],
    ['drawings from third quarter 19th century', 1850, 1874, ['Drawing']],
    [
      'drawings from fourth quarter of the nineteenth century',
      1875,
      1899,
      ['Drawing'],
    ],
  ])(
    'parses century halves and quarters in %s',
    (query, startYear, endYear, classifications) => {
      const intent = parseNgaSearchIntent(query);

      expect(intent.constraints).toEqual({
        dateRange: { startYear, endYear },
        classifications,
      });
      expect(intent.semanticQuery).toBe('');
    }
  );

  it.each([
    [
      'paintings from the second half of the 18th century before 1780',
      1750,
      1779,
      ['Painting'],
    ],
    [
      'drawings from the first quarter of XIX century after 1810',
      1811,
      1824,
      ['Drawing'],
    ],
  ])(
    'intersects a parsed century period with numeric boundaries in %s',
    (query, startYear, endYear, classifications) => {
      const intent = parseNgaSearchIntent(query);

      expect(intent.constraints).toEqual({
        dateRange: { startYear, endYear },
        classifications,
      });
      expect(intent.semanticQuery).toBe('');
    }
  );

  it('fails closed when a century period contradicts its numeric boundary', () => {
    const intent = parseNgaSearchIntent(
      'paintings from the second half of 18th century before 1700'
    );

    expect(intent.constraints.dateRange).toBeUndefined();
    expect(intent.constraints.classifications).toEqual(['Painting']);
    expect(intent.semanticQuery).toBe(
      'second half 18th century before 1700'
    );
  });

  it('corrects safe controlled-vocabulary typos', () => {
    const intent = parseNgaSearchIntent('landscpae paintngs from 18th centry');
    expect(intent.constraints).toMatchObject({
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
    });
    expect(intent.semanticQuery).toBe('landscape');
    expect(intent.corrections).toEqual(
      expect.arrayContaining([
        { from: 'landscpae', to: 'landscape' },
        { from: 'paintngs', to: 'painting' },
        { from: 'centry', to: 'century' },
      ])
    );
  });

  it.each([
    [
      'religious paintings from 15th century',
      'religious biblical sacred scene',
    ],
    ['painting of a sculpture', 'painting depicting a sculpture'],
    ['works after Rembrandt', 'after rembrandt attribution'],
    ['Italian Renaissance drawings', 'italian renaissance 1400s 1500s'],
  ])(
    'adds soft retrieval context without hard-filtering %s',
    (query, semanticQuery) => {
      const intent = parseNgaSearchIntent(query);
      expect(intent.semanticQuery).toBe(semanticQuery);
      if (query === 'painting of a sculpture') {
        expect(intent.constraints.classifications).toBeUndefined();
      }
      if (query === 'works after Rembrandt') {
        expect(intent.constraints.dateRange).toBeUndefined();
      }
      if (query === 'Italian Renaissance drawings') {
        expect(intent.constraints.dateRange).toBeUndefined();
      }
    }
  );

  it.each([
    'painting of a sculpture',
    'works after Rembrandt',
    '18th-century style',
  ])('does not invent a hard constraint for ambiguous query %s', (query) => {
    const intent = parseNgaSearchIntent(query);
    if (query.includes('sculpture'))
      expect(intent.constraints.classifications).toBeUndefined();
    if (query.includes('Rembrandt'))
      expect(intent.constraints.dateRange).toBeUndefined();
  });

  it.each([
    ['photograph of a painting', 'photograph a painting'],
    ['drawing of a sculpture', 'drawing a sculpture'],
    ['painting depicting a photograph', 'painting depicting a photograph'],
    ['portrait photograph of a sculpture', 'portrait photograph a sculpture'],
    ['sculpture in a painting', 'sculpture a painting'],
    ['painting after a photograph', 'painting after a photograph'],
  ])(
    'keeps relational object types semantic for %s',
    (query, semanticQuery) => {
      const intent = parseNgaSearchIntent(query);
      expect(intent.constraints.classifications).toBeUndefined();
      expect(intent.semanticQuery).toBe(semanticQuery);
    }
  );

  it.each([
    ['painting showing a sculpture', 'painting showing a sculpture'],
    ['painting with a sculpture', 'painting with a sculpture'],
    ['sculpture depicted in a painting', 'sculpture depicted a painting'],
    ['drawing based on a photograph', 'drawing based on a photograph'],
    ['painting of the sculpture', 'painting sculpture'],
    ['sculpture depicted in the painting', 'sculpture depicted painting'],
  ])(
    'keeps adversarial relational types semantic for %s',
    (query, semanticQuery) => {
      const intent = parseNgaSearchIntent(query);
      expect(intent.constraints.classifications).toBeUndefined();
      expect(intent.semanticQuery).toBe(semanticQuery);
    }
  );

  it('preserves a multiword relational classification in the semantic query', () => {
    const intent = parseNgaSearchIntent('painting showing decorative art');
    expect(intent.constraints.classifications).toBeUndefined();
    expect(intent.semanticQuery).toBe('painting showing decorative art');
  });

  it.each([
    ['after 1700 before 1800 paintings', 1701, 1799],
    ['before 1800 after 1700 paintings', 1701, 1799],
  ])('intersects query boundaries in %s', (query, startYear, endYear) => {
    expect(parseNgaSearchIntent(query).constraints).toEqual({
      dateRange: { startYear, endYear },
      classifications: ['Painting'],
    });
  });

  it('keeps contradictory numeric boundaries semantic without inventing an exact-year fallback', () => {
    const intent = parseNgaSearchIntent(
      'after 1800 before 1700 paintings'
    );

    expect(intent.constraints.dateRange).toBeUndefined();
    expect(intent.constraints.classifications).toEqual(['Painting']);
    expect(intent.semanticQuery).toBe('after 1800 before 1700');
  });

  it.each([
    ['mid-19th century photographs', 1834, 1866, ['Photograph']],
    ['early-20th-century photographs', 1900, 1933, ['Photograph']],
  ])(
    'parses dash-separated temporal query %s',
    (query, startYear, endYear, classifications) => {
      expect(parseNgaSearchIntent(query).constraints).toMatchObject({
        dateRange: { startYear, endYear },
        classifications,
      });
    }
  );

  it('splits a word-separating dash without losing controlled vocabulary', () => {
    expect(
      parseNgaSearchIntent('Watercolour—drawings; early twentieth century')
        .constraints
    ).toEqual({
      dateRange: { startYear: 1900, endYear: 1933 },
      classifications: ['Drawing'],
      mediumFamilies: ['watercolor'],
    });
  });

  it('keeps a hyphenated century style semantic instead of making it a date', () => {
    const intent = parseNgaSearchIntent('18th-century style');
    expect(intent.constraints.dateRange).toBeUndefined();
    expect(intent.semanticQuery).toBe('18th century style');
  });

  it('uses explicit constraints without reparsing removed chips', () => {
    const intent = parseNgaSearchIntent('landscape', {
      dateRange: { startYear: 1700, endYear: 1799 },
    });
    expect(intent.semanticQuery).toBe('landscape');
    expect(intent.constraints.classifications).toBeUndefined();
  });
});

describe('matchesNgaSearchConstraints', () => {
  it('requires interval overlap and every hard facet', () => {
    const constraints = parseNgaSearchIntent(
      'oil paintings from 18th century'
    ).constraints;
    expect(
      matchesNgaSearchConstraints(
        {
          yearStart: 1695,
          yearEnd: 1710,
          classification: 'Painting',
          medium: 'oil on panel',
        },
        constraints
      )
    ).toBe(true);
    expect(
      matchesNgaSearchConstraints(
        {
          yearStart: 1800,
          yearEnd: 1810,
          classification: 'Painting',
          medium: 'oil on panel',
        },
        constraints
      )
    ).toBe(false);
    expect(
      matchesNgaSearchConstraints(
        {
          yearStart: 1750,
          yearEnd: 1750,
          classification: 'Drawing',
          medium: 'oil on panel',
        },
        constraints
      )
    ).toBe(false);
  });

  it('rejects a displayed date outside the requested range despite a broad stored range', () => {
    const constraints = parseNgaSearchIntent('Rembrandt, 1650').constraints;
    expect(
      matchesNgaSearchConstraints(
        {
          year: 1610,
          yearStart: 1610,
          yearEnd: 1690,
          dateText: 'c. 1630',
        },
        constraints
      )
    ).toBe(false);
    expect(
      matchesNgaSearchConstraints(
        {
          year: 1650,
          yearStart: 1610,
          yearEnd: 1690,
          dateText: '1650',
        },
        constraints
      )
    ).toBe(true);
  });

  it.each([
    ['first quarter 18th century', 1720, true],
    ['first quarter 18th century', 1750, false],
    ['fourth quarter 18th century', 1720, false],
    ['fourth quarter 18th century', 1780, true],
    ['2nd half of the 18th century', 1720, false],
    ['2nd half of the 18th century', 1775, true],
    ['after 1800, 17th century', 1650, false],
    ['after 1750, 18th century', 1750, false],
    ['after 1750, 18th century', 1751, true],
  ])(
    'matches displayed date %s against query year %i as %s',
    (dateText, year, expected) => {
      expect(
        matchesNgaSearchConstraints(
          { dateText },
          { dateRange: { startYear: year, endYear: year } }
        )
      ).toBe(expected);
    }
  );
});
