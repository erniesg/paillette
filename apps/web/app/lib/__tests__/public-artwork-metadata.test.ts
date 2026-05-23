import { describe, expect, it } from 'vitest';
import {
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
      sourceLabel: 'National Gallery Singapore source fields',
      text: 'Public catalogue text.',
    });
  });
});
