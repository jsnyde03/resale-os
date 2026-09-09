#!/usr/bin/env node
/**
 * Nothing the phone bundles may reach `node:*`.
 *
 * ⛔ **The existing import lint checks DIRECT imports, one level deep.** That
 * is not the property that matters here. `src/server/views.ts` imports no node
 * builtin — it imports `src/db/backup.js`, which imports `node:fs` at module
 * level, and pulling `views.ts` into a React Native bundle drags the whole
 * desktop backup implementation in with it. A one-level check sees nothing.
 *
 * So this walks the graph. It starts from every `src/` module the phone
 * actually imports, follows every relative import transitively, and fails if
 * any module on that closure imports a node builtin.
 *
 * ⚠️ **The roots are DISCOVERED, not listed.** Every hand-written list of
 * places to look on this project has turned out short — three times in two
 * days. The roots come from scanning `mobile/` for what it imports, so a new
 * screen reaching a new corner of `src/` is covered the moment it is written.
 *
 * Run: node scripts/check-phone-bundle.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const toPosix = (p) => p.split(sep).join('/');

/** Bare specifiers that cannot exist on a device. */
const NODE_BUILTIN = /^node:/;

function* walkFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'ios' || entry === 'android') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walkFiles(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

const IMPORT_RE = /(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]/g;

function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
}

/**
 * `./foo.js` in TypeScript ESM means `./foo.ts` on disk. Resolve to whatever
 * actually exists, and return null for anything outside `src/` — a package is
 * Metro's problem, not this gate's.
 */
function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    base,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// --- the roots: every `src/` module the phone imports ----------------------

const roots = new Set();
for (const file of walkFiles(join(ROOT, 'mobile'))) {
  for (const spec of importsOf(file)) {
    const resolved = resolveRelative(file, spec);
    if (resolved && toPosix(relative(ROOT, resolved)).startsWith('src/')) roots.add(resolved);
  }
}

if (roots.size === 0) {
  console.error('phone bundle: found no src/ imports from mobile/ — the roots are discovered by');
  console.error('scanning, so zero means the scan is broken, not that the app imports nothing.');
  process.exit(1);
}

// --- the closure, and what it reaches --------------------------------------

/** file -> the file that first pulled it in, so a failure can name the path. */
const seen = new Map();
const queue = [];
for (const root of roots) {
  seen.set(root, null);
  queue.push(root);
}

const failures = [];

while (queue.length > 0) {
  const file = queue.shift();
  const rel = toPosix(relative(ROOT, file));

  for (const spec of importsOf(file)) {
    if (NODE_BUILTIN.test(spec)) {
      // Reconstruct how the phone got here.
      const chain = [rel];
      let at = seen.get(file);
      while (at) {
        chain.unshift(toPosix(relative(ROOT, at)));
        at = seen.get(at);
      }
      failures.push(`${rel} imports "${spec}"\n      reached by: ${chain.join(' -> ')}`);
      continue;
    }
    const resolved = resolveRelative(file, spec);
    if (!resolved || seen.has(resolved)) continue;
    seen.set(resolved, file);
    queue.push(resolved);
  }
}

if (failures.length > 0) {
  console.error('The phone bundle reaches node builtins:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  console.error('A module the app imports may not reach node:fs, node:sqlite or any other');
  console.error('builtin, however many hops away. Split the platform-specific half out —');
  console.error('`db-types.ts`, `migrate-core.ts`, `backup-types.ts` and `open-store.ts` all');
  console.error('exist for exactly this reason.');
  process.exit(1);
}

console.log(`phone bundle: clean (${roots.size} roots, ${seen.size} modules reachable)`);
