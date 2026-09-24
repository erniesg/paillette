import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OPEN_ACCESS_ORG_ID,
  DEFAULT_OPEN_ACCESS_SYSTEM_USER_ID,
  buildOpenAccessSeedSql,
} from '../lib/open-access-art-apply.mjs';
import {
  BACKFILL_DATABASES,
  buildNgaDimensionUpdateSql,
  dimensionShape,
  pendingBatches,
  planNgaDimensionBackfill,
} from '../lib/nga-dimensions-backfill.mjs';
import { migratedDatabase } from './support/migrated-database.mjs';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../backfill-nga-dimensions.mjs'
);

const row = (objectId) => ({
  id: `open-access-art:nga:${objectId}`,
  source_record_id: String(objectId),
});

const textByObjectId = new Map([
  ['10', 'overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)'],
  ['11', 'overall (diameter): 30.5 cm (12 in.)'],
  ['12', 'overall (diameter): 12.7 cm (5 in.)'],
  ['13', 'image: 20 × 15 cm\nsheet: 30 × 24 × 0.1 cm'],
  ['14', ''],
]);

describe('NGA dimension backfill plan', () => {
  it('counts parsed, unparsed and textless rows and ranks the unparsed shapes', () => {
    const plan = planNgaDimensionBackfill({
      rows: [row(13), row(11), row(10), row(12), row(14), row(15)],
      textByObjectId,
    });
    assert.deepEqual(plan.counts, {
      rows: 6,
      notInSource: 1,
      withoutSourceText: 2,
      withText: 4,
      parsed: 2,
      unparsed: 2,
      withDepth: 1,
    });
    assert.deepEqual(plan.topUnparsedShapes, [
      { shape: 'overall (diameter): N cm (N in.)', count: 2 },
    ]);
    assert.deepEqual(
      plan.updates.map((update) => update.id),
      [10, 11, 12, 13].map((id) => `open-access-art:nga:${id}`)
    );
    assert.equal(plan.updates.find((u) => u.objectId === '13').dimensions_height, 30);
  });

  it('refuses a row whose id and source record disagree', () => {
    assert.throws(
      () =>
        planNgaDimensionBackfill({
          rows: [{ id: 'open-access-art:nga:10', source_record_id: '11' }],
          textByObjectId,
        }),
      /does not match its source_record_id/
    );
  });

  it('abstracts figures, fractions and line breaks out of a shape', () => {
    assert.equal(
      dimensionShape('overall: 62.5 x 96.8 cm (24 5/8 x 3/4 in.)\nframed: 1 x 2 in.'),
      'overall: N x N cm (F x F in.) | framed: N x N in.'
    );
  });
});

describe('NGA dimension backfill SQL', () => {
  const seed = (db) => {
    db.exec(buildOpenAccessSeedSql({ generatedAt: '2026-09-24T00:00:00.000Z' }));
    const insert = db.prepare(
      `INSERT INTO artworks (id, org_id, title, source_record_id, custom_metadata, uploaded_by)
       VALUES (?, '${DEFAULT_OPEN_ACCESS_ORG_ID}', 'Untitled', ?, ?, '${DEFAULT_OPEN_ACCESS_SYSTEM_USER_ID}')`
    );
    insert.run('open-access-art:nga:10', '10', '{"provider":"nga","ngaArtists":{"a":1}}');
    insert.run('open-access-art:nga:11', '11', null);
    insert.run('open-access-art:nga:12', '12', 'not json');
    insert.run('open-access-art:nga:13', '99', '{}');
  };
  const read = (db) =>
    db
      .prepare(
        `SELECT id, dimensions_height AS h, dimensions_width AS w,
                dimensions_depth AS d, dimensions_unit AS u, custom_metadata AS m
         FROM artworks ORDER BY id`
      )
      .all()
      .map((r) => ({ ...r }));

  it('sets the columns and merges the text into custom_metadata', () => {
    const db = migratedDatabase();
    seed(db);
    const plan = planNgaDimensionBackfill({
      rows: [row(10), row(11), row(12), row(13)],
      textByObjectId,
    });
    // Row 13 is seeded with a mismatched source_record_id; the plan's row is
    // the true one, so the WHERE clause is what must stop the write.
    db.exec(plan.updates.map(buildNgaDimensionUpdateSql).join('\n'));
    db.exec(plan.updates.map(buildNgaDimensionUpdateSql).join('\n'));

    const [a, b, c, d] = read(db);
    assert.deepEqual(
      { ...a, m: JSON.parse(a.m) },
      {
        id: 'open-access-art:nga:10',
        h: 62.5,
        w: 96.8,
        d: null,
        u: 'cm',
        m: {
          provider: 'nga',
          ngaArtists: { a: 1 },
          dimensions_text: 'overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)',
        },
      }
    );
    assert.deepEqual(
      { ...b, m: JSON.parse(b.m) },
      {
        id: 'open-access-art:nga:11',
        h: null,
        w: null,
        d: null,
        u: null,
        m: { dimensions_text: 'overall (diameter): 30.5 cm (12 in.)' },
      }
    );
    // Invalid JSON is left exactly as it was, not replaced.
    assert.equal(c.m, 'not json');
    assert.deepEqual(d, {
      id: 'open-access-art:nga:13',
      h: null,
      w: null,
      d: null,
      u: null,
      m: '{}',
    });
  });

  it('refuses to build an update for a non-numeric object id', () => {
    assert.throws(
      () => buildNgaDimensionUpdateSql({ id: 'x', objectId: "1' OR 1=1 --", text: 't' }),
      /decimal NGA object id/
    );
  });
});

describe('NGA dimension backfill batches', () => {
  const updates = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id }));

  it('splits in order and resumes after the cursor', () => {
    assert.deepEqual(
      pendingBatches(updates, { batchSize: 2 }).map((b) => b.map((u) => u.id)),
      [['a1', 'a2'], ['a3', 'a4'], ['a5']]
    );
    assert.deepEqual(
      pendingBatches(updates, { after: 'a2', batchSize: 2 }).map((b) =>
        b.map((u) => u.id)
      ),
      [['a3', 'a4'], ['a5']]
    );
    assert.deepEqual(pendingBatches(updates, { after: 'a5', batchSize: 2 }), []);
  });
});

describe('NGA dimension backfill CLI guards', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('has no database for production', () => {
    assert.deepEqual(Object.keys(BACKFILL_DATABASES), ['staging']);
    const result = run('--env', 'production', '--dry-run');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--env must be one of: staging/);
  });

  it('requires exactly one of --dry-run and --execute', () => {
    assert.match(run('--env', 'staging').stderr, /exactly one of --dry-run or --execute/);
    assert.match(
      run('--env', 'staging', '--dry-run', '--execute').stderr,
      /exactly one of --dry-run or --execute/
    );
  });
});
