/**
 * The generated migration bundle must match the directory exactly.
 *
 * ⛔ A generated file rots the moment someone adds a `.sql` and forgets to
 * regenerate — and the symptom would be the worst kind: the desktop runs the
 * new migration, the phone silently does not, and the two schemas diverge while
 * every test stays green. This is the gate that makes that impossible.
 */

import { describe, expect, it } from 'vitest';
import { BUNDLED_MIGRATIONS } from '@/db/migrations.generated.js';
import { migrationsFromDisk, listMigrationFiles, isSelfManaged } from '@/db/migrate.js';

describe('the bundled migrations match the directory', () => {
  it('has the same files, in the same order', () => {
    expect(BUNDLED_MIGRATIONS.map((m) => m.name)).toEqual(listMigrationFiles());
  });

  it('has byte-identical SQL for every one', () => {
    // Not a length or hash check — the actual text, because a truncated or
    // re-encoded migration would pass those and corrupt a schema.
    const onDisk = new Map(migrationsFromDisk().map((m) => [m.name, m.sql]));
    for (const { name, sql } of BUNDLED_MIGRATIONS) {
      expect(sql, `${name} differs from the file on disk — run: node scripts/generate-migrations.mjs`).toBe(
        onDisk.get(name),
      );
    }
  });

  it('is not empty, or the two assertions above are vacuous', () => {
    expect(BUNDLED_MIGRATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('preserves the self-managed marker, which is position-sensitive', () => {
    // `isSelfManaged` reads the FIRST line. A bundler that trimmed or reindented
    // would silently move migration 005 back inside the runner's transaction,
    // where its PRAGMA is ignored and the rebuild fails.
    // ⚠️ Asserted through `isSelfManaged` itself, not a copy of its logic. The
    // first version compared the raw first line and failed on a trailing `\r`
    // — these files are CRLF on this machine — which would have been a test bug
    // reported as a code bug. `isSelfManaged` trims, so behaviour was always
    // correct. This project has already shipped a gate whose regex assumed LF.
    const rebuild = BUNDLED_MIGRATIONS.find((m) => m.name.startsWith('005'));
    expect(rebuild).toBeDefined();
    expect(isSelfManaged(rebuild!.sql)).toBe(true);
    // And no other migration claims it, or the marker means nothing.
    for (const m of BUNDLED_MIGRATIONS.filter((x) => !x.name.startsWith('005'))) {
      expect(isSelfManaged(m.sql)).toBe(false);
    }
  });
});
