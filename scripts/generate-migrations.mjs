#!/usr/bin/env node
/**
 * Bundle the `.sql` migrations into a TypeScript module.
 *
 * ⛔ A phone has no filesystem to read them from. `migrate()` used
 * `readdirSync`/`readFileSync`, which is correct on a desktop and impossible in
 * React Native, so the SQL becomes source.
 *
 * ⚠️ Generated files rot. `tests/migrations-bundle.test.ts` compares this
 * module against the directory byte for byte and fails if they differ — so a
 * new `.sql` file that nobody regenerated reds the suite rather than silently
 * never running on the phone.
 *
 * Regenerate with:  node scripts/generate-migrations.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'src', 'db', 'migrations');
const OUT = join(HERE, '..', 'src', 'db', 'migrations.generated.ts');

/** Line endings are a checkout artefact, not content. */
export function normaliseEol(text) {
  return text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
}

export function readMigrations(dir = MIGRATIONS) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // ⛔ Normalised to LF. Git checks these out CRLF on Windows and LF on a
    // Linux runner, so a bundle generated on one machine will never match the
    // directory on the other — which is exactly how CI failed on 2026-09-09.
    // SQLite does not care about line endings; the GATE does.
    .map((name) => ({ name, sql: normaliseEol(readFileSync(join(dir, name), 'utf8')) }));
}

export function renderModule(migrations) {
  // A template literal would need every backtick and ${ escaped; JSON.stringify
  // handles quoting, newlines and unicode without a hand-written escaper.
  const entries = migrations
    .map((m) => `  { name: ${JSON.stringify(m.name)}, sql: ${JSON.stringify(m.sql)} },`)
    .join('\n');
  return `/**
 * GENERATED — do not edit. Run: node scripts/generate-migrations.mjs
 *
 * The migrations as source rather than as files, because React Native has no
 * filesystem to read them from. \`tests/migrations-bundle.test.ts\` asserts this
 * matches \`src/db/migrations/\` exactly, so it cannot drift.
 */

export interface BundledMigration {
  readonly name: string;
  readonly sql: string;
}

export const BUNDLED_MIGRATIONS: readonly BundledMigration[] = [
${entries}
];
`;
}

if ((process.argv[1] ?? '').endsWith('generate-migrations.mjs')) {
  const migrations = readMigrations();
  writeFileSync(OUT, renderModule(migrations), 'utf8');
  console.log(`bundled ${migrations.length} migration(s) → src/db/migrations.generated.ts`);
}
