/**
 * Migrations are numbered `.sql` files applied in order, once each.
 * They are append-only: never edit a file that has already been applied.
 *
 * ⚠️ A file whose first line is `-- self-managed` runs OUTSIDE the runner's
 * transaction and is responsible for its own `BEGIN`/`COMMIT`.
 *
 * That exists for exactly one reason: SQLite cannot alter a `CHECK` constraint
 * in place, so changing one means rebuilding the table — and a rebuild of a
 * table other tables reference needs `PRAGMA foreign_keys = OFF`, which SQLite
 * ignores inside a transaction. Measured, not assumed: `defer_foreign_keys`
 * does NOT survive the `DROP TABLE`, and the rebuild fails with a foreign key
 * violation. Only turning them off works.
 *
 * A self-managed file MUST be safe to re-run, because the runner records it
 * only after the file's own transaction has committed, and a crash in that gap
 * would otherwise strand it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db-types.js';
import { migrateWith } from './migrate-core.js';
import type { BundledMigration } from './migrations.generated.js';

// The platform-free half. Re-exported so every existing import still works.
export {
  migrateWith,
  isSelfManaged,
  type MigrationRecord,
} from './migrate-core.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function listMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Read the migrations off disk. Node only — a phone has no filesystem, which is
 * why `migrateWith()` takes the list as DATA and this is one way to produce it.
 */
export function migrationsFromDisk(dir = MIGRATIONS_DIR): BundledMigration[] {
  return listMigrationFiles(dir).map((name) => ({
    name,
    // Normalised to LF to match the generated bundle — line endings are a
    // checkout artefact, and the two must be comparable across platforms.
    sql: readFileSync(join(dir, name), 'utf8')
      .split(String.fromCharCode(13, 10))
      .join(String.fromCharCode(10)),
  }));
}

/** The desktop entry point: read the directory, then apply. */
export function migrate(db: Db, now: string, dir = MIGRATIONS_DIR): string[] {
  return migrateWith(db, now, migrationsFromDisk(dir));
}
