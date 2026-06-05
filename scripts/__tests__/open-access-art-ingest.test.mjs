import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OPEN_ACCESS_ART_COLLECTION,
  OPEN_ACCESS_PROVIDER_PRESETS,
  buildDryRunManifest,
  estimateOpenAccessCosts,
  normalizeArticArtwork,
  normalizeClevelandArtwork,
  normalizeMetArtwork,
  normalizeNgaArtwork,
  openAccessArtworkId,
  summarizeCaptionCoverage,
} from '../lib/open-access-art-ingest.mjs';

describe('open access artwork normalization', () => {
  it('keeps the pilot source set focused on ArtIC and NGA', () => {
    assert.deepEqual(OPEN_ACCESS_PROVIDER_PRESETS.pilot, ['artic', 'nga']);
    assert.deepEqual(OPEN_ACCESS_PROVIDER_PRESETS['full-v1'], [
      'met',
      'artic',
      'cleveland',
      'nga',
    ]);
  });

  it('builds deterministic provider-scoped artwork ids', () => {
    assert.equal(
      openAccessArtworkId('met', 12345),
      'open-access-art:met:12345'
    );
    assert.equal(
      openAccessArtworkId('nga', ' 00007f61-4922 '),
      'open-access-art:nga:00007f61-4922'
    );
  });

  it('normalizes eligible Met public-domain image records without inventing captions', () => {
    const normalized = normalizeMetArtwork({
      objectID: 12345,
      isPublicDomain: true,
      primaryImage: 'https://images.metmuseum.org/foo.jpg',
      primaryImageSmall: 'https://images.metmuseum.org/foo-small.jpg',
      objectURL: 'https://www.metmuseum.org/art/collection/search/12345',
      title: 'A Bowl',
      artistDisplayName: 'Unknown maker',
      objectDate: '18th century',
      objectBeginDate: 1750,
      medium: 'Porcelain',
      classification: 'Ceramics',
      culture: 'Chinese',
      country: 'China',
      department: 'Asian Art',
      accessionNumber: '1970.1',
      creditLine: 'Gift',
    });

    assert.equal(normalized?.id, 'open-access-art:met:12345');
    assert.equal(normalized?.collection_id, OPEN_ACCESS_ART_COLLECTION.slug);
    assert.equal(normalized?.source_institution, 'The Metropolitan Museum of Art');
    assert.equal(normalized?.source_record_id, '12345');
    assert.equal(normalized?.image_url, 'https://images.metmuseum.org/foo.jpg');
    assert.equal(normalized?.thumbnail_url, 'https://images.metmuseum.org/foo-small.jpg');
    assert.equal(normalized?.rights, 'Public Domain / CC0');
    assert.equal(normalized?.caption.hasInstitutionCaption, false);
  });

  it('rejects Met records without public-domain image eligibility', () => {
    assert.equal(
      normalizeMetArtwork({ objectID: 1, isPublicDomain: false, primaryImage: 'x' }),
      null
    );
    assert.equal(normalizeMetArtwork({ objectID: 1, isPublicDomain: true }), null);
  });

  it('normalizes ArtIC public-domain image records and strips HTML descriptions', () => {
    const normalized = normalizeArticArtwork({
      id: 27992,
      is_public_domain: true,
      image_id: 'abc123',
      title: 'The Child',
      artist_display: 'Mary Cassatt',
      date_display: '1890',
      date_start: 1890,
      medium_display: 'Oil on canvas',
      classification_title: 'Painting',
      place_of_origin: 'United States',
      credit_line: 'Museum purchase',
      main_reference_number: '1900.1',
      description: '<p>A short curatorial caption.</p>',
    });

    assert.equal(normalized?.id, 'open-access-art:artic:27992');
    assert.equal(normalized?.source_institution, 'Art Institute of Chicago');
    assert.equal(
      normalized?.image_url,
      'https://www.artic.edu/iiif/2/abc123/full/843,/0/default.jpg'
    );
    assert.equal(normalized?.description, 'A short curatorial caption.');
    assert.equal(normalized?.caption.hasInstitutionCaption, true);
  });

  it('normalizes Cleveland CC0 image records with description coverage', () => {
    const normalized = normalizeClevelandArtwork({
      id: 94979,
      title: 'Nathaniel Hurd',
      creators: [{ description: 'John Singleton Copley (American)' }],
      creation_date: '1765',
      creation_date_earliest: 1765,
      technique: 'Oil on canvas',
      type: 'Painting',
      culture: ['America'],
      url: 'https://www.clevelandart.org/art/1925.315',
      accession_number: '1925.315',
      creditline: 'Purchase',
      image_web: 'https://openaccess-cdn.clevelandart.org/web.jpg',
      images: {
        web: { url: 'https://openaccess-cdn.clevelandart.org/web-from-images.jpg' },
        print: { url: 'https://openaccess-cdn.clevelandart.org/print.jpg' },
      },
      description: 'A descriptive museum text.',
      share_license_status: 'CC0',
    });

    assert.equal(normalized?.id, 'open-access-art:cleveland:94979');
    assert.equal(normalized?.source_institution, 'Cleveland Museum of Art');
    assert.equal(
      normalized?.image_url,
      'https://openaccess-cdn.clevelandart.org/print.jpg'
    );
    assert.equal(
      normalized?.thumbnail_url,
      'https://openaccess-cdn.clevelandart.org/web.jpg'
    );
    assert.equal(normalized?.caption.hasInstitutionCaption, true);
  });

  it('normalizes NGA open-access IIIF image rows with assistive text captions', () => {
    const normalized = normalizeNgaArtwork({
      object: {
        objectid: '17387',
        title: 'Two Jugs',
        attribution: 'American 19th Century',
        displaydate: 'c. 1850',
        beginyear: '1850',
        medium: 'Stoneware',
        classification: 'Decorative Arts',
        creditline: 'Gift',
        accessionnum: '1942.1',
      },
      image: {
        uuid: '00007f61-4922-417b-8f27-893ea328206c',
        iiifurl:
          'https://api.nga.gov/iiif/00007f61-4922-417b-8f27-893ea328206c',
        iiifthumburl:
          'https://api.nga.gov/iiif/00007f61-4922-417b-8f27-893ea328206c/full/!200,200/0/default.jpg',
        openaccess: '1',
        depictstmsobjectid: '17387',
        assistivetext: 'The image shows two decorated ceramic jugs.',
      },
    });

    assert.equal(normalized?.id, 'open-access-art:nga:17387');
    assert.equal(normalized?.source_institution, 'National Gallery of Art, Washington');
    assert.equal(
      normalized?.image_url,
      'https://api.nga.gov/iiif/00007f61-4922-417b-8f27-893ea328206c/full/843,/0/default.jpg'
    );
    assert.equal(normalized?.description, 'The image shows two decorated ceramic jugs.');
    assert.equal(normalized?.caption.sourceField, 'assistivetext');
  });
});

