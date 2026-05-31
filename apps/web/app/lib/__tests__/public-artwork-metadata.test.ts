import { describe, expect, it } from 'vitest';
import {
  getDominantSourceLabel,
  getGeneratedCaptionText,
  getPublicCatalogueRowGroups,
  getPublicCatalogueRows,
  getPublicCitation,
  getPublicCitationParts,
  getPublicDescription,
  getPublicDescriptionDetailList,
  getPublicDescriptionDetails,
  getPublicDimensionsText,
  getPublicImageUrl,
  getPublicThumbnailUrl,
  getPublicTitle,
  getRootsUrl,
  hasPublicSourceMismatch,
} from '../public-artwork-metadata';

describe('getPublicDescription', () => {
  it('does not expose NGS Art+ payload descriptions as public caption text', () => {
    expect(
      getPublicDescription({
        metadata: {
          source_records: {
            ngs: {
              objDescriptionClb:
                'An imported NGS Art+ payload description about the artwork.',
            },
          },
        },
      })
    ).toBeNull();
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

  it('decodes HTML entities in Roots catalogue text', () => {
    expect(
      getPublicDescription({
        metadata: {
          sourceRecords: {
            roots: {
              caption:
                'Collection of National Gallery Singapore. &#169; 1988 Eduardo Masferr&#233; Masferre &amp; family.',
            },
          },
        },
      })
    ).toBe(
      'Collection of National Gallery Singapore. © 1988 Eduardo Masferré Masferre & family.'
    );
  });

  it('repairs missing spaces between concatenated catalogue sentences', () => {
    expect(
      getPublicDescription({
        metadata: {
          sourceRecords: {
            roots: {
              caption:
                'Thang was President of the Modern Art Society Singapore (1981-93).Following his second solo exhibition, he continued painting.',
            },
          },
        },
      })
    ).toBe(
      'Thang was President of the Modern Art Society Singapore (1981-93). Following his second solo exhibition, he continued painting.'
    );
  });

  it('prefers Roots source fields over top-level metadata', () => {
    expect(
      getPublicDescription({
        description: 'The curated artwork description.',
        metadata: {
          source_records: {
            roots: {
              objDescriptionClb: 'Nested source text.',
              caption: 'Nested Roots source text.',
            },
          },
        },
      })
    ).toBe('Nested Roots source text.');
  });

  it('ignores internal catalogue boilerplate without falling back to NGS Art+ payload text', () => {
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
    ).toBeNull();
  });

  it('does not report stored NGS source data as public caption text', () => {
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
    ).toBeNull();
  });

  it('does not expose NGS-labelled top-level catalogue text as a public caption', () => {
    expect(
      getPublicDescriptionDetails({
        metadata: {
          description: 'Top-level public text from the catalogue.',
          field_sources: {
            description: 'ngs',
          },
        },
      })
    ).toBeNull();
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

  it('keeps Roots catalogue captions but hides matching NGS Art+ payload text', () => {
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

  it('prioritizes verified Roots catalogue text and hides a different NGS Art+ description', () => {
    const rootsCaption =
      'Tan Choon Ghee was born in Penang in 1930. He travelled to Singapore in the late 1940s to enrol at the Nanyang Academy of Fine Arts.';

    expect(
      getPublicDescriptionDetailList({
        title: '[Not titled] (Singapore, 1963)',
        artist: 'Tan Choon Ghee',
        metadata: {
          field_sources: {
            description: 'roots',
          },
          source_records: {
            ngs: {
              objObjectTitleTxt: '[Not titled] (Singapore, 1963)',
              artistAvailableNames: ['Tan Choon Ghee'],
              objDescriptionClb:
                'Tan Choon Gee made more than ten thousand sketches from life during his career.',
            },
            roots: {
              pageid: '1411600',
              title: 'Untitled (Singapore, 1963)',
              creator: 'Tan Choon Ghee',
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
    expect(getPublicDescription(artwork)).toBeNull();
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

  it('uses explicit NGS image metadata when the app asset fields are empty', () => {
    const artwork = {
      id: '2021-01174',
      title: 'Male Nudes',
      metadata: {
        ngs_image_url:
          'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/johan-rudolf-bonnet/2021/2021-01174(2).jpg',
        source_records: {
          ngs: {
            objObjectTitleTxt: 'Male Nudes',
            img: 'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/johan-rudolf-bonnet/2021/2021-01174(2).jpg',
          },
        },
      },
    };

    expect(getPublicImageUrl(artwork)).toBe(
      'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/johan-rudolf-bonnet/2021/2021-01174(2).jpg'
    );
    expect(getPublicThumbnailUrl(artwork)).toBe(
      'https://www.nationalgallery.sg/content/dam/national-collections-artworks/national-collection/johan-rudolf-bonnet/2021/2021-01174(2).jpg'
    );
  });

  it('does not suppress app assets for minor Roots title spelling differences', () => {
    const artwork = {
      id: 'GI-0405',
      title: 'Lillies with Carps',
      artist: 'Teng Nee Cheong (1951–2013)',
      medium: 'Watercolour on paper',
      field_sources: {
        title: 'ngs_artplus_catalog',
        artist: 'ngs_artplus_catalog',
        medium: 'ngs_artplus_catalog',
      },
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/bf72b916-8d6c-4c24-be94-8d8b496df029/content',
      metadata: {
        source_records: {
          roots: {
            title: 'Lilies with Carps',
            creator: 'Teng Nee Cheong',
          },
        },
      },
    };

    expect(hasPublicSourceMismatch(artwork)).toBe(false);
    expect(getPublicTitle(artwork)).toBe('Lilies with Carps');
    expect(getPublicImageUrl(artwork)).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/bf72b916-8d6c-4c24-be94-8d8b496df029/content'
    );
    expect(getPublicCatalogueRows(artwork)).toEqual([
      {
        label: 'Creator',
        value: 'Teng Nee Cheong',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Material',
        value: 'Watercolour on paper',
        sourceLabel: 'Roots NHB',
      },
    ]);
  });

  it('does not suppress app assets for harmless title article differences', () => {
    const artwork = {
      id: '1999-00334',
      title: 'Henri Listening to Birds',
      artist: 'Jimmy Ong  (1964–)',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/henri/content',
      metadata: {
        source_records: {
          roots: {
            title: 'Henri Listening to the Birds',
            creator: 'Jimmy Ong',
          },
        },
      },
    };

    expect(hasPublicSourceMismatch(artwork)).toBe(false);
    expect(getPublicImageUrl(artwork)).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/henri/content'
    );
  });

  it('does not suppress accession-matched Roots images and captions for title variants', () => {
    const artwork = {
      id: '2020-00222',
      title: 'Nude Woman',
      artist: 'Georgette Chen  (1906–1993)',
      accession_number: '2020-00222',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/a49cb2bf/content',
      metadata: {
        field_sources: {
          description: 'roots',
        },
        source_records: {
          roots: {
            title: 'Femme nue (Nude)',
            creator: 'Georgette Chen',
            accession: '2020-00222',
            caption: 'A Roots catalogue caption for the accession.',
          },
        },
      },
    };

    expect(hasPublicSourceMismatch(artwork)).toBe(false);
    expect(getPublicImageUrl(artwork)).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/a49cb2bf/content'
    );
    expect(getPublicDescriptionDetails(artwork)).toEqual({
      source: 'roots',
      sourceLabel: 'Roots NHB',
      text: 'A Roots catalogue caption for the accession.',
    });
  });

  it('builds separate metadata groups for accession-matched NGS and Roots title variants', () => {
    const groups = getPublicCatalogueRowGroups({
      id: '2020-00222',
      title: 'Nude Woman',
      artist: 'Georgette Chen  (1906–1993)',
      date_text: '1932',
      medium: 'Oil on canvas',
      accession_number: '2020-00222',
      field_sources: {
        title: 'ngs_artplus_catalog',
        artist: 'ngs_artplus_catalog',
        date_text: 'ngs_artplus_catalog',
        medium: 'ngs_artplus_catalog',
      },
      metadata: {
        source_records: {
          roots: {
            title: 'Femme nue (Nude)',
            creator: 'Georgette Chen',
            accession: '2020-00222',
            yearPeriod: '1932',
            material: 'Oil on canvas',
            collectionOf: 'National Gallery Singapore',
          },
        },
      },
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 'ngs',
      label: 'NGS',
      sourceLabel: 'National Gallery Singapore',
    });
    expect(groups[0]?.rows).toContainEqual({
      label: 'Title',
      value: 'Nude Woman',
      sourceLabel: 'National Gallery Singapore',
    });
    expect(groups[1]).toMatchObject({
      id: 'roots',
      label: 'Roots',
      sourceLabel: 'Roots NHB',
    });
    expect(groups[1]?.rows).toContainEqual({
      label: 'Title',
      value: 'Femme nue (Nude)',
      sourceLabel: 'Roots NHB',
    });
  });

  it('prefers rich Roots fields when no public NGS record exists', () => {
    const rows = getPublicCatalogueRows({
      id: 'GI-0340',
      title: 'Lotus',
      artist: 'Chew Hiong San',
      accession_number: 'GI-0340',
      field_sources: {
        title: 'ngs_artplus_catalog',
        artist: 'ngs_artplus_catalog',
        date_text: 'ngs_artplus_catalog',
        medium: 'ngs_artplus_catalog',
        dimensions: 'ngs_artplus_catalog',
      },
      metadata: {
        roots_listing_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1030221',
        source_records: {
          roots: {
            title: 'Lotus',
            creator: 'Chew Hiong San',
            accession: 'GI-0340',
            yearPeriod: '1989',
            region: 'Singapore',
            objectType: 'Painting',
            material: 'Chinese ink and colour on paper',
            dimension: 'Image size: 121 x 60 cm',
            collectionOf: 'National Gallery Singapore',
          },
        },
      },
    });

    expect(rows).toEqual([
      {
        label: 'Creator',
        value: 'Chew Hiong San',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Year/Period',
        value: '1989',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Region',
        value: 'Singapore',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Object type',
        value: 'Painting',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Material',
        value: 'Chinese ink and colour on paper',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Dimension',
        value: 'Image size: 121 x 60 cm',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Accession',
        value: 'GI-0340',
        sourceLabel: 'Roots NHB',
      },
      {
        label: 'Collection of',
        value: 'National Gallery Singapore',
        sourceLabel: 'Roots NHB',
      },
    ]);
  });

  it('cleans placeholder null tokens from NGS dimension summaries', () => {
    const artwork = {
      metadata: {
        dimensions_text: 'null 59 x 87 cm null',
        source_records: {
          ngs: {
            objDim2DGrp: [
              {
                type: 'Image measure',
                summary: 'null 59 x 87 cm null',
                firstNum: '59',
                secondNum: '87',
                unitVoc: 'cm',
              },
            ],
          },
        },
      },
    };

    expect(getPublicDimensionsText(artwork)).toBe(
      'Image measure: 59 x 87 cm'
    );
    expect(getPublicCatalogueRows(artwork)).toContainEqual({
      label: 'Dimensions',
      value: 'Image measure: 59 x 87 cm',
      sourceLabel: 'Public metadata',
    });
  });

  it('drops placeholder null dimension components without leaving dangling separators', () => {
    const artwork = {
      metadata: {
        source_records: {
          ngs: {
            objDim2DGrp: [
              {
                type: 'Image measure',
                summary: 'null 61 x 61 x null cm null',
                firstNum: '61',
                secondNum: '61',
                thirdNum: null,
                unitVoc: 'cm',
              },
            ],
          },
        },
      },
    };

    expect(getPublicDimensionsText(artwork)).toBe(
      'Image measure: 61 x 61 cm'
    );
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

  it('suppresses known NGS no-image placeholder assets', () => {
    const artwork = {
      id: '2021-00063',
      accession_number: '2021-00063',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/dca0630cea7e831915bf245ab93b3d7d/content',
      thumbnailUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/cb86db4e09cbfa701b2748803f503e30/content',
      metadata: {
        ngs_image_url:
          'https://www.nationalgallery.sg/content/dam/national-collections-artworks/external-loan-collection/vasan-sitthiket/2021/2021-00063_cropped.tif',
      },
    };

    expect(getPublicImageUrl(artwork)).toBeNull();
    expect(getPublicThumbnailUrl(artwork)).toBeNull();
  });
});
