#!/usr/bin/env node
/**
 * ⛔ **MASTER_PLAN.md is the point of truth and NOTHING read it until now.**
 *
 * Every other artefact in this repo is gated. The one document that says what is
 * being built, what is done, and what is owed to Jason was checked by eye, and
 * on 2026-09-11 that failed twice in one session:
 *
 * 1. **Four duplicate `## Queue` headings** accumulated across at least eight
 *    commits. Each plan edit that inserted a section before the queue left
 *    another marker behind, and every one of those commits was pushed.
 * 2. **A log entry and a commit message described Gate 7.5 as decomposed and
 *    7.5.1 as done, while the plan still said "Open"** — because the script that
 *    was meant to edit the plan threw on a bad anchor, and the log append and
 *    the commit that followed it were separated by NEWLINES rather than `&&`, so
 *    they ran anyway. ⚠️ **That exact failure is recorded in this repo from the
 *    morning of the same day**, with the fix — *"chain with `&&`"* — written
 *    down. It lasted one day as a thing to remember.
 *
 * ⚡ **So it stops being a thing to remember.** A rule holds when it is built
 * into the mechanism.
 *
 * ⚠️ **What this deliberately does NOT check:** whether an item is terse, whether
 * a decomposition is sensible, whether the wording is honest. No script can
 * judge prose, and pretending otherwise would make this feel like coverage it
 * does not have. It checks STRUCTURE, which is exactly the class that failed.
 *
 * Run: node scripts/check-plan.mjs
 */

import { readFileSync } from 'node:fs';

const PLAN = 'MASTER_PLAN.md';
const text = readFileSync(PLAN, 'utf8');
const lines = text.split(/\r?\n/);
const failures = [];

// --- 1. No duplicate top-level headings ------------------------------------
//
// The corruption that shipped: `## Queue` five times over. A section heading
// names a place, and two places with one name means at least one of them is
// unreachable to a reader.
const headings = new Map();
lines.forEach((line, i) => {
  const m = /^(##\s+.*?)\s*$/.exec(line);
  if (!m) return;
  const key = m[1];
  if (!headings.has(key)) headings.set(key, []);
  headings.get(key).push(i + 1);
});
for (const [heading, at] of headings) {
  if (at.length > 1) {
    failures.push(`"${heading}" appears ${at.length} times, at lines ${at.join(', ')}`);
  }
  // ⛔ **A heading with a rule fused onto it**, which is the shape that actually
  // shipped: `## Queue---`. ⚠️ My first version of this check looked only for
  // DUPLICATES and missed it — `## Queue---` is not a duplicate of `## Queue`,
  // it is a different, broken heading, and the check reported "clean" while
  // counting it as a legitimate new section. **Planting the real corruption
  // rather than an approximation of it is what found that.**
  if (/-{2,}\s*$/.test(heading)) {
    failures.push(`"${heading}" at line ${at[0]} has a horizontal rule fused onto it`);
  }
}

// --- 2. Exactly one decomposed section --------------------------------------
//
// ⛔ The rule this project states in its own header — "Exactly ONE decomposed
// section on this page — the active item's" — and which nothing enforced.
// Decomposition is a snapshot of a premise; a second one keeps ageing while
// attention is elsewhere, and a reader cannot tell which sequence is live.
const openSubSteps = [...text.matchAll(/^- \[ \] \*\*(\d+(?:\.\d+)+)\*\*/gm)].map((m) => m[1]);
const gatesWithOpenSteps = [
  ...new Set(openSubSteps.map((id) => id.split('.').slice(0, 2).join('.'))),
];
if (gatesWithOpenSteps.length > 1) {
  failures.push(
    `${gatesWithOpenSteps.length} decomposed sections (${gatesWithOpenSteps.join(', ')}) — ` +
      `the plan's own rule allows exactly one, the active item's`,
  );
}

// --- 3. The queue table and the decomposition must agree --------------------
//
// ⛔ The second failure: a log entry describing work the queue did not contain.
// If a gate is decomposed it is being built, and the row must say so — and if a
// row says ACTIVE BUILD there must be sub-steps under it.
const activeRows = [...text.matchAll(/^\| (\d+(?:\.\d+)?) \|.*?ACTIVE BUILD/gm)].map((m) => m[1]);
if (activeRows.length > 1) {
  failures.push(`${activeRows.length} rows claim ACTIVE BUILD (${activeRows.join(', ')})`);
}
for (const gate of gatesWithOpenSteps) {
  if (!activeRows.includes(gate)) {
    failures.push(
      `gate ${gate} has open sub-steps but its queue row does not say ACTIVE BUILD — ` +
        `the plan is describing work the queue does not admit to`,
    );
  }
}
for (const gate of activeRows) {
  if (!gatesWithOpenSteps.includes(gate)) {
    failures.push(
      `gate ${gate}'s row says ACTIVE BUILD but nothing is decomposed under it — ` +
        `either it is done, or its sub-steps never landed`,
    );
  }
}

// --- 4. Sub-step ids are unique ---------------------------------------------
//
// ⚠️ A repeated id means an edit landed twice, which is how the duplicate
// headings began.
const allSubSteps = [...text.matchAll(/^- \[[ x]\] \*\*(\d+(?:\.\d+)+)\*\*/gm)].map((m) => m[1]);
const seen = new Set();
for (const id of allSubSteps) {
  if (seen.has(id)) failures.push(`sub-step ${id} is listed more than once`);
  seen.add(id);
}

if (failures.length > 0) {
  console.error(`${PLAN} is structurally wrong:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  console.error('The plan is the point of truth. A reader cannot tell which sequence is live');
  console.error('when it contradicts itself, and no test catches a plan that lies.');
  process.exit(1);
}

console.log(
  `plan: clean (${headings.size} sections, ${allSubSteps.length} sub-steps, ` +
    `active: ${gatesWithOpenSteps.join(', ') || 'none'})`,
);
