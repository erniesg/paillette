import { describe, expect, it } from 'vitest';
import {
  getDominantSourceLabel,
  getGeneratedCaptionText,
  getPublicCatalogueRows,
  getPublicCitation,
  getPublicCitationParts,
  getPublicDescription,
  getPublicDescriptionDetailList,
  getPublicDescriptionDetails,
  getPublicImageUrl,
  getPublicThumbnailUrl,
  getPublicTitle,
  getRootsUrl,
  hasPublicSourceMismatch,
} from '../public-artwork-metadata';

describe('getPublicDescription', () => {
  it('uses source catalogue text from NGS records', () => {
    expect(
      getPublicDescription({
        metadata: {
          source_records: {
            ngs: {
              objDescriptionClb:
                'An NGS catalogue caption about the artwork and its context.',
            },
          },
        },
      })
    ).toBe('An NGS catalogue caption about the artwork and its context.');
  });

  it('uses source catalogue text from NHB Roots records', () => {
    expect(
      getPublicDescription({
        metadata: {
          sourceRecords: {
            roots: {
              description: 'A Roots description supplied by the public record.',
            },
          },
        },
      })
    ).toBe('A Roots description supplied by the public record.');
  });

  it('prefers NGS and NHB source fields over top-level metadata', () => {
    expect(
      getPublicDescription({
        description: 'The curated artwork description.',
        metadata: {
          source_records: {
            ngs: {
              objDescriptionClb: 'Nested source text.',
            },
          },
        },
      })
    ).toBe('Nested source text.');
  });

  it('ignores internal catalogue boilerplate', () => {
    expect(
      getPublicDescription({
        metadata: {
          description: 'DO NOT REPRODUCE',
          source_records: {
            ngs: {
              objDescriptionClb: 'A public-facing catalogue caption.',
            },
          },
        },
      })
    ).toBe('A public-facing catalogue caption.');
  });

  it('reports stored NGS source data for raw NGS catalogue text', () => {
    expect(
      getPublicDescriptionDetails({
        metadata: {
          source_records: {
            ngs: {
              objDescriptionClb: 'Public catalogue text.',
            },
          },
        },
      })
    ).toEqual({
      source: 'ngs',
      sourceLabel: 'National Gallery Singapore',
      text: 'Public catalogue text.',
    });
  });

  it('uses field source provenance for top-level catalogue text', () => {
    expect(
      getPublicDescriptionDetails({
        metadata: {
          description: 'Top-level public text from the catalogue.',
          field_sources: {
            description: 'ngs',
          },
        },
      })
    ).toEqual({
      source: 'metadata',
      sourceLabel: 'From National Gallery Singapore',
      text: 'Top-level public text from the catalogue.',
    });
  });

  it('does not treat an unlabelled metadata caption as catalogue text', () => {
    const artwork = {
      metadata: {
        caption:
          'A generated-looking caption stored in the legacy metadata caption field.',
        field_sources: {
          description: 'ngs',
        },
      },
    };

    expect(getPublicDescription(artwork)).toBeNull();
    expect(getGeneratedCaptionText(artwork)).toBeNull();
  });

  it('routes AI-labelled metadata captions to generated captions only', () => {
    const artwork = {
      metadata: {
        caption:
          'A machine-generated caption describing visible brushwork and colours.',
        field_sources: {
          caption: 'generated_caption',
        },
      },
    };

    expect(getGeneratedCaptionText(artwork)).toBe(
      'A machine-generated caption describing visible brushwork and colours.'
    );
    expect(getPublicDescription(artwork)).toBeNull();
  });

  it('keeps source-labelled metadata captions as catalogue text', () => {
    expect(
      getPublicDescriptionDetails({
        metadata: {
          caption: 'A Roots catalogue caption from the public record.',
          field_sources: {
            caption: 'roots',
          },
        },
      })
    ).toEqual({
      source: 'metadata',
      sourceLabel: 'From Roots NHB',
      text: 'A Roots catalogue caption from the public record.',
    });
  });

  it('reports source labels for public catalogue fields', () => {
    expect(
      getPublicCatalogueRows({
        artist: 'Lim Tze Peng',
        metadata: {
          date_text: '1975',
          medium: 'Ink and colour pigments on paper',
          field_sources: {
            artist: 'ngs',
            date_text: 'ngs',
            medium: 'ngs_artplus_catalog',
          },
        },
      }).slice(0, 3)
    ).toEqual([
      {
        label: 'Artist',
        value: 'Lim Tze Peng',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Date',
        value: '1975',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Medium',
        value: 'Ink and colour pigments on paper',
        sourceLabel: 'National Gallery Singapore',
      },
    ]);
  });

  it('keeps both NGS and Roots catalogue captions when both records match', () => {
    expect(
      getPublicDescriptionDetailList({
        title: 'Singapore',
        artist: 'John Turnbull Thomson',
        metadata: {
          source_records: {
            ngs: {
              objObjectTitleTxt: 'Singapore',
              artistAvailableNames: ['John Turnbull Thomson'],
              objDescriptionClb: 'NGS catalogue text.',
            },
            roots: {
              title: 'Singapore',
              creator: 'John Turnbull Thomson',
              caption: 'Roots catalogue text.',
            },
          },
        },
      })
    ).toEqual([
      {
        source: 'ngs',
        sourceLabel: 'National Gallery Singapore',
        text: 'NGS catalogue text.',
      },
      {
        source: 'roots',
        sourceLabel: 'Roots NHB',
        text: 'Roots catalogue text.',
      },
    ]);
  });

  it('labels a trusted Roots caption as Roots when the raw NGS payload duplicates it', () => {
    const rootsCaption =
      'Pech Song was commissioned to create paintings used as propaganda by successive Cambodian regimes.';

    expect(
      getPublicDescriptionDetailList({
        title:
          '7 Makara 1979 - 7 Makara 1984 (7 January 1979 - 7 January 1984)',
        artist: 'Pech Song',
        metadata: {
          field_sources: {
            description: 'roots',
          },
          source_records: {
            ngs: {
              objObjectTitleTxt:
                '7 Makara 1979 - 7 Makara 1984 (7 January 1979 - 7 January 1984)',
              artistAvailableNames: ['Pech Song'],
              objDescriptionClb: rootsCaption,
            },
            roots: {
              pageid: '1470665',
              caption: rootsCaption,
            },
          },
        },
      })
    ).toEqual([
      {
        source: 'roots',
        sourceLabel: 'Roots NHB',
        text: rootsCaption,
      },
    ]);
  });

  it('shows a verified Roots caption when the NGS record has no catalogue text', () => {
    const rootsCaption =
      'Born in 1923, Lim Tze Peng is largely a self-taught artist. Bali has remained a source of inspiration for generations of Singapore artists.';

    expect(
      getPublicDescriptionDetails({
        title: 'Untitled (Bali Scene)',
        artist: 'Lim Tze Peng',
        metadata: {
          field_sources: {
            description: 'roots',
          },
          source_records: {
            ngs: {
              objObjectTitleTxt: 'Untitled (Bali Scene)',
              artistAvailableNames: ['Lim Tze Peng'],
              objDescriptionClb: '',
            },
            roots: {
              pageid: '1034363',
              title: 'Untitled (Bali Scene)',
              caption: rootsCaption,
            },
          },
        },
      })
    ).toEqual({
      source: 'roots',
      sourceLabel: 'Roots NHB',
      text: rootsCaption,
    });
  });

  it('does not surface top-level Roots descriptions when the Roots record conflicts', () => {
    expect(
      getPublicDescriptionDetails({
        title: 'Singapore River',
        artist: 'Foo Chee San (1921-2017)',
        description:
          'This book is part of a collection owned by John Bastin, a renowned scholar and historian.',
        metadata: {
          field_sources: {
            description: 'roots',
          },
          source_records: {
            ngs: {
              objObjectTitleTxt: 'Singapore River',
              artistAvailableNames: ['Foo Chee San (1921-2017)'],
            },
            roots: {
              title: '‘The Singapore and Malayan Rough Diary for 1930’',
              caption:
                'This book is part of a collection owned by John Bastin, a renowned scholar and historian.',
            },
          },
        },
      })
    ).toBeNull();
  });

  it('does not show internal facets as public NGS page fields', () => {
    const labels = getPublicCatalogueRows({
      classification: 'Paintings',
      culture: 'Modern',
      source_institution: 'National Gallery Singapore',
      source_collection: 'National Collection',
      metadata: {
        classification: 'Paintings',
        sourceInstitution: 'National Gallery Singapore',
        sourceCollection: 'National Collection',
      },
    }).map((row) => row.label);

    expect(labels).not.toContain('Classification');
    expect(labels).not.toContain('Culture');
    expect(labels).not.toContain('Source institution');
    expect(labels).not.toContain('Source collection');
  });

  it('builds an NGS-style Chicago citation from public fields', () => {
    expect(
      getPublicCitation({
        artist: 'Le Huy Toan',
        title: 'Not titled (Celebrating Victory at Dien Bien Phu)',
        metadata: {
          date_text: '1958',
          medium: 'Silk',
          dimensions_text: 'Image measure: 39.5 × 56 cm',
          source_institution: 'National Gallery Singapore',
        },
      })
    ).toBe(
      'Le Huy Toan. Not titled (Celebrating Victory at Dien Bien Phu). 1958. Silk, 39.5 x 56 cm. National Gallery Singapore, Singapore.'
    );
  });

  it('builds rich Chicago citation markup with an italic title', () => {
    expect(
      getPublicCitationParts({
        artist: 'Khalil Ibrahim Hj. Ibrahim',
        title: 'Monsoon',
        metadata: {
          date_text: '1989',
          medium: 'Watercolour on paper',
          source_institution: 'National Gallery Singapore',
        },
      }).htmlText
    ).toBe(
      'Khalil Ibrahim Hj. Ibrahim. <cite>Monsoon</cite>. 1989. Watercolour on paper. National Gallery Singapore, Singapore.'
    );
  });

  it('identifies the dominant source for catalogue fields', () => {
    expect(
      getDominantSourceLabel([
        {
          label: 'Artist',
          value: 'Devi Sita',
          sourceLabel: 'National Gallery Singapore',
        },
        {
          label: 'Date',
          value: 'Undated',
          sourceLabel: 'National Gallery Singapore',
        },
        {
          label: 'Medium',
          value: 'Ink and colour on paper',
          sourceLabel: 'National Gallery Singapore',
        },
      ])
    ).toBe('National Gallery Singapore');
  });

  it('prioritizes NGS record data and image over a conflicting Roots title', () => {
    const artwork = {
      id: '2010-01598',
      title: 'Singapore River',
      artist: 'Foo Chee San (1921-2017)',
      date_text: 'Undated',
      medium: 'Ink on paper',
      accession_number: '2010-01598',
      credit_line: 'Collection of National Gallery Singapore',
      source_institution: 'National Gallery Singapore',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/roots-diary/content',
      metadata: {
        ngs_image_url:
          'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/foo-chee-san/2010/2010-01598.tif',
        ngs_detail_url:
          'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/foo-chee-san/2010/2010-01598.tif.html',
        roots_listing_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1240385',
        source_records: {
          ngs: {
            objObjectTitleTxt: 'Singapore River',
            artistAvailableNames: ['Foo Chee San (1921-2017)'],
            objDateDatingTxt: 'Undated',
            objMaterialTechniqueTxt: 'Ink on paper',
            objAssociatedPlaceTxt: 'Singapore',
            objDescriptionClb:
              'An NGS catalogue caption about Singapore River.',
          },
          roots: {
            title: '‘The Singapore and Malayan Rough Diary for 1930’',
            caption:
              'This book is part of a collection owned by John Bastin, a renowned scholar and historian.',
            year_period: '1930',
            region: 'Singapore and Malaysia',
            object_type: 'books',
            material: 'ink, paper (fiber product)',
            technique: 'bookbinding (process), writing (processes)',
            dimension: 'Unknown Type: Refer to parts.',
            collection_of: 'National Museum of Singapore',
          },
        },
        generated_caption: {
          text: 'The verified facts provided for "Singapore River" by Foo Chee San are not related to the visual content of this image.',
        },
      },
    };

    expect(hasPublicSourceMismatch(artwork)).toBe(true);
    expect(getPublicTitle(artwork)).toBe('Singapore River');
    expect(getPublicImageUrl(artwork)).toBe(
      'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/foo-chee-san/2010/2010-01598.tif'
    );
    expect(getPublicThumbnailUrl(artwork)).toBe(
      'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/foo-chee-san/2010/2010-01598.tif'
    );
    expect(getRootsUrl(artwork)).toBeNull();
    expect(getPublicDescription(artwork)).toBe(
      'An NGS catalogue caption about Singapore River.'
    );
    expect(getPublicCitationParts(artwork).plainText).toBe(
      'Foo Chee San (1921-2017). Singapore River. Undated. Ink on paper. National Gallery Singapore, Singapore.'
    );
    expect(getPublicCatalogueRows(artwork)).toEqual([
      {
        label: 'Artist',
        value: 'Foo Chee San (1921-2017)',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Date',
        value: 'Undated',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Medium',
        value: 'Ink on paper',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Geographic association',
        value: 'Singapore',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Accession',
        value: '2010-01598',
        sourceLabel: 'National Gallery Singapore',
      },
      {
        label: 'Credit line',
        value: 'Collection of National Gallery Singapore',
        sourceLabel: 'National Gallery Singapore',
      },
    ]);
  });

  it('suppresses conflicting Roots imagery when no NGS image exists', () => {
    const artwork = {
      title: 'Singapore River',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/roots-diary/content',
      metadata: {
        source_records: {
          roots: {
            title: '‘The Singapore and Malayan Rough Diary for 1930’',
          },
        },
      },
    };

    expect(hasPublicSourceMismatch(artwork)).toBe(true);
    expect(getPublicImageUrl(artwork)).toBeNull();
    expect(getPublicThumbnailUrl(artwork)).toBeNull();
  });
});
