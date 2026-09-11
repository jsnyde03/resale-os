/**
 * What the RULES are — as opposed to what the numbers are.
 *
 * ⛔ **`Policy.version` versions the numbers, and that is not enough.** It is
 * stored config: it moves when the operator edits a cap or a floor. It does
 * **not** move when the CODE changes what a verdict means — and on 2026-09-11
 * that happened twice in one day. 6.1.0 added `VELOCITY_COUNTS_UNBOUNDED`; 6.6
 * made every gate field required and gave the abstaining one a voice. Both
 * changed what "passes" means with `Policy.version` sitting at `2026-09-08.5`,
 * so **every score recorded before that day reads as scored under today's
 * rules.** Backlog **B88**.
 *
 * The instrument that suffers is the rejection histogram: it counts STORED
 * codes, so it mixes rule sets and under-counts whichever gate is newest. That
 * chart is how the fund answers *"why is nothing passing?"*, which makes a
 * silent mix the wrong kind of wrong.
 *
 * ## ⛔ Why this is a FINGERPRINT and not a version string
 *
 * A hand-maintained `RULES_VERSION = '3'` is an enumerated list with one entry,
 * and this project has watched that shape go stale five separate times — the
 * iOS lane's `paths:` filter (four times) and `validatePolicy`'s field list,
 * which let `minSellThroughBps` through as `NaN`. **Anything a person must
 * remember to bump is a thing that will not get bumped.**
 *
 * ⚠️ **And hashing `CONSTRAINT_CODES` alone would not be enough either** — it
 * would catch 6.1.0 and miss 6.6, which is the change that motivated this file.
 * A gate can change what it DECIDES without the list of gate names moving.
 *
 * So the identity is taken from **behaviour**: run the real evaluator over a
 * fixed reference candidate and fingerprint the verdict it produces — every
 * gate's code, whether it passed, and every declared abstention. Anything that
 * changes what the rules DO changes this string; nothing else does.
 *
 * ⚠️ **It deliberately fingerprints the code at DEFAULT settings.** The stored
 * policy is already covered by `Policy.version`, and the two together say what
 * a verdict depended on: the numbers in the database, and the rules in the
 * binary.
 *
 * Pure. No I/O, no clock. The value is computed once, lazily.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { assessPurchase, type PurchaseCandidate } from './constraints.js';
import { initialFundState } from './state.js';
import { DEFAULT_POLICY } from './policy.js';
import { emptyBalances } from './state.js';
import { ACCOUNTS } from '../ledger/accounts.js';
import type { FundState } from './state.js';

/**
 * ⚠️ **Chosen to sit near several gate boundaries, not to pass or fail.**
 *
 * A candidate that comfortably passes everything would be blind to a threshold
 * moving; one that fails everything would be blind to a gate being removed. The
 * fingerprint is over the whole per-gate verdict rather than the final answer,
 * so what matters is that every gate has something to say about it.
 *
 * ⛔ **Do not "fix" this candidate if a change makes it fail.** It is a probe,
 * not a fixture — a changed fingerprint is the signal working.
 */
const REFERENCE_CANDIDATE: PurchaseCandidate = {
  category: 'REFERENCE',
  landedCostCents: 1_000,
  expectedDaysToSale: 12,
  modeledDownsideCents: 400,
  expectedNetProfitCents: 1_200,
  expectedRoiBps: 12_000,
  confidenceBps: 6_000,
  buyScore: 70,
  riskScore: 40,
  sellThroughBps: 7_000,
  boundsAreOptimistic: false,
};

/** A fund with enough in it that the capital gates have room to differ. */
function referenceState(): FundState {
  const base = initialFundState(DEFAULT_POLICY);
  const balances = emptyBalances();
  // A $75 bankroll, as a contribution would leave it. Written through the
  // account list so a new account cannot silently unbalance the probe.
  for (const account of ACCOUNTS) balances[account] = 0;
  balances.LIQUID = 7_500;
  balances.CONTRIBUTED_CAPITAL = -7_500;
  return { ...base, balances };
}

let cached: string | undefined;

/**
 * A short, stable fingerprint of what the gates currently DO.
 *
 * ⚡ Stored beside `policy_version` on every score, so a stored verdict can be
 * told apart from one today's rules would give.
 */
export function rulesIdentity(): string {
  if (cached !== undefined) return cached;
  const a = assessPurchase(referenceState(), REFERENCE_CANDIDATE);
  // ⛔ Every gate's code AND its outcome, plus every abstention and its reason.
  // Sorted, so a change in the order gates are pushed is not a change in the
  // rules — this must move when behaviour moves and not before.
  const shape = [
    ...a.results.map((r) => `${r.code}:${r.passed ? 'pass' : 'fail'}`),
    ...a.abstentions.map((x) => `${x.code}:abstain:${x.because}`),
  ]
    .sort()
    .join('|');
  cached = bytesToHex(sha256(new TextEncoder().encode(shape))).slice(0, 8);
  return cached;
}

/**
 * ⛔ **An absent identity is UNKNOWN, never a match.**
 *
 * Every score recorded before this existed has no identity, and the honest
 * reading of that is *"scored under rules we can no longer name"* — which is
 * exactly the situation B88 describes. Treating absence as agreement would
 * re-create the bug this file exists to remove.
 */
export function rulesAreStale(storedIdentity: string | null | undefined): boolean {
  return storedIdentity === null || storedIdentity === undefined
    ? true
    : storedIdentity !== rulesIdentity();
}