describe('open access captions and cost estimates', () => {
  it('summarizes caption gaps without treating metadata as a caption', () => {
    assert.deepEqual(
      summarizeCaptionCoverage([
        { caption: { hasInstitutionCaption: true } },
        { caption: { hasInstitutionCaption: false } },
        { caption: null },
      ]),
      {
        total: 3,
        withInstitutionCaption: 1,
        missingInstitutionCaption: 2,
      }
    );
  });

  it('estimates pilot-scale storage and vector costs from configurable assumptions', () => {
    const estimate = estimateOpenAccessCosts({
      artworkCount: 100_000,
      captionVectorCount: 25_000,
      monthlyVectorQueries: 100_000,
      thumbnailKilobytes: 100,
      webImageKilobytes: 500,
      jinaTilesPerImage: 1,
    });

    assert.equal(estimate.jina.imageEmbeddingTokens, 400_000_000);
    assert.equal(estimate.vectorize.imageStoredDimensions, 102_400_000);
    assert.equal(estimate.vectorize.captionStoredDimensions, 19_200_000);
    assert.equal(estimate.r2.totalGigabytes.toFixed(2), '57.22');
    assert.ok(estimate.vectorize.estimatedMonthlyUsd > 0);
  });

  it('builds a dry-run manifest with source counts, caption gaps, and costs', () => {
    const manifest = buildDryRunManifest({
      generatedAt: '2026-06-05T00:00:00.000Z',
      providers: [
        {
          provider: 'met',
          candidateCount: 2,
          normalizedSamples: [
            { id: 'open-access-art:met:1', caption: { hasInstitutionCaption: false } },
            { id: 'open-access-art:met:2', caption: { hasInstitutionCaption: false } },
          ],
          skipped: [{ reason: 'missing_image' }],
        },
        {
          provider: 'artic',
          candidateCount: 1,
          normalizedSamples: [
            { id: 'open-access-art:artic:1', caption: { hasInstitutionCaption: true } },
          ],
          skipped: [],
        },
      ],
    });

    assert.equal(manifest.collection.slug, 'open-access-art');
    assert.equal(manifest.totals.candidateCount, 3);
    assert.equal(manifest.totals.sampleCaptionCoverage.withInstitutionCaption, 1);
    assert.equal(manifest.totals.sampleCaptionCoverage.missingInstitutionCaption, 2);
    assert.equal(manifest.providers.met.skippedCount, 1);
    assert.equal(manifest.costs.jina.imageEmbeddingTokens, 12_000);
  });
});
