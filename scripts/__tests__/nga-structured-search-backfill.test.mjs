import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStructuredMetadataUpdateSql,
  canonicalClassification,
  deriveMediumFamily,
  enrichVectorLine,
} from '../lib/nga-structured-search-backfill.mjs';

test('normalizes bounded NGA classification and medium vocabularies', () => {
  assert.equal(canonicalClassification('drawing', 'Index of American Design'), 'Drawing');
  assert.equal(canonicalClassification(null, 'Paintings'), 'Painting');
  assert.equal(deriveMediumFamily(null, 'Watercolour and graphite on paper'), 'watercolor');
  assert.equal(deriveMediumFamily(null, 'Etching and engraving'), 'etching');
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
    medium: 'woodcut on laid paper',
    classification: 'Print',
    visual_classification: 'print',
    primary_artist_id: 'artist-42',
  };

  const enriched = JSON.parse(enrichVectorLine(JSON.stringify(original), record));
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
