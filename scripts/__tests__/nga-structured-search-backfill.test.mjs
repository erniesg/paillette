import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStructuredMetadataUpdateSql,
  canonicalClassification,
  deriveMediumFamily,
  mergeAuthoritativeRecords,
  enrichVectorLine,
} from '../lib/nga-structured-search-backfill.mjs';

test('normalizes bounded NGA classification and medium vocabularies', () => {
  assert.equal(
    canonicalClassification('drawing', 'Index of American Design'),
    'Drawing'
  );
  assert.equal(canonicalClassification(null, 'Paintings'), 'Painting');
  assert.equal(
    canonicalClassification(null, 'Index of American Design'),
    'Drawing'
  );
  assert.equal(
    deriveMediumFamily(null, 'Watercolour and graphite on paper'),
    'watercolor'
  );
  assert.equal(deriveMediumFamily(null, 'Etching and engraving'), 'etching');
});

test('uses fallback records only when an id is absent from the fresh manifest', () => {
  assert.deepEqual(
    mergeAuthoritativeRecords(
      [{ id: 'fresh', year: 1500 }],
      [
        { id: 'fresh', year: 1400 },
        { id: 'stale', year: 1450 },
      ]
    ),
    [
      { id: 'fresh', year: 1500 },
      { id: 'stale', year: 1450 },
    ]
  );
});

test('enriches vector metadata without changing id or values', () => {
  const original = {
    id: 'open-access-art:nga:713',
    values: [0.1, 0.2, 0.3],
    metadata: { provider: 'nga', classification: 'Print', custom: 'kept' },
  };
  const record = {
    id: original.id,
    year: 1513,
    year_start: 1510,
    year_end: 1515,
    date_text: '1510/1515',
    medium: 'woodcut on laid paper',
    classification: 'Print',
    visual_classification: 'print',
    primary_artist_id: 'artist-42',
  };

  const enriched = JSON.parse(
    enrichVectorLine(JSON.stringify(original), record)
  );
  assert.equal(enriched.id, original.id);
  assert.deepEqual(enriched.values, original.values);
  assert.deepEqual(enriched.metadata, {
    provider: 'nga',
    classification: 'Print',
    custom: 'kept',
    catalogueClassification: 'Print',
    yearStart: 1510,
    yearEnd: 1515,
    mediumFamily: 'woodcut',
    primaryArtistId: 'artist-42',
  });
});

test('builds metadata-only D1 updates that cannot overwrite asset fields', () => {
  const sql = buildStructuredMetadataUpdateSql({
    id: 'open-access-art:nga:713',
    year: 1513,
    year_start: 1510,
    year_end: 1515,
    date_text: '1510/1515',
    medium: 'woodcut on laid paper',
    classification: 'Print',
    subclassification: 'Religious',
    visual_classification: 'print',
    primary_artist_id: 'artist-42',
  });

  assert.match(sql, /UPDATE artworks SET/);
  assert.match(sql, /year_start = 1510/);
  assert.match(sql, /medium_family = 'woodcut'/);
  assert.doesNotMatch(sql, /image_url|thumbnail_url|custom_metadata/);
});

test('derives hard-search dates from authoritative display text', () => {
  const vector = JSON.parse(
    enrichVectorLine(
      JSON.stringify({ id: 'open-access-art:nga:139753', values: [0.1] }),
      {
        id: 'open-access-art:nga:139753',
        year: 1610,
        year_start: 1610,
        year_end: 1690,
        date_text: 'c. 1630',
      }
    )
  );
  assert.equal(vector.metadata.yearStart, 1630);
  assert.equal(vector.metadata.yearEnd, 1630);
});

test('parses display ranges, decades, and qualified centuries for hard search', () => {
  const cases = [
    ['c. 1783/1784', 1783, 1784],
    ['1640s', 1640, 1649],
    ['probably late 17th century', 1667, 1699],
    ['17th or 18th century', 1600, 1799],
    ['fourth quarter 18th century', 1775, 1799],
  ];
  for (const [dateText, startYear, endYear] of cases) {
    const sql = buildStructuredMetadataUpdateSql({
      id: `open-access-art:nga:${dateText}`,
      year: 1200,
      year_start: 1200,
      year_end: 2000,
      date_text: dateText,
    });
    assert.match(sql, new RegExp(`year_start = ${startYear}`));
    assert.match(sql, new RegExp(`year_end = ${endYear}`));
  }
});

test('does not turn broad fallback years into hard constraints when display text is unknown', () => {
  const sql = buildStructuredMetadataUpdateSql({
    id: 'open-access-art:nga:unknown-date',
    year: 1610,
    year_start: 1610,
    year_end: 1690,
    date_text: 'date unknown',
  });
  assert.match(sql, /year_start = NULL/);
  assert.match(sql, /year_end = NULL/);
});

test('preserves explicit slash date intervals from fallback metadata', () => {
  const sql = buildStructuredMetadataUpdateSql({
    id: 'open-access-art:nga:3838',
    year: 1450,
    date_text: '1450/1470',
    classification: 'Print',
    medium: 'woodcut',
  });
  assert.match(sql, /year_start = 1450/);
  assert.match(sql, /year_end = 1470/);
});
