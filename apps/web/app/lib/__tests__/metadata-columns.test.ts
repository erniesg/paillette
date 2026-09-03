import { describe, expect, it } from 'vitest';

import { readMetadataCsv } from '../indexing-client';
import {
  buildEntryMatcher,
  mapMetadataColumns,
  normalizeColumnName,
  tokenizeColumnName,
} from '../metadata-columns';

/**
 * These cases are the ones that decide whether a stranger's archive is usable:
 * our own column names, somebody else's, nobody's, and none at all. The header
 * rows below are copied from the shapes real institutions actually export, not
 * invented, because the failure this guards against is exactly "it worked on
 * the sample zip we made".
 */

const csv = (rows: string[][]) =>
  rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

describe('column normalisation', () => {
  it('folds punctuation, case and spacing but keeps non-Latin scripts', () => {
    expect(normalizeColumnName('Object Title')).toBe('objecttitle');
    expect(normalizeColumnName('Inv. No.')).toBe('invno');
    expect(normalizeColumnName('  FILE_NAME  ')).toBe('filename');
    // Stripping to [a-z0-9] used to erase these entirely, so a CJK export had
    // no headers left to match at all.
    expect(normalizeColumnName('作者')).toBe('作者');
  });

  it('splits camelCase and separators into the same words', () => {
    expect(tokenizeColumnName('artistDisplayName')).toEqual([
      'artist',
      'display',
      'name',
    ]);
    expect(tokenizeColumnName('Artist Display Name')).toEqual([
      'artist',
      'display',
      'name',
    ]);
    expect(tokenizeColumnName('credit_line')).toEqual(['credit', 'line']);
  });
});

describe('exact-match columns', () => {
  it('maps our own sample sidecar without inference', () => {
    const text = csv([
      [
        'filename',
        'title',
        'artist',
        'year',
        'medium',
        'classification',
        'credit_line',
        'accession_number',
        'nga_object_id',
        'source_url',
      ],
      [
        'nga-30230.jpg',
        'The Eel Gatherers',
        'Jean-Baptiste-Camille Corot',
        '1860/1865',
        'oil on canvas',
        'Painting',
        'Gift of Mr. and Mrs. P.H.B. Frelinghuysen',
        '1943.15.1',
        '30230',
        'https://www.nga.gov/collection/art-object-page.30230.html',
      ],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['nga-30230.jpg'],
    });

    expect(items['nga-30230.jpg']).toEqual({
      title: 'The Eel Gatherers',
      artist: 'Jean-Baptiste-Camille Corot',
      medium: 'oil on canvas',
      classification: 'Painting',
      credit_line: 'Gift of Mr. and Mrs. P.H.B. Frelinghuysen',
      accession_number: '1943.15.1',
      date_text: '1860/1865',
      year: 1860,
    });
    expect(mapping.columns.filter((column) => column.via === 'exact').length)
      .toBeGreaterThanOrEqual(7);
    // The two id/url columns are surplus, not a problem worth asking about.
    expect(mapping.ignored).toEqual(['nga_object_id', 'source_url']);
    expect(mapping.needsReview).toBe(false);
  });
});

