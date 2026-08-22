import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NGA_ARTIST_METADATA_KEY,
  buildNgaArtistMetadata,
  mergeNgaArtistCustomMetadata,
} from '../lib/nga-artist-metadata.mjs';

const artistRelationship = (overrides = {}) => ({
  objectid: '110821',
  constituentid: '23812',
  displayorder: '1',
  roletype: 'artist',
  role: 'artist',
  prefix: '',
  suffix: '',
  ...overrides,
});

const constituent = (overrides = {}) => ({
  constituentid: '23812',
  preferreddisplayname: 'Sadeler, Justus',
  forwarddisplayname: 'Justus Sadeler',
  ...overrides,
});

const build = (overrides = {}) =>
  buildNgaArtistMetadata({
    requiredObjectIds: new Set(['110821']),
    relationships: [artistRelationship()],
    constituents: [constituent()],
    alternativeNames: [],
    ...overrides,
  });

describe('NGA artist metadata normalization', () => {
  it('selects NGA display order and preserves every official artist role', () => {
    const result = buildNgaArtistMetadata({
      requiredObjectIds: new Set(['110821']),
      relationships: [
        {
          objectid: '110821',
          constituentid: '2402',
          displayorder: '2',
          roletype: 'artist',
          role: 'artist after',
          prefix: '',
          suffix: '',
        },
        artistRelationship(),
      ],
      constituents: [
        constituent(),
        {
          constituentid: '2402',
          preferreddisplayname: 'Bril, Paul',
          forwarddisplayname: 'Paul Bril',
        },
      ],
      alternativeNames: [
        {
          constituentid: '2402',
          forwarddisplayname: 'Paulus Bril',
          nametype: 'Variant',
        },
      ],
    }).get('110821');

    assert.equal(result.primaryArtistId, '23812');
    assert.deepEqual(
      result.relationships.map((row) => [
        row.constituentId,
        row.displayOrder,
        row.role,
      ]),
      [
        ['23812', 1, 'artist'],
        ['2402', 2, 'artist after'],
      ]
    );
    assert.deepEqual(result.relationships[1].alternativeNames, ['Paulus Bril']);
  });

  it('is independent of CSV input order and removes exact duplicate relationships', () => {
    const relationships = [
      artistRelationship({
        constituentid: '2402',
        displayorder: '2',
        role: 'artist after',
      }),
      artistRelationship(),
      artistRelationship({
        constituentid: '2402',
        displayorder: '2',
        role: 'artist after',
      }),
    ];
    const constituents = [
      constituent({
        constituentid: '2402',
        preferreddisplayname: 'Bril, Paul',
        forwarddisplayname: 'Paul Bril',
      }),
      constituent(),
    ];
    const alternativeNames = [
      {
        constituentid: '2402',
        forwarddisplayname: 'Paulus Bril',
        nametype: 'Variant',
      },
      {
        constituentid: '2402',
        forwarddisplayname: 'Paulus Bril',
        nametype: 'Variant',
      },
    ];

    const first = build({ relationships, constituents, alternativeNames }).get(
      '110821'
    );
    const reversed = build({
      relationships: [...relationships].reverse(),
      constituents: [...constituents].reverse(),
      alternativeNames: [...alternativeNames].reverse(),
    }).get('110821');

    assert.deepEqual(first, reversed);
    assert.equal(first.relationships.length, 2);
    assert.deepEqual(first.relationships[1].alternativeNames, ['Paulus Bril']);
  });

  it('excludes non-artist roles before selecting a primary artist', () => {
    const result = build({
      relationships: [
        artistRelationship({
          constituentid: '5',
          displayorder: '1',
          roletype: 'former owner',
          role: 'owner',
        }),
        artistRelationship({ constituentid: '23812', displayorder: '2' }),
      ],
    }).get('110821');

    assert.equal(result.primaryArtistId, '23812');
    assert.deepEqual(
      result.relationships.map((row) => row.roleType),
      ['artist']
    );
  });

  it('normalizes Unicode and whitespace without changing official names', () => {
    const result = build({
      relationships: [
        artistRelationship({
          role: '  artist\t after  ',
          prefix: '  after ',
          suffix: ' Jr.  ',
        }),
      ],
      constituents: [
        constituent({
          preferreddisplayname: '  Jose\u0301  Artist ',
          forwarddisplayname: ' Jose\u0301\tArtist ',
        }),
      ],
      alternativeNames: [
        {
          constituentid: '23812',
          forwarddisplayname: '  José  Painter ',
          nametype: 'Variant',
        },
        {
          constituentid: '23812',
          forwarddisplayname: 'José Painter',
          nametype: 'Variant',
        },
      ],
    }).get('110821').relationships[0];

    assert.deepEqual(result, {
      constituentId: '23812',
      displayOrder: 1,
      roleType: 'artist',
      role: 'artist after',
      prefix: 'after',
      suffix: 'Jr.',
      preferredDisplayName: 'José Artist',
      forwardDisplayName: 'José Artist',
      alternativeNames: ['José Painter'],
    });
  });

  it('rejects malformed relationship IDs and display orders', () => {
    assert.throws(
      () =>
        build({ relationships: [artistRelationship({ objectid: '110821a' })] }),
      /malformed objectid/
    );
    assert.throws(
      () =>
        build({ relationships: [artistRelationship({ constituentid: 'x' })] }),
      /malformed constituentid/
    );
    assert.throws(
      () =>
        build({ relationships: [artistRelationship({ displayorder: '1.5' })] }),
      /malformed displayorder/
    );
  });

  it('rejects missing required objects and unresolved constituents', () => {
    assert.throws(
      () => build({ requiredObjectIds: new Set(['110821', '38']) }),
      /missing artist relationship/
    );
    assert.throws(() => build({ constituents: [] }), /unresolved constituent/);
  });

  it('rejects lowest display-order ties instead of breaking them by input order', () => {
    assert.throws(
      () =>
        build({
          relationships: [
            artistRelationship(),
            artistRelationship({ constituentid: '2402', role: 'artist after' }),
          ],
          constituents: [
            constituent(),
            constituent({
              constituentid: '2402',
              preferreddisplayname: 'Bril, Paul',
              forwarddisplayname: 'Paul Bril',
            }),
          ],
        }),
      /minimum displayorder tie/
    );
  });

  it('merges only the NGA artist payload into existing custom metadata', () => {
    const metadata = {
      primaryArtistId: '23812',
      relationships: [{ constituentId: '23812', displayOrder: 1 }],
    };

    assert.deepEqual(
      mergeNgaArtistCustomMetadata(
        { provider: 'nga', imageUuid: 'image-1' },
        metadata,
        '79d114c'
      ),
      {
        provider: 'nga',
        imageUuid: 'image-1',
        [NGA_ARTIST_METADATA_KEY]: {
          sourceCommit: '79d114c',
          relationships: [{ constituentId: '23812', displayOrder: 1 }],
        },
      }
    );
  });
});
