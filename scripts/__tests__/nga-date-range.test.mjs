import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveNgaDisplayDateRange } from '@paillette/types/nga-date-range';

test('derives inclusive ranges for NGA displayed-date grammar', () => {
  const cases = [
    ['c. 1783/1784', { startYear: 1783, endYear: 1784 }],
    ['1640s', { startYear: 1640, endYear: 1649 }],
    ['first quarter 18th century', { startYear: 1700, endYear: 1724 }],
    ['fourth quarter 18th century', { startYear: 1775, endYear: 1799 }],
    ['2nd half of the 18th century', { startYear: 1750, endYear: 1799 }],
    ['late 18th/early 19th century', { startYear: 1767, endYear: 1833 }],
    ['17th or 18th century', { startYear: 1600, endYear: 1799 }],
    ['after 1750, before 1800', { startYear: 1751, endYear: 1799 }],
    ['after 1750, 18th century', { startYear: 1751, endYear: 1799 }],
  ];

  for (const [value, expected] of cases) {
    assert.deepEqual(deriveNgaDisplayDateRange(value), expected, value);
  }
});

test('fails closed for unknown and contradictory NGA displayed dates', () => {
  assert.equal(deriveNgaDisplayDateRange('date unknown'), null);
  assert.equal(deriveNgaDisplayDateRange('after 1800, before 1700'), null);
  assert.equal(deriveNgaDisplayDateRange('after 1800, 17th century'), null);
  assert.equal(deriveNgaDisplayDateRange('2nd century object number'), null);
});
