#!/usr/bin/env node
/**
 * The dependency direction is one-way: core <- scoring <- domain <- db <- cli.
 *
 * `src/core/**` is the deterministic financial engine. If it ever imports from
 * `db`, `cli`, `server` or `scoring`, it stops being testable in isolation and a
 * UI change can reach the money. That is architecture rule A1, and until now it
 * was enforced by nothing but attention.
 *
 * Backlog B2, and the reason it was worth writing: an import is one keystroke.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** layer -> layers it must NOT import from. */
const FORBIDDEN = {
  'src/core': ['src/db', 'src/cli', 'src/server', 'src/scoring', 'src/domain', 'src/adapters'],
  'src/scoring': ['src/db', 'src/cli', 'src/server', 'src/adapters'],
  'src/domain': ['src/db', 'src/cli', 'src/server'],
  // Gate 4. The screens read the ledger through `src/server/views.ts` and
  // nowhere else. Reaching `src/db` directly is how a component ends up
  // summing postings itself, which is a SECOND implementation of a number the
  // engine already owns — the one thing 4.2 exists to prevent.
  'src/app': ['src/db', 'src/cli'],
  // The pure form models the write screens are made of. They may reach core;
  // reaching the store would make a screen able to write without going through
  // the one place that refreshes every other screen.
  'src/ui': ['src/db', 'src/cli', 'src/server', 'src/app'],
  // 5.10.3. The screen MODELS — what a screen renders, decided outside the
  // `.tsx` so it can be tested where there is no browser and no device.
  // They may read downward (`db` included: `views.ts` needs the store's
  // reader types and the reporting queries), never sideways into a
  // surface. ⛔ `src/server` and `src/app` are BOTH being deleted at
  // 5.10.4, and an import of either would quietly re-tether the phone to
  // the desktop it is replacing.
  'src/screens': ['src/cli', 'src/server', 'src/app'],
};

/** Modules the pure layers may not touch, however they are reached. */
const FORBIDDEN_MODULES = {
  'src/core': ['node:sqlite', 'node:fs', 'node:child_process', 'node:http', 'node:https'],
  'src/scoring': ['node:sqlite', 'node:fs', 'node:child_process'],
  'src/domain': ['node:sqlite', 'node:child_process'],
  'src/app': ['node:sqlite'],
  'src/ui': ['node:sqlite', 'node:fs', 'node:child_process'],
};

const toPosix = (p) => p.split(sep).join('/');

/** Generated or vendored trees. Nothing here is ours to judge. */
const SKIP_DIRS = new Set(['node_modules', 'ios', 'android', '.expo', '.next', 'dist', '.git']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) yield path;
  }
}

const IMPORT_RE = /(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]/g;

/**
 * ⛔ Screens must not do arithmetic on money.
 *
 * `views.ts` states it and 4.11 broke it three times anyway, which is what a
 * rule with no enforcement is worth. `formatCents` renders it and
 * `toDollarsInput` makes it editable; dividing cents by 100 in a component is
 * how `-$0.00` and off-by-one rounding appear in two places at once.
 */