describe('synonym columns', () => {
  it('reads a Met-shaped export, including the artist column family', () => {
    const text = csv([
      [
        'Object Number',
        'Object ID',
        'Department',
        'Object Name',
        'Title',
        'Artist Display Name',
        'Artist Nationality',
        'Artist Begin Date',
        'Object Date',
        'Medium',
        'Credit Line',
        'Classification',
        'Link Resource',
      ],
      [
        '29.100.113',
        '436535',
        'European Paintings',
        'Painting',
        'Wheat Field with Cypresses',
        'Vincent van Gogh',
        'Dutch',
        '1853',
        '1889',
        'Oil on canvas',
        'Purchase, The Annenberg Foundation Gift, 1993',
        'Paintings',
        'https://www.metmuseum.org/art/collection/search/436535',
      ],
    ]);

    // The images are named after the object id — the only join this file has.
    const { items, mapping, matchedRows } = readMetadataCsv(text, {
      knownFilenames: ['436535.jpg'],
    });

    expect(matchedRows).toBe(1);
    expect(items['436535.jpg']).toMatchObject({
      title: 'Wheat Field with Cypresses',
      artist: 'Vincent van Gogh',
      medium: 'Oil on canvas',
      classification: 'Paintings',
      date_text: '1889',
      year: 1889,
    });
    // `Artist Nationality` and `Artist Begin Date` are disqualified for the
    // artist role, so it lands on the one column that is actually a name.
    expect(mapping.mapped.artist).toBe('Artist Display Name');
    expect(mapping.mapped.year).toBe('Object Date');
    expect(mapping.mapped.filename).toBe('Object ID');
    expect(mapping.ignored).toContain('Artist Nationality');
  });

  it('reads a snake_case export with a creation_date column', () => {
    const text = csv([
      ['image_file', 'work_title', 'creator', 'creation_date', 'technique'],
      ['plate-01.jpg', 'Study of Hands', 'A. Draughtsman', 'c. 1712', 'chalk'],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['plate-01.jpg'],
    });

    expect(items['plate-01.jpg']).toMatchObject({
      title: 'Study of Hands',
      artist: 'A. Draughtsman',
      medium: 'chalk',
      date_text: 'c. 1712',
      year: 1712,
    });
    expect(mapping.needsReview).toBe(false);
  });

  it('reads a Cleveland-shaped export, where the join is a bare id', () => {
    const text = csv([
      [
        'id',
        'accession_number',
        'tombstone',
        'title',
        'title_in_original_language',
        'series',
        'creation_date',
        'artists_tags',
        'culture',
        'technique',
        'department',
        'type',
        'measurements',
      ],
      [
        '135812',
        '1958.427',
        'Twilight in the Wilderness, 1860. Frederic Edwin Church (American, 1826-1900). Oil on fabric.',
        'Twilight in the Wilderness',
        '',
        '',
        '1860',
        'Frederic Edwin Church',
        'America',
        'oil on fabric',
        'American Painting and Sculpture',
        'Painting',
        '101.6 x 162.6 cm',
      ],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['135812.jpg'],
    });

    expect(mapping.mapped.filename).toBe('id');
    expect(items['135812.jpg']).toMatchObject({
      title: 'Twilight in the Wilderness',
      artist: 'Frederic Edwin Church',
      medium: 'oil on fabric',
      accession_number: '1958.427',
      year: 1860,
    });
    // `type` is the closer word for classification than `department` is.
    expect(mapping.mapped.classification).toBe('type');
  });

  it('reads headers in another language', () => {
    const text = csv([
      ['Fichier', 'Titre', 'Auteur', 'Année', 'Technique'],
      ['a.jpg', 'Le Déjeuner', 'É. Manet', '1863', 'huile sur toile'],
    ]);

    const { items } = readMetadataCsv(text, { knownFilenames: ['a.jpg'] });
    expect(items['a.jpg']).toMatchObject({
      title: 'Le Déjeuner',
      artist: 'É. Manet',
      medium: 'huile sur toile',
      year: 1863,
    });
  });
});

