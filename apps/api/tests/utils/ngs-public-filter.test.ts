import { describe, expect, it } from 'vitest';
import {
  BACKABLE_NGS_PUBLIC_ARTWORK_SQL,
  PUBLIC_ARTWORK_SQL,
  isHiddenNgsPublicAccession,
} from '../../src/utils/ngs-public-filter';

describe('isHiddenNgsPublicAccession', () => {
  it('hides Roots-only museum accessions and GI AB suffix records', () => {
    expect(
      isHiddenNgsPublicAccession(
        'AB2004-00006',
        'https://www.roots.gov.sg/Collection-Landing/listing/1030018'
      )
    ).toBe(true);
    expect(
      isHiddenNgsPublicAccession(
        'HP-0126',
        'https://www.roots.gov.sg/Collection-Landing/listing/1129656'
      )
    ).toBe(true);
    expect(
      isHiddenNgsPublicAccession(
        'Gi-0007-(AB)',
        'https://www.roots.gov.sg/Collection-Landing/listing/1202039'
      )
    ).toBe(true);
    expect(
      isHiddenNgsPublicAccession(
        '2013-00591',
        'https://www.roots.gov.sg/Collection-Landing/listing/1284239'
      )
    ).toBe(true);
  });

  it('keeps NGS accessions and non-Roots sources', () => {
    expect(
      isHiddenNgsPublicAccession(
        '2013-00170',
        'https://www.roots.gov.sg/Collection-Landing/listing/1271927'
      )
    ).toBe(false);
    expect(
      isHiddenNgsPublicAccession(
        'GI-0202-(PC)',
        'https://www.roots.gov.sg/Collection-Landing/listing/1016995'
      )
    ).toBe(false);
    expect(
      isHiddenNgsPublicAccession(
        'AB2004-00006',
        'https://www.nationalgallery.sg/example'
      )
    ).toBe(false);
  });

  it('keeps generic public filtering separate from NGS source labels', () => {
    expect(PUBLIC_ARTWORK_SQL).toContain('source_url IS NOT NULL');
    expect(PUBLIC_ARTWORK_SQL).toContain(
      "UPPER(accession_number) LIKE '%-(AB)'"
    );
    expect(PUBLIC_ARTWORK_SQL).not.toContain(
      "source_institution = 'National Gallery Singapore'"
    );
    expect(BACKABLE_NGS_PUBLIC_ARTWORK_SQL).toContain(
      "source_institution = 'National Gallery Singapore'"
    );
  });
});
