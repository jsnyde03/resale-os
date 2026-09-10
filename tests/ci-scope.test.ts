/**
 * The device lane must run when the code it executes changes.
 *
 * ⛔ **B67.** `driver-contract-ios.yml` names the directories a device run
 * depends on in a hand-written `paths:` filter, and it has been short three
 * times: `src/ui` when the form models were born, then `src/server` (5.8) and
 * `src/scoring` (5.9c) in the same item. Each time the on-device contract was
 * executing code whose changes could not trigger it — **a green that means "did
 * not run", presented identically to a green that means "passed"**.
 *
 * ⚡ The closure is not a mystery: `check-phone-bundle.mjs` already DISCOVERS it
 * by scanning `mobile/` and following every relative import. The filter simply
 * never had to answer to it. This test makes it answer.
 *
 * ⚠️ The two sides come from genuinely different places — one computed by
 * walking the import graph, one typed by a person into YAML. That is what makes
 * it a control rather than a restatement.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = '.github/workflows/driver-contract-ios.yml';

/** The `src/` layers the phone actually reaches, transitively. */
function layersThePhoneReaches(): string[] {
  const out = execFileSync('node', ['scripts/check-phone-bundle.mjs', '--print-layers'], {
    encoding: 'utf8',
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/**
 * The quoted entries under the workflow's `paths:` key.
 *
 * ⚠️ Scoped to the block rather than grepping the whole file, so a directory
 * merely MENTIONED in a comment cannot satisfy the assertion. The file is dense
 * with comments naming exactly these paths, which is precisely how a check like
 * this passes while asserting nothing.
 */
function workflowPathFilter(): string[] {
  const lines = readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*paths:\s*$/.test(l));
  if (start === -1) throw new Error(`no paths: block in ${WORKFLOW}`);

  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const match = /^\s*-\s*'([^']+)'\s*$/.exec(line);
    if (!match) break; // the block ended
    entries.push(match[1] as string);
  }
  return entries;
}

describe('the iOS lane runs when the code it executes changes', () => {
  it('covers every src/ layer the phone reaches', () => {
    const layers = layersThePhoneReaches();
    const filter = workflowPathFilter();

    // A scan that found nothing would make every assertion below vacuously
    // true. It has happened on this project.
    expect(layers.length).toBeGreaterThan(3);
    expect(filter.length).toBeGreaterThan(3);

    const uncovered = layers.filter((layer) => !filter.includes(`${layer}/**`));
    expect(uncovered).toEqual([]);
  });

  it('watches mobile/ and its own definition', () => {
    // Not derivable from the closure — the app's own source, and the file that
    // decides when any of this runs at all.
    const filter = workflowPathFilter();
    expect(filter).toContain('mobile/**');
    expect(filter).toContain(WORKFLOW);
  });
});