const MONEY_ARITHMETIC = /\w*Cents\s*[/*]\s*100|100\s*\*\s*\w*Cents/;

const failures = [];

for (const [layer, banned] of Object.entries(FORBIDDEN)) {
  // A layer that does not exist yet is not a violation.
  if (!existsSync(join(ROOT, layer))) continue;
  for (const file of walk(join(ROOT, layer))) {
    const rel = toPosix(relative(ROOT, file));
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];

      // Bare specifiers: node builtins and packages.
      if (!spec.startsWith('.')) {
        for (const mod of FORBIDDEN_MODULES[layer] ?? []) {
          if (spec === mod || spec.startsWith(`${mod}/`)) {
            failures.push(`${rel} imports "${spec}" — ${layer} may not touch ${spec} directly`);
          }
        }
        continue;
      }

      // Relative specifiers: resolve enough to see which layer they land in.
      const fromDir = rel.slice(0, rel.lastIndexOf('/'));
      const resolved = [];
      for (const part of `${fromDir}/${spec}`.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') resolved.pop();
        else resolved.push(part);
      }
      const target = resolved.join('/');

      for (const bannedLayer of banned) {
        if (target.startsWith(`${bannedLayer}/`)) {
          failures.push(`${rel} imports from ${bannedLayer} ("${spec}") — direction is one-way`);
        }
      }
    }
  }
}

// The money-arithmetic sweep, over every screen surface. `src/core` is where
// that arithmetic belongs and is tested.
//
// ⛔ **`mobile/` was missing from this list until 2026-09-09, and by then the
// sell screen had broken the rule three times in one file.** The list was
// written when the only screens were Gate 4's; a new corpus does not announce
// itself to an enumerated scope. This is the third time on this project that a
// hand-written list of places to look has been short — search the tree, or at
// minimum re-read the list every time a directory is born.
// ⚡ **INVERTED 2026-09-10.** This used to iterate a hand-written list of the
// places screens live, and the comment above told the next reader to "search
// the tree" — which the code then did not do. An allowlist of places to LOOK
// goes stale in silence: a new directory simply is not checked, and nothing
// says so. An exemption list goes stale LOUDLY — a new corpus is swept by
// default, and anything that genuinely belongs outside the rule has to be named
// here, deliberately, in a diff somebody reads.
//
// Same shape as `validatePolicy`, which is exhaustive by construction off a
// defaults object's keys rather than off a field list somebody maintains.
//
// ⚠️ Measured before adopting: sweeping the whole tree minus `src/core`
// produced **zero** new violations, so this is identical behaviour today and
// different behaviour the day a directory is born.
const MONEY_EXEMPT = [
  // Where money arithmetic BELONGS, and is tested. `formatCents` lives here.
  'src/core/',
];

for (const dir of ['src', 'mobile']) {
  if (!existsSync(join(ROOT, dir))) continue;
  for (const file of walk(join(ROOT, dir))) {
    const rel = toPosix(relative(ROOT, file));
    if (MONEY_EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
    const source = readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((line, i) => {
      if (MONEY_ARITHMETIC.test(line)) {
        failures.push(
          `${rel}:${i + 1} does arithmetic on cents — use formatCents() or toDollarsInput()`,
        );
      }
    });
  }
}

// ⛔ **A LAYER WITH NO RULES MUST NOT BE SILENT.**
//
// `src/adapters` existed for the whole life of this gate with no entry in
// `FORBIDDEN` — named in other layers' forbidden lists, but carrying no rules of
// its own, so it could have imported `node:sqlite`, `src/cli`, anything. It
// happened to be EMPTY, so nothing was violated; the gate simply had no opinion,
// and would not have gained one the day a file appeared.
//
// So every directory under `src/` that actually contains source must be
// declared — restricted below, or listed here as deliberately unrestricted.
// A new layer now red-gates until somebody decides what it may import, which is
// a decision worth forcing while the layer has one file rather than forty.
const UNRESTRICTED = new Set([
  // The composition layers. They sit at the top of the dependency order and are
  // expected to reach downward freely; `src/cli` is retired at 5.10 anyway.
  'src/db',
  'src/cli',
  'src/server',
]);

for (const entry of readdirSync(join(ROOT, 'src'))) {
  const layer = `src/${entry}`;
  if (!statSync(join(ROOT, layer)).isDirectory()) continue;
  if (layer in FORBIDDEN || UNRESTRICTED.has(layer)) continue;
  // An empty directory is not a layer yet. The rule bites when source arrives.
  if ([...walk(join(ROOT, layer))].length === 0) continue;
  failures.push(
    `${layer} has source but no import rules — add it to FORBIDDEN, or to ` +
      `UNRESTRICTED if it is deliberately unconstrained`,
  );
}

if (failures.length > 0) {
  console.error('Import-direction violations:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  console.error('Direction is one-way: core <- scoring <- domain <- db <- cli.');
  console.error('src/core must not import from db, cli, server, scoring or domain.');
  console.error('src/app reads the ledger through src/server/views.ts and nowhere else.');
  process.exit(1);
}

console.log('import direction: clean');
