import { dimensionColumns } from '@paillette/types/dimensions';

/**
 * Backfilling catalogue dimensions onto NGA rows that were ingested without
 * them.
 *
 * The rows exist and are right about everything else, so this touches only
 * the four dimension columns and one key in `custom_metadata`. The source is
 * the NGA open-data `objects.csv`; the join is the object id the ingest
 * already stored as `source_record_id`, and the artwork id is checked against
 * it too, so a row can only ever receive its own object's text.
 */

export const NGA_ARTWORK_ID_PREFIX = 'open-access-art:nga:';

/** The only database this script will write. Production has no entry here. */
export const BACKFILL_DATABASES = Object.freeze({
  staging: 'paillette-db-stg',
});

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NULL';

/**
 * A catalogue string with its figures abstracted, so the unparsed text can be
 * counted by what it looks like rather than by what it says.
 */
export const dimensionShape = (text) =>
  String(text)
    .replace(/\d+(?:\.\d+)?\s+\d+\/\d+/g, 'F')
    .replace(/\d+\/\d+/g, 'F')
    .replace(/\d+(?:\.\d+)?/g, 'N')
    .replace(/\s*\r?\n\s*/g, ' | ')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * Every row, what it would receive, and the counts a human needs before
 * saying yes.
 *
 * `withoutSourceText` includes `notInSource`: an object the pinned CSV does
 * not list at all is a different problem from one whose dimensions field is
 * empty, so it is counted separately as well.
 *
 * Rows without catalogue text are counted and left alone: there is nothing
 * to store, and writing four nulls over four nulls would only cost writes.
 */
export function planNgaDimensionBackfill({ rows, textByObjectId }) {
  const updates = [];
  const unparsedShapes = new Map();
  const counts = {
    rows: 0,
    notInSource: 0,
    withoutSourceText: 0,
    withText: 0,
    parsed: 0,
    unparsed: 0,
    withDepth: 0,
  };

  for (const row of rows) {
    counts.rows += 1;
    const objectId = String(row.source_record_id ?? '');
    if (row.id !== `${NGA_ARTWORK_ID_PREFIX}${objectId}` || !/^\d+$/.test(objectId)) {
      throw new Error(`NGA row ${row.id} does not match its source_record_id`);
    }
    if (!textByObjectId.has(objectId)) counts.notInSource += 1;
    const text = textByObjectId.get(objectId)?.trim();
    if (!text) {
      counts.withoutSourceText += 1;
      continue;
    }
    counts.withText += 1;
    const columns = dimensionColumns(text);
    if (columns.dimensions_unit) {
      counts.parsed += 1;
      if (columns.dimensions_depth !== null) counts.withDepth += 1;
    } else {
      counts.unparsed += 1;
      const shape = dimensionShape(text);
      unparsedShapes.set(shape, (unparsedShapes.get(shape) || 0) + 1);
    }
    updates.push({ id: row.id, objectId, text, ...columns });
  }

  updates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const topUnparsedShapes = [...unparsedShapes]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([shape, count]) => ({ shape, count }));

  return { counts, updates, topUnparsedShapes };
}

/**
 * One row's update. `custom_metadata` is merged, not replaced, and a value
 * that is not valid JSON is left exactly as it is rather than overwritten
 * with an object holding only the dimension text.
 */
export function buildNgaDimensionUpdateSql(update) {
  if (!/^\d+$/.test(update.objectId)) {
    throw new Error('dimension update requires a decimal NGA object id');
  }
  return `UPDATE artworks SET
  dimensions_height = ${sqlNumber(update.dimensions_height)},
  dimensions_width = ${sqlNumber(update.dimensions_width)},
  dimensions_depth = ${sqlNumber(update.dimensions_depth)},
  dimensions_unit = ${update.dimensions_unit ? sqlString(update.dimensions_unit) : 'NULL'},
  custom_metadata = CASE
    WHEN custom_metadata IS NULL OR custom_metadata = '' THEN json_object('dimensions_text', ${sqlString(update.text)})
    WHEN json_valid(custom_metadata) THEN json_set(custom_metadata, '$.dimensions_text', ${sqlString(update.text)})
    ELSE custom_metadata
  END
WHERE id = ${sqlString(update.id)} AND source_record_id = ${sqlString(update.objectId)};`;
}

/**
 * The batches still to run after a cursor.
 *
 * The cursor is the last artwork id whose batch D1 confirmed. Updates are in
 * id order, so resuming is "everything after it", and re-running a batch
 * that was applied but not recorded is harmless because every statement sets
 * absolute values.
 */
export function pendingBatches(updates, { after = null, batchSize }) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }
  const remaining = after ? updates.filter((update) => update.id > after) : updates;
  const batches = [];
  for (let offset = 0; offset < remaining.length; offset += batchSize) {
    batches.push(remaining.slice(offset, offset + batchSize));
  }
  return batches;
}
