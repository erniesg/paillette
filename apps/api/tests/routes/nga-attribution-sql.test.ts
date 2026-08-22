import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { searchNgaAttributionMatches } from '../../src/routes/search';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const ARTWORK_COLUMNS = [
  'id',
  'org_id',
  'title',
  'artist',
  'year',
  'year_start',
  'year_end',
  'date_text',
  'medium',
  'medium_family',
  'classification',
  'subclassification',
  'visual_classification',
  'primary_artist_id',
  'culture',
  'origin',
  'dimensions_height',
  'dimensions_width',
  'dimensions_depth',
  'dimensions_unit',
  'description',
  'provenance',
  'credit_line',
  'rights',
  'accession_number',
  'source_url',
  'source_institution',
  'source_collection',
  'source_record_id',
  'field_sources',
  'dominant_colors',
  'color_palette',
  'citation',
  'image_url',
  'thumbnail_url',
  'custom_metadata',
  'deleted_at',
] as const;

type SqliteArtwork = Partial<
  Record<(typeof ARTWORK_COLUMNS)[number], unknown>
> & {
  id: string;
  title: string;
  artist: string;
  primary_artist_id: string;
  custom_metadata: string;
};

const afterMetadata = (
  constituentId: string,
  officialName: string,
  alternativeNames: string[] = []
) =>
  JSON.stringify({
    provider: 'nga',
    ngaArtists: {
      relationships: [
        {
          constituentId,
          displayOrder: 1,
          roleType: 'artist',
          role: 'artist after',
          prefix: 'after',
          suffix: null,
          preferredDisplayName: officialName,
          forwardDisplayName: officialName,
          alternativeNames,
        },
      ],
    },
  });

const makeArtwork = (
  id: string,
  title: string,
  officialName: string,
  alternativeNames: string[] = []
): SqliteArtwork => ({
  id,
  org_id: 'open-access-art',
  title,
  artist: `After ${officialName}`,
  classification: 'Painting',
  primary_artist_id: '1364',
  custom_metadata: afterMetadata('1364', officialName, alternativeNames),
  deleted_at: null,
});

const createRealSqliteD1 = (rows: SqliteArtwork[]) => {
  const sqlite = new DatabaseSync(':memory:');
  const preparedSql: string[] = [];
  sqlite.exec(`
    CREATE TABLE artworks (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      title TEXT,
      artist TEXT,
      year INTEGER,
      year_start INTEGER,
      year_end INTEGER,
      date_text TEXT,
      medium TEXT,
      medium_family TEXT,
      classification TEXT,
      subclassification TEXT,
      visual_classification TEXT,
      primary_artist_id TEXT,
      culture TEXT,
      origin TEXT,
      dimensions_height REAL,
      dimensions_width REAL,
      dimensions_depth REAL,
      dimensions_unit TEXT,
      description TEXT,
      provenance TEXT,
      credit_line TEXT,
      rights TEXT,
      accession_number TEXT,
      source_url TEXT,
      source_institution TEXT,
      source_collection TEXT,
      source_record_id TEXT,
      field_sources TEXT,
      dominant_colors TEXT,
      color_palette TEXT,
      citation TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      custom_metadata TEXT,
      deleted_at TEXT
    )
  `);
  const insert = sqlite.prepare(
    `INSERT INTO artworks (${ARTWORK_COLUMNS.join(', ')}) VALUES (${ARTWORK_COLUMNS.map(() => '?').join(', ')})`
  );
  for (const row of rows) {
    insert.run(...ARTWORK_COLUMNS.map((column) => row[column] ?? null));
  }

  const d1 = {
    prepare(sql: string) {
      preparedSql.push(sql);
      const statement = sqlite.prepare(sql);
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async all<T>() {
          return {
            success: true,
            results: statement.all(...(params as never[])) as T[],
          };
        },
      };
    },
  } as unknown as D1Database;

  return { d1, preparedSql, close: () => sqlite.close() };
};

const searchAfter = (db: D1Database, targetText: string) =>
  searchNgaAttributionMatches(
    db,
    { provider: 'nga' },
    { relationship: 'after', targetText },
    undefined,
    100
  );

describe('NGA attribution candidate SQL on SQLite', () => {
  it('prepares and executes the generated SQL with accented official names in both directions', async () => {
    const { d1, preparedSql, close } = createRealSqliteD1([
      makeArtwork('jose', 'A: lowercase accented', 'josé de ribera'),
      makeArtwork(
        'le-brun-accented',
        'B: uppercase accented',
        'ÉLISABETH LOUISE VIGÉE LE BRUN'
      ),
      makeArtwork(
        'le-brun-alternative',
        'C: accentless alternative',
        'Louise Le Brun',
        ['Elisabeth Louise Vigee Le Brun']
      ),
      makeArtwork(
        'eight-token-name',
        'D: bounded eight-token name',
        'Albrecht Johann Friedrich Maria Georg Ludwig Peter Hans'
      ),
    ]);

    try {
      await expect(searchAfter(d1, 'Jose de Ribera')).resolves.toMatchObject([
        { id: 'jose' },
      ]);
      await expect(
        searchAfter(d1, 'Elisabeth Louise Vigee Le Brun')
      ).resolves.toMatchObject([
        { id: 'le-brun-accented' },
        { id: 'le-brun-alternative' },
      ]);
      await expect(
        searchAfter(d1, 'Élisabeth Louise Vigée Le Brun')
      ).resolves.toMatchObject([
        { id: 'le-brun-accented' },
        { id: 'le-brun-alternative' },
      ]);
      await expect(
        searchAfter(
          d1,
          'Albrecht Johann Friedrich Maria Georg Ludwig Peter Hans'
        )
      ).resolves.toMatchObject([{ id: 'eight-token-name' }]);
      expect(Math.max(...preparedSql.map((sql) => sql.length))).toBeLessThan(
        20_000
      );
    } finally {
      close();
    }
  });

  it('recalls arbitrary separator forms while hydrated proof rejects missing and partial tokens', async () => {
    const { d1, close } = createRealSqliteD1([
      makeArtwork('en-dash', 'A: en dash', 'Jean–Paul'),
      makeArtwork('em-dash', 'B: em dash', 'Jean—Paul'),
      makeArtwork('nonbreaking-hyphen', 'C: nonbreaking hyphen', 'Jean‑Paul'),
      makeArtwork('missing-token', 'D: missing token', 'Jean Louis'),
    ]);

    try {
      const exact = await searchAfter(d1, 'Jean Paul');
      const partial = await searchAfter(d1, 'Jea Pau');
      const missing = await searchAfter(d1, 'Jean Ringo');

      expect(exact.map((row) => row.id)).toEqual([
        'en-dash',
        'em-dash',
        'nonbreaking-hyphen',
      ]);
      expect(partial).toEqual([]);
      expect(missing).toEqual([]);
    } finally {
      close();
    }
  });
});