describe('columns nothing recognises', () => {
  it('infers the file, date and title columns from their values', () => {
    const text = csv([
      ['Ref', 'Kennung', 'Bezeichnung', 'Entstehungszeit', 'Zusatz'],
      ['R-1', 'one.jpg', 'Stillleben mit Krug', '1902', 'x'],
      ['R-2', 'two.jpg', 'Abendlandschaft', '1904', 'y'],
      ['R-3', 'three.jpg', 'Der Wanderer', '1911', 'z'],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg', 'two.jpg', 'three.jpg'],
    });

    expect(mapping.mapped.filename).toBe('Kennung');
    expect(mapping.mapped.year).toBe('Entstehungszeit');
    expect(items['two.jpg']).toMatchObject({
      title: 'Abendlandschaft',
      date_text: '1904',
      year: 1904,
    });
    // Nothing in these headers is a word this module knows, so every one of
    // them was decided by reading the values.
    expect(
      mapping.columns.find((column) => column.column === 'Kennung')?.via
    ).toBe('content');
    expect(
      mapping.columns.find((column) => column.column === 'Bezeichnung')?.via
    ).toBe('content');
  });

  it('says so, and offers samples, when a field that matters is unresolved', () => {
    const text = csv([
      ['pic', 'zzz', 'qqq'],
      ['one.jpg', 'Mostly Harmless', 'Q. Anon'],
      ['two.jpg', 'Deep Thought', 'Q. Anon'],
    ]);

    const { mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg', 'two.jpg'],
    });

    // `zzz` is inferrable as the title from its values; `qqq` is not — nothing
    // in a name says "artist" rather than "donor", so it is asked about.
    expect(mapping.mapped.artist).toBeUndefined();
    expect(mapping.ignored).toContain('qqq');
    expect(mapping.needsReview).toBe(true);
    expect(mapping.samples[0]).toEqual({ qqq: 'Q. Anon' });
    // Only the unresolved column travels — the rest of the file stays here.
    expect(Object.keys(mapping.samples[0]!)).toEqual(['qqq']);
    expect(mapping.summary).toContain('unrecognised');
  });

  it('applies a supplied mapping over its own guesses, and says who decided', () => {
    const text = csv([
      ['pic', 'zzz', 'qqq'],
      ['one.jpg', 'Mostly Harmless', 'Q. Anon'],
      ['two.jpg', 'Deep Thought', 'Q. Anon'],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg', 'two.jpg'],
      columnMapping: { qqq: 'artist', zzz: 'title' },
    });

    expect(items['one.jpg']).toEqual({
      title: 'Mostly Harmless',
      artist: 'Q. Anon',
    });
    expect(mapping.source).toBe('supplied');
    expect(mapping.needsReview).toBe(false);
    expect(
      mapping.columns.find((column) => column.column === 'qqq')?.via
    ).toBe('supplied');
  });

  it('honours an explicit "ignore" without calling it unresolved', () => {
    const text = csv([
      ['pic', 'title', 'internal_note'],
      ['one.jpg', 'Sunrise', 'do not publish'],
    ]);

    const { mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg'],
      columnMapping: { internal_note: 'ignore' },
    });

    expect(mapping.ignored).toEqual(['internal_note']);
    expect(mapping.needsReview).toBe(false);
    expect(mapping.samples).toEqual([]);
  });

  it('reports a sidecar that describes a different set of images', () => {
    const text = csv([
      ['filename', 'title'],
      ['other-archive-01.jpg', 'Sunrise'],
      ['other-archive-02.jpg', 'Dusk'],
    ]);

    const { mapping, matchedRows } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg', 'two.jpg'],
    });

    expect(matchedRows).toBe(0);
    expect(mapping.needsReview).toBe(true);
    expect(mapping.summary).toContain('None of the 2 row(s)');
  });

  it('does not invent a year out of an accession number', () => {
    const text = csv([
      ['pic', 'ref'],
      ['one.jpg', '1943.15.1'],
      ['two.jpg', '1958.22.4'],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg', 'two.jpg'],
    });

    expect(mapping.mapped.year).toBeUndefined();
    expect(items['one.jpg']?.year).toBeUndefined();
  });
});

describe('no usable sidecar at all', () => {
  it('reports an empty file as "no sidecar" rather than as a failure', () => {
    const { items, mapping } = readMetadataCsv('');
    expect(items).toEqual({});
    expect(mapping.needsReview).toBe(false);
    expect(mapping.summary).toContain('titled from its filename');
  });

  it('keeps every column named when no row can be attached to an image', () => {
    const text = csv([
      ['catalogue_ref', 'notes'],
      ['R-1', 'first entry'],
    ]);

    const { items, mapping } = readMetadataCsv(text, {
      knownFilenames: ['one.jpg'],
    });

    expect(items).toEqual({});
    expect(mapping.columns.map((column) => column.column)).toEqual([
      'catalogue_ref',
      'notes',
    ]);
    expect(mapping.summary).toContain('No column identifies which image');
  });
});

describe('entry matching', () => {
  it('resolves a bare object id to the file named after it', () => {
    const entries = buildEntryMatcher(['photos/436535.jpg', 'photos/12.PNG']);
    expect(entries.resolve('436535')).toBe('436535.jpg');
    expect(entries.resolve('436535.jpg')).toBe('436535.jpg');
    expect(entries.resolve('photos/12.png')).toBe('12.png');
    expect(entries.resolve('nothing')).toBeNull();
  });
});

describe('assignment is order-independent', () => {
  it('gives the same answer whichever way round the columns appear', () => {
    const headers = ['name', 'Title', 'Creator'];
    const rows = [['one.jpg', 'Sunrise', 'A. Painter']];
    const forward = mapMetadataColumns(headers, rows, {
      knownFilenames: ['one.jpg'],
    });
    const reversed = mapMetadataColumns(
      [...headers].reverse(),
      rows.map((row) => [...row].reverse()),
      { knownFilenames: ['one.jpg'] }
    );

    expect(forward.report.mapped).toEqual(reversed.report.mapped);
  });
});
