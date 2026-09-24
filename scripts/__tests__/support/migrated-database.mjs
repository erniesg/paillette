import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * The schema D1 actually has, built from the migrations.
 *
 * Two early migrations do not run under plain SQLite — 0003 uses a `COMMENT`
 * clause and 0004 re-adds columns a later rebuild already carries — and
 * neither touches the dimension columns, so they are skipped by name rather
 * than by swallowing every error.
 */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/migrations'
);
const SQLITE_INCOMPATIBLE_MIGRATIONS = new Set([
  '0003_add_translation_tables.sql',
  '0004_add_color_extraction_columns.sql',
]);

export const migratedDatabase = () => {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith('.sql') || SQLITE_INCOMPATIBLE_MIGRATIONS.has(file)) {
      continue;
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
};
