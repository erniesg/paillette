import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const sqlite = (dbPath, sql) =>
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });

const sqlString = (value) => String(value).replaceAll("'", "''");

describe('build-ngs-app-etl caption priority', () => {
  it('uses trusted persistent Roots captions as public descriptions without dropping generated captions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paillette-ngs-etl-test-'));
    const dbPath = join(dir, 'source.sqlite');
    const outputPath = join(dir, 'etl.sql');
    const captionsPath = join(dir, 'captions.jsonl');
    const groundingPath = join(dir, 'grounding.jsonl');
    const rootsCsvPath = join(dir, 'roots.csv');
    const emptyOverridesPath = join(dir, 'empty-overrides.json');

    try {
      sqlite(
        dbPath,
        `
CREATE TABLE institutions (id TEXT, name TEXT, country TEXT, website TEXT);
CREATE TABLE collections (id TEXT, name TEXT, description TEXT, created_at TEXT);
CREATE TABLE artworks (
  id TEXT,
  accession_no TEXT,
  institution_id TEXT,
  collection_id TEXT,
  title TEXT,
  artist TEXT,
  artist_bio TEXT,
  date_text TEXT,
  classification TEXT,
  medium TEXT,
  dimensions TEXT,
  credit_line TEXT,
  rights TEXT,
  description TEXT,
  colour_palette TEXT,
  subject_tags TEXT,
  on_display INTEGER,
  in_ngs_catalog INTEGER,
  metadata_sources TEXT,
  provenance TEXT,
  ngs_detail_url TEXT,
  ngs_image_url TEXT,
  roots_listing_url TEXT,
  raw_ngs TEXT,
  raw_roots TEXT,
  created_at TEXT
);
CREATE TABLE assets (
  id TEXT,
  bucket TEXT,
  key TEXT,
  artwork_id TEXT,
  role TEXT,
  source_type TEXT,
  source_provider TEXT,
  source_url TEXT,
  visibility TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  checksum TEXT,
  created_at TEXT
);
INSERT INTO institutions VALUES ('ngs', 'National Gallery Singapore', 'Singapore', 'https://www.nationalgallery.sg');
INSERT INTO collections VALUES ('national-collection', 'National Collection', NULL, NULL);
INSERT INTO artworks VALUES (
  '2019-00754',
  '2019-00754',
  'ngs',
  'national-collection',
  'Zhong Zheng Ren (中正人)',
  'Yeo Hwee Bin',
  NULL,
  '1969',
  NULL,
  'Stone',
  'null 120 x 80 x 10 cm null',
  'Gift of Chung Cheng High School (Main). Collection of National Gallery Singapore.',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  '{}',
  '{}',
  'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/yeo-hwee-bin/2019/2019-00754_cropped.tif.html',
  NULL,
  'https://www.roots.gov.sg/Collection-Landing/listing/1454646',
  '{"objObjectNumberTxt":"2019-00754","objObjectTitleTxt":"Zhong Zheng Ren (中正人)","artistAvailableNames":["Yeo Hwee Bin"],"objCreditLineTxt":"Collection of National Gallery Singapore"}',
  '{"pageid":"1454646","img":"https://www.roots.gov.sg/CollectionImages/1454646.jpg","title":"","creator":""}',
  NULL
);
INSERT INTO artworks VALUES (
  '2015-00622',
  '2015-00622',
  'ngs',
  'national-collection',
  'Docking',
  'Lim Yew Kuan',
  NULL,
  '1957',
  'Paintings',
  'Oil on canvas',
  'null 41 x 71 cm null',
  'Collection of National Gallery Singapore',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  '{}',
  '{}',
  'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/lim-yew-kuan/2015/2015-00622.tif.html',
  NULL,
  'https://www.roots.gov.sg/Collection-Landing/listing/1323511',
  '{"objObjectNumberTxt":"2015-00622","objObjectTitleTxt":"Docking","artistAvailableNames":["Lim Yew Kuan"],"objCreditLineTxt":"Collection of National Gallery Singapore"}',
  '{"pageid":"1323511","img":"https://www.roots.gov.sg/CollectionImages/1323511.jpg","title":"Docking","creator":"Lim Yew Kuan","accession":"2015-00622"}',
  NULL
);
`
      );

      writeFileSync(
        captionsPath,
        JSON.stringify({
          id: '2019-00754',
          caption: 'Generated visual caption.',
          model: 'test-model',
          prompt_version: 'cap-v1',
          generated_at: '2026-05-31T00:00:00.000Z',
          sources: ['https://www.roots.gov.sg/Collection-Landing/listing/1454646'],
        }) + '\n'
      );
      writeFileSync(groundingPath, '');
      writeFileSync(
        rootsCsvPath,
        [
          [
            'documents_0_path',
            'documents_0_content',
            'documents_0_metadata_pageId',
            'documents_0_metadata_accession_no',
            'documents_0_metadata_collection_of',
            'documents_0_title',
            'documents_0_metadata_creator',
            'documents_0_metadata_date_period',
            'documents_0_metadata_region',
            'documents_0_metadata_material_0',
            'documents_0_metadata_nlb_type',
            'documents_0_metadata_dimension',
          ].join(','),
          [
            'https://www.roots.gov.sg/Collection-Landing/listing/1454646',
            '"Persistent Roots source caption."',
            '1454646',
            '2019-00754',
            'National Gallery Singapore',
            '"Zhong Zheng Ren (中正人)"',
            '"Yeo Hwee Bin"',
            '1969',
            'Singapore',
            'Stone',
            'Sculpture',
            '"null 120 x 80 x 10 cm null"',
          ].join(','),
          [
            'https://www.roots.gov.sg/Collection-Landing/listing/1323511',
            '"Docking Roots caption."',
            '1323511',
            '2015-00622',
            'National Gallery Singapore',
            'Docking',
            '"Lim Yew Kuan"',
            '1957',
            'Singapore',
            '"Oil on canvas"',
            'Painting',
            '"Image size: 39.5 x 70 cm Frame size: 62.9 x 92.6 cm"',
          ].join(','),
        ].join('\n')
      );
      writeFileSync(
        emptyOverridesPath,
        JSON.stringify({
          verified_roots_description_records: [],
          verified_roots_caption_records: [],
        })
      );

      execFileSync(
        process.execPath,
        [
          'scripts/build-ngs-app-etl.mjs',
          dbPath,
          outputPath,
          'https://api.example.test',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NGS_CAPTIONS_JSONL: captionsPath,
            NGS_GROUNDING_JSONL: groundingPath,
            NGS_ROOTS_SOURCE_CSV: rootsCsvPath,
            NGS_ROOTS_DESCRIPTION_OVERRIDES_JSON: emptyOverridesPath,
            NGS_ROOTS_CAPTION_OVERRIDES_JSON: emptyOverridesPath,
          },
          encoding: 'utf8',
        }
      );

      const output = readFileSync(outputPath, 'utf8');
      assert.match(
        output,
        new RegExp(
          `${sqlString('Persistent Roots source caption.')}`,
          'u'
        )
      );
      assert.match(output, /"description":"roots"/u);
      assert.match(output, /"generated_caption":\{"text":"Generated visual caption."/u);
      assert.match(output, /"title":"Zhong Zheng Ren \(中正人\)"/u);
      assert.match(output, /"creator":"Yeo Hwee Bin"/u);
      assert.match(output, /"accession":"2019-00754"/u);
      assert.match(output, /"material":"Stone"/u);
      assert.match(output, /"region":"Singapore"/u);
      assert.match(output, /"dimensions_text":"120 x 80 x 10 cm"/u);
      assert.doesNotMatch(output, /null 120 x 80 x 10 cm null/u);
      assert.match(
        output,
        /'2015-00622'.*'https:\/\/www\.roots\.gov\.sg\/Collection-Landing\/listing\/1323511'/su
      );
      assert.doesNotMatch(output, /2015-00622\.tif\.html/u);
      assert.match(
        output,
        /'Persistent Roots source caption\.', 'Gift of Chung Cheng High School/u
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes Roots-only rows without verified National Gallery Singapore ownership', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paillette-ngs-etl-test-'));
    const dbPath = join(dir, 'source.sqlite');
    const outputPath = join(dir, 'etl.sql');
    const captionsPath = join(dir, 'captions.jsonl');
    const groundingPath = join(dir, 'grounding.jsonl');
    const rootsCsvPath = join(dir, 'roots.csv');
    const emptyOverridesPath = join(dir, 'empty-overrides.json');

    try {
      sqlite(
        dbPath,
        `
CREATE TABLE institutions (id TEXT, name TEXT, country TEXT, website TEXT);
CREATE TABLE collections (id TEXT, name TEXT, description TEXT, created_at TEXT);
CREATE TABLE artworks (
  id TEXT,
  accession_no TEXT,
  institution_id TEXT,
  collection_id TEXT,
  title TEXT,
  artist TEXT,
  artist_bio TEXT,
  date_text TEXT,
  classification TEXT,
  medium TEXT,
  dimensions TEXT,
  credit_line TEXT,
  rights TEXT,
  description TEXT,
  colour_palette TEXT,
  subject_tags TEXT,
  on_display INTEGER,
  in_ngs_catalog INTEGER,
  metadata_sources TEXT,
  provenance TEXT,
  ngs_detail_url TEXT,
  ngs_image_url TEXT,
  roots_listing_url TEXT,
  raw_ngs TEXT,
  raw_roots TEXT,
  created_at TEXT
);
CREATE TABLE assets (
  id TEXT,
  bucket TEXT,
  key TEXT,
  artwork_id TEXT,
  role TEXT,
  source_type TEXT,
  source_provider TEXT,
  source_url TEXT,
  visibility TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  checksum TEXT,
  created_at TEXT
);
INSERT INTO institutions VALUES ('ngs', 'National Gallery Singapore', 'Singapore', 'https://www.nationalgallery.sg');
INSERT INTO collections VALUES ('national-collection', 'National Collection', NULL, NULL);
INSERT INTO artworks VALUES (
  'AB2004-00006',
  'AB2004-00006',
  'ngs',
  'national-collection',
  'Amidst Seafarers',
  'Ching Hing Kang',
  NULL,
  '1974',
  NULL,
  'Mixed media',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  '{}',
  '{}',
  NULL,
  NULL,
  'https://www.roots.gov.sg/Collection-Landing/listing/1030018',
  NULL,
  '{"pageid":"1030018","title":"Amidst Seafarers","creator":"Ching Hing Kang","accession":"AB2004-00006"}',
  NULL
);
`
      );

      writeFileSync(captionsPath, '');
      writeFileSync(
        groundingPath,
        JSON.stringify({
          id: 'AB2004-00006',
          raw_ngs: null,
          raw_roots: JSON.stringify({
            pageid: '1030018',
            title: 'Amidst Seafarers',
            creator: 'Ching Hing Kang',
          }),
          ngs_detail_url: null,
          roots_listing_url:
            'https://www.roots.gov.sg/Collection-Landing/listing/1030018',
        }) + '\n'
      );
      writeFileSync(
        rootsCsvPath,
        [
          [
            'documents_0_path',
            'documents_0_content',
            'documents_0_metadata_pageId',
            'documents_0_metadata_accession_no',
            'documents_0_metadata_collection_of',
            'documents_0_title',
            'documents_0_metadata_creator',
          ].join(','),
        ].join('\n')
      );
      writeFileSync(
        emptyOverridesPath,
        JSON.stringify({
          verified_roots_description_records: [],
          verified_roots_caption_records: [],
        })
      );

      execFileSync(
        process.execPath,
        [
          'scripts/build-ngs-app-etl.mjs',
          dbPath,
          outputPath,
          'https://api.example.test',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NGS_CAPTIONS_JSONL: captionsPath,
            NGS_GROUNDING_JSONL: groundingPath,
            NGS_ROOTS_SOURCE_CSV: rootsCsvPath,
            NGS_ROOTS_DESCRIPTION_OVERRIDES_JSON: emptyOverridesPath,
            NGS_ROOTS_CAPTION_OVERRIDES_JSON: emptyOverridesPath,
          },
          encoding: 'utf8',
        }
      );

      const output = readFileSync(outputPath, 'utf8');
      assert.doesNotMatch(output, /AB2004-00006/u);
      assert.doesNotMatch(output, /Amidst Seafarers/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
