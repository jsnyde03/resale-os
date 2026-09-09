/**
 * Applying migrations, with no filesystem.
 *
 * ⚠️ Split from `migrate.ts` on 2026-09-09 for the phone port. Reading a
 * DIRECTORY is a desktop concern; APPLYING a list is not, and the phone gets
 * its list from `migrations.generated.ts`. The identical function runs on both.
 */

import type { Db } from './db-types.js';
import { BUNDLED_MIGRATIONS, type BundledMigration } from './migrations.generated.js';

export interface MigrationRecord {
  name: string;
  applied_at: string;
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )
  `);
}

/** Opt-out marker, and it must be the FIRST line so it cannot hide in a comment block. */
export function isSelfManaged(sql: string): boolean {
  return (sql.split('\n')[0] ?? '').trim() === '-- self-managed';
}

/**
 * Apply every migration that has not run yet.
 *
 * ⚠️ Takes the migrations as a LIST rather than a directory, so the identical
 * function runs on a desktop and on a phone. `BUNDLED_MIGRATIONS` is the
 * generated default; `migrationsFromDisk()` is what the Node tests pass to
 * prove the two agree.
 */
export function migrateWith(
  db: Db,
  now: string,
  migrations: readonly BundledMigration[] = BUNDLED_MIGRATIONS,
): string[] {
  ensureMigrationsTable(db);
  const applied = new Set(
    db.all<MigrationRecord>('SELECT name, applied_at FROM schema_migrations').map((r) => r.name),
  );

  const ran: string[] = [];
  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;
    if (isSelfManaged(sql)) {
      // The file owns its transaction and its pragmas. Recording it afterwards
      // is why it has to be re-runnable — see the note at the top of this file.
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, now]);
    } else {
      db.transaction(() => {
        db.exec(sql);
        db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, now]);
      });
    }
    ran.push(name);
  }
  return ran;
}

