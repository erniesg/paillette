import { describe, expect, it } from 'vitest';
import {
  getDominantSourceLabel,
  getPublicCatalogueRows,
  getPublicCitation,
  getPublicCitationParts,
  getPublicDescription,
  getPublicDescriptionDetails,
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
});
