import { describe, expect, it } from 'vitest';
import {
  getDominantSourceLabel,
  getPublicCatalogueRows,
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

  it('reports the public source for catalogue text', () => {
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
      sourceLabel: 'From National Gallery Singapore',
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
        sourceLabel: 'NGS Art+ catalogue',
      },
    ]);
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
          sourceLabel: 'NGS Art+ catalogue',
        },
      ])
    ).toBe('National Gallery Singapore');
  });
});
