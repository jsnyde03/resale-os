/**
 * The second, independent derivation of fund state.
 *
 * `FundStore.derivedState()` reads balances out of the postings table and items
 * out of the items table — deliberately not `state()`, whose cache holds the
 * engine's own last answer.
 * `replay()` ignores both and re-applies every stored command
 * through the engine from an empty fund. If the two disagree, either a write
 * path is lossy or the engine is not deterministic — and a test asserts they
 * never do.
 *
 * This is the control that a round-trip through one encoder cannot give you:
 * the two sides are produced by genuinely different code.
 */

import { applyCommand } from '../core/capital/engine.js';
import type { Command } from '../core/capital/commands.js';
import type { FundState } from '../core/capital/state.js';
import { initialFundState } from '../core/capital/state.js';
import type { Policy } from '../core/capital/policy.js';
import { ACCOUNTS } from '../core/ledger/accounts.js';
import type { LedgerReader } from './store.js';

export function replay(store: LedgerReader, policy?: Policy): FundState {
  let state = initialFundState(policy ?? store.policy(), store.taxProfile());
  for (const row of store.events()) {
    const command = JSON.parse(row.payload_json) as Command;
    state = applyCommand(state, command).state;
  }
  return state;
}

type ItemField = keyof FundState['items'][string];

/** The union of both records' keys, so a field only one side has still shows. */
function itemFields(
  a: FundState['items'][string],
  b: FundState['items'][string],
): ItemField[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort() as ItemField[];
}

/**
 * `overrodeGates` is an array, so `!==` would report every purchase as a
 * difference. Structural comparison via JSON is enough here because item
 * records hold only strings, numbers, booleans and string arrays.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function describe(v: unknown): string {
  return v === undefined ? '(absent)' : JSON.stringify(v);
}

export interface ReconciliationReport {
  readonly ok: boolean;
  readonly differences: readonly string[];
}

export function reconcile(store: LedgerReader): ReconciliationReport {
  // ⛔ `derivedState()`, never `state()`. After a commit the cache holds the
  // engine's own output, so comparing it to an engine replay is one source
  // wearing two hats — it cannot fail. See the note on `derivedState`.
  const stored = store.derivedState();
  const replayed = replay(store, stored.policy);
  const differences: string[] = [];

  for (const account of ACCOUNTS) {
    if (stored.balances[account] !== replayed.balances[account]) {
      differences.push(
        `${account}: stored ${stored.balances[account]} vs replayed ${replayed.balances[account]}`,
      );
    }
  }

  const ids = new Set([...Object.keys(stored.items), ...Object.keys(replayed.items)]);
  for (const id of [...ids].sort()) {
    const a = stored.items[id];
    const b = replayed.items[id];
    if (!a || !b) {
      differences.push(`item ${id}: present in ${a ? 'stored' : 'replayed'} only`);
      continue;
    }
    // ⛔ EVERY field, not a hand-picked three. This compared book value, state
    // and realized profit only, and so a lossy write of any other column
    // reconciled clean — measured 2026-09-09 by planting a dropped
    // `overrode_gates` on the write path, which the whole suite passed.
    //
    // This project has been bitten by a hand-written field list before (a
    // read-model omission let `minSellThroughBps` through). A list is correct
    // until someone adds a field, and then it is silently wrong; taking the
    // union of both records' keys is correct by construction.
    for (const field of itemFields(a, b)) {
      const av = a[field];
      const bv = b[field];
      if (!sameValue(av, bv)) {
        differences.push(
          `item ${id} ${field}: stored ${describe(av)} vs replayed ${describe(bv)}`,
        );
      }
    }
  }

  if (stored.mode !== replayed.mode) {
    differences.push(`mode: stored ${stored.mode} vs replayed ${replayed.mode}`);
  }

  // Two genuinely different derivations: the store scans postings, the replay
  // re-runs the engine. They must agree, or the tax reserve is built on sand.
  if (stored.taxYear !== replayed.taxYear) {
    differences.push(`taxYear: stored ${stored.taxYear} vs replayed ${replayed.taxYear}`);
  }
  if (stored.ytdNetBusinessIncomeCents !== replayed.ytdNetBusinessIncomeCents) {
    differences.push(
      `ytd business income: stored ${stored.ytdNetBusinessIncomeCents} vs replayed ` +
        `${replayed.ytdNetBusinessIncomeCents}`,
    );
  }
  if (stored.ytdTaxReservedCents !== replayed.ytdTaxReservedCents) {
    differences.push(
      `ytd tax reserved: stored ${stored.ytdTaxReservedCents} vs replayed ` +
        `${replayed.ytdTaxReservedCents}`,
    );
  }

  return { ok: differences.length === 0, differences };
}
