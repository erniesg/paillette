import { describe, expect, it } from 'vitest';
import { shouldHidePublicArtworkDetail } from '../$orgId.artworks.$artworkId';

describe('shouldHidePublicArtworkDetail', () => {
  it('hides Roots-only museum accessions on the NGS public detail route', () => {
    expect(
      shouldHidePublicArtworkDetail('ngs', 'ngs', {
        accession_number: 'HP-0126',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1129656',
      })
    ).toBe(true);
  });

  it('keeps the same accession visible outside the public NGS route', () => {
    expect(
      shouldHidePublicArtworkDetail('demo', 'demo', {
        accession_number: 'HP-0126',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1129656',
      })
    ).toBe(false);
  });
});
