#!/usr/bin/env node
/**
 * Fails if any tracked source file contains a control byte.
 *
 * Why this exists: a literal NUL once landed inside a string in
 * `src/db/hash.ts`. It compiled, every test passed, and the only symptom was
 * git quietly reclassifying the file as binary — so it produced no diffs. An
 * invisible byte in source is a class of defect that review cannot catch, so it
 * is gated instead of remembered.
 *
 * Allowed: tab (0x09), LF (0x0a), CR (0x0d). Everything else below 0x20, plus
 * DEL (0x7f), is a failure.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'dist', '.next', 'coverage']);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql', '.json', '.md', '.yml', '.yaml'];

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) yield path;
  }
}

const failures = [];
for (const path of walk(ROOT)) {
  const bytes = readFileSync(path);
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if ((b < 0x20 && !ALLOWED.has(b)) || b === 0x7f) {
      const line = bytes.subarray(0, i).toString('utf8').split('\n').length;
      failures.push(
        `${relative(ROOT, path)}:${line} contains control byte 0x${b.toString(16).padStart(2, '0')}`,
      );
      break; // one report per file is enough to send someone looking
    }
  }
}

if (failures.length > 0) {
  console.error('Control bytes found in source:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('source bytes: clean');
