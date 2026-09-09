/**
 * FundStore — the only writer to the ledger.
 *
 * ⚠️ **Platform-free by construction as of 2026-09-09.** It imports no
 * `node:*` module, directly or transitively, so the identical class runs on a
 * desktop and on a phone. `FundStore.open(path)` used to live here and pulled
 * in `openDb` and the filesystem migration loader with it; opening a database
 * is a platform concern and now lives in `src/db/open-store.ts` (Node) and
 * `mobile/src/db/expo-driver.ts` (React Native).
 *
 * It owns the transaction boundary: postings, the item row and the expense rows
 * that justify an event are written together or not at all. The engine has
 * already asserted every invariant on the next state before a single row is
 * touched, so a rejected command leaves the database exactly as it was.
 *
 * There is deliberately no `update()` or `delete()` for events. A mistake is
 * corrected with an `ADJUSTMENT` event, which leaves both the error and the
 * correction visible.
 */

import { EngineError, applyCommand, type ApplyResult } from '../core/capital/engine.js';
import type { Command } from '../core/capital/commands.js';
import { saleCostTotal } from '../core/capital/commands.js';
import type { ExpenseCorrectionCommand } from '../core/capital/commands.js';
import {
  DEFAULT_POLICY,
  assertValidPolicy,
  type BankrollMode,
  type Policy,
} from '../core/capital/policy.js';
import type { FundState, ItemRecord, ItemState, ChargeOffReason } from '../core/capital/state.js';
import { emptyBalances } from '../core/capital/state.js';
import { resolveBankrollMode } from '../core/capital/metrics.js';
import { yearOf } from '../core/capital/state.js';
import {
  UNCONFIGURED_TAX_PROFILE,
  assertValidTaxProfile,
  type TaxProfile,
} from '../core/tax/profile.js';
import { DEFAULT_TAX_TABLES, type TaxTablesAcceptance } from '../core/tax/tables.js';
import { assertAllInvariants } from '../core/ledger/invariants.js';
import type { Account } from '../core/ledger/accounts.js';
import type { LedgerEvent } from '../core/ledger/types.js';
import type { Cents } from '../core/money.js';
import {
  DEFAULT_BACKUP_SETTINGS,
  EMPTY_BACKUP_STATE,
  type BackupSettings,
  type BackupState,
} from './backup-types.js';
import { OpportunityReader, OpportunityRepository } from './repositories/opportunities.js';
import { hashEvent } from './hash.js';
import { toParams, type Db, type ReadOnlyDb } from './db-types.js';

export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export interface StoredEvent {
  id: number;
  event_id: string;
  type: string;
  occurred_at: string;
  recorded_at: string;
  item_id: string | null;
  memo: string | null;
  payload_json: string;
  prev_hash: string | null;
  hash: string;
}

export interface PostingRow {
  event_id: string;
  seq: number;
  account: Account;
  amount_cents: number;
  memo: string | null;
}

interface ItemRow {
  item_id: string;
  opportunity_id: string | null;
  expected_net_proceeds_cents: number | null;
  expected_profit_cents: number | null;
  actual_net_proceeds_cents: number | null;
  name: string;
  category: string;
  acquired_at: string;
  landed_cost_cents: number;
  book_value_cents: number;
  expected_days_to_sale: number;
  expected_resale_cents: number;
  state: ItemState;
  charge_off_reason: ChargeOffReason | null;
  listing_live: number;
  marketplace: string | null;
  sold_at: string | null;
  days_to_sale: number | null;
  overrode_gates: string | null;
  override_reason: string | null;
  realized_profit_cents: number;
}

function rowToItem(r: ItemRow): ItemRecord {
  return {
    itemId: r.item_id,
    name: r.name,
    category: r.category,
    acquiredAt: r.acquired_at,
    landedCostCents: r.landed_cost_cents,
    bookValueCents: r.book_value_cents,
    expectedDaysToSale: r.expected_days_to_sale,
    expectedResaleCents: r.expected_resale_cents,
    state: r.state,
    ...(r.charge_off_reason !== null ? { chargeOffReason: r.charge_off_reason } : {}),
    listingLive: r.listing_live === 1,
    ...(r.marketplace !== null ? { marketplace: r.marketplace } : {}),
    ...(r.sold_at !== null ? { soldAt: r.sold_at } : {}),
    ...(r.days_to_sale !== null ? { daysToSale: r.days_to_sale } : {}),
    ...(r.opportunity_id !== null ? { opportunityId: r.opportunity_id } : {}),
    ...(r.expected_net_proceeds_cents !== null
      ? { expectedNetProceedsCents: r.expected_net_proceeds_cents }
      : {}),
    ...(r.expected_profit_cents !== null
      ? { expectedProfitCents: r.expected_profit_cents }
      : {}),
    ...(r.actual_net_proceeds_cents !== null
      ? { actualNetProceedsCents: r.actual_net_proceeds_cents }
      : {}),
    // D4. NULL means the purchase overruled nothing; an empty array would mean
    // it overruled an empty set, which is not a thing that can happen.
    ...(r.overrode_gates !== null
      ? {
          overrodeGates: JSON.parse(r.overrode_gates) as string[],
          ...(r.override_reason !== null ? { overrideReason: r.override_reason } : {}),
        }
      : {}),
    realizedProfitCents: r.realized_profit_cents,
  };
}

/**
 * What the dashboard is allowed to do with the ledger.
 *
 * ⛔ A positive allowlist, deliberately — NOT `Omit<FundStore, 'commit' | ...>`.
 * An exclusion list is only correct until someone adds a write method, and then
 * it is silently wrong; this project has already been bitten by a hand-written
 * field list that let `minSellThroughBps` through. Anything new on `FundStore`
 * is invisible here until it is added on purpose.
 *
 * `db` is narrowed to `ReadOnlyDb` for the same reason: exposing the full `Db`
 * would hand a screen `run()` and make the whole exercise decorative.
 *
 * The point is not that a screen is unlikely to write. It is that the phone
 * surface CANNOT write, so exposing it is a disclosure risk and never a
 * data-loss one.
 */
export interface LedgerReader {
  readonly db: ReadOnlyDb;
  state(): FundState;
  derivedState(): FundState;
  events(): StoredEvent[];
  postingsFor(eventId: string): PostingRow[];
  verifyChain(): { ok: boolean; brokenAt?: string };
  policy(): Policy;
  taxProfile(): TaxProfile;
  taxProfileOrDefault(): { profile: TaxProfile; stale: boolean; reason?: string };
  taxTablesAcceptance(): TaxTablesAcceptance | null;
  backupSettings(): BackupSettings;
  backupState(): BackupState;
  /**
   * ⚠️ A READER, not the repository. `opportunities()` returns something that
   * can `save()` and `setStatus()`; this cannot, which is why the dashboard
   * gets this one.
   */
  opportunityReader(): OpportunityReader;
}

/**
 * The second narrow door: config, and nothing else.
 *
 * ⛔ **Deliberately not "LedgerReader plus writes".** Gate 4 opened config
 * editing to the web (2026-09-08) and stopped exactly there — this interface
 * has no `commit`, so a screen still cannot record money however it is
 * compromised or mistaken. The worst a bad edit can do is set wrong RULES going
 * forward, which is validated, versioned, and repairable with
 * `policy adopt-defaults`.
 *
 * The deal book (`opp save`, `setStatus`) is deliberately absent too — that was
 * a separate decision, deferred.
 */
export interface ConfigWriter {
  policy(): Policy;
  taxProfile(): TaxProfile;
  taxProfileOrDefault(): { profile: TaxProfile; stale: boolean; reason?: string };
  setPolicy(policy: Policy): void;
  setTaxProfile(profile: TaxProfile): void;
}

export class FundStore {
  readonly db: Db;
  readonly #clock: Clock;
  #cached: FundState | undefined;

  constructor(db: Db, clock: Clock = systemClock) {
    this.db = db;
    this.#clock = clock;
  }

  ensureSeeded(): void {
    if (!this.db.get('SELECT key FROM config WHERE key = ?', ['policy'])) {
      this.setPolicy(DEFAULT_POLICY);
    }
    if (!this.db.get('SELECT key FROM config WHERE key = ?', ['tax_profile'])) {
      this.setTaxProfile(UNCONFIGURED_TAX_PROFILE);
    }
  }

  taxProfile(): TaxProfile {
    const row = this.db.get<{ value_json: string }>(
      'SELECT value_json FROM config WHERE key = ?',
      ['tax_profile'],
    );
    if (!row) return UNCONFIGURED_TAX_PROFILE;
    return assertValidTaxProfile(JSON.parse(row.value_json) as TaxProfile);
  }

  /**
   * The stored profile, or the unconfigured default if the stored one is too
   * old or too broken to validate.
   *
   * ⚠️ This exists because a REPAIR PATH MUST NOT DEPEND ON THE BROKEN THING.
   * The same bug appeared twice — once for `policy`, once here — when a new
   * required field made every existing stored value invalid, including for the
   * command whose whole job was to replace it.
   */
  taxProfileOrDefault(): { profile: TaxProfile; stale: boolean; reason?: string } {
    try {
      return { profile: this.taxProfile(), stale: false };
    } catch (err) {
      return { profile: UNCONFIGURED_TAX_PROFILE, stale: true, reason: (err as Error).message };
    }
  }

  /**
   * The owner's acceptance of the current tables, or null. Never throws: a
   * malformed record degrades to "no acceptance", which restores the warnings
   * rather than silencing them. Failing loud is the safe direction here.
   */
  taxTablesAcceptance(): TaxTablesAcceptance | null {
    const row = this.db.get<{ value_json: string }>(
      'SELECT value_json FROM config WHERE key = ?',
      ['tax_tables_acceptance'],
    );
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value_json) as TaxTablesAcceptance;
      if (
        typeof parsed.tablesYear !== 'number' ||
        typeof parsed.forTransactionYear !== 'number' ||
        typeof parsed.acceptedBy !== 'string' ||
        typeof parsed.acceptedAt !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  acceptTaxTables(acceptance: TaxTablesAcceptance): void {
    this.db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`,
      toParams(['tax_tables_acceptance', JSON.stringify(acceptance), this.#clock()]),
    );
    this.#cached = undefined;
  }

  setTaxProfile(profile: TaxProfile): void {
    assertValidTaxProfile(profile);
    this.db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`,
      toParams(['tax_profile', JSON.stringify(profile), this.#clock()]),
    );
    this.#cached = undefined;
  }

  /**
   * ⚠️ Tolerant by design. A malformed value degrades to the defaults rather
   * than throwing: backup is a safety feature, and it must never be the reason
   * a command fails. Contrast `policy()`, where a bad value must stop the world.
   */
  backupSettings(): BackupSettings {
    const row = this.db.get<{ value_json: string }>(
      'SELECT value_json FROM config WHERE key = ?',
      ['backup_settings'],
    );
    if (!row) return DEFAULT_BACKUP_SETTINGS;
    try {
      const parsed = JSON.parse(row.value_json) as Partial<BackupSettings>;
      return {
        directory: typeof parsed.directory === 'string' ? parsed.directory : '',
        auto: typeof parsed.auto === 'boolean' ? parsed.auto : true,
        retainDays:
          Number.isInteger(parsed.retainDays) && (parsed.retainDays as number) > 0
            ? (parsed.retainDays as number)
            : DEFAULT_BACKUP_SETTINGS.retainDays,
      };
    } catch {
      return DEFAULT_BACKUP_SETTINGS;
    }
  }

  setBackupSettings(settings: BackupSettings): void {
    this.#writeConfig('backup_settings', settings);
  }

  backupState(): BackupState {
    const row = this.db.get<{ value_json: string }>(
      'SELECT value_json FROM config WHERE key = ?',
      ['backup_state'],
    );
    if (!row) return EMPTY_BACKUP_STATE;
    try {
      return { ...EMPTY_BACKUP_STATE, ...(JSON.parse(row.value_json) as Partial<BackupState>) };
    } catch {
      return EMPTY_BACKUP_STATE;
    }
  }

  setBackupState(state: BackupState): void {
    this.#writeConfig('backup_state', state);
  }

  #writeConfig(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`,
      toParams([key, JSON.stringify(value), this.#clock()]),
    );
  }

  // --- config -------------------------------------------------------------

  policy(): Policy {
    const row = this.db.get<{ value_json: string }>(
      'SELECT value_json FROM config WHERE key = ?',
      ['policy'],
    );
    if (!row) return DEFAULT_POLICY;
    return assertValidPolicy(JSON.parse(row.value_json) as Policy);
  }

  setPolicy(policy: Policy): void {
    assertValidPolicy(policy);
    this.db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`,
      toParams(['policy', JSON.stringify(policy), this.#clock()]),
    );
    this.#cached = undefined;
  }

  // --- state --------------------------------------------------------------

  /**
   * Throw away the cached state, so the next `state()` is a real read.
   *
   * ⛔ Needed because the cache is only invalidated by writes made through
   * THIS instance, and two things legitimately write to the file some other
   * way: `importLedger`, which replays through a store of its own, and a
   * restore from backup, which replaces the file underneath.
   *
   * ⚠️ Without it the phone showed an empty fund immediately after importing
   * 55 events — the ledger was correct on disk and the screen was reading a
   * cache from before it. On the desktop this could not happen: every CLI
   * command was a fresh process.
   */
  invalidate(): void {
    this.#cached = undefined;
  }

  /**
   * Fast path. Balances come from summing the postings; items come from the
   * items table. Those are two independently maintained representations, and
   * `assertAllInvariants` cross-checks them on every single load — so a drift
   * between books and shelf surfaces immediately rather than at year end.
   */
  state(): FundState {
    if (this.#cached) return this.#cached;
    return this.derivedState();
  }

  /**
   * The same load with the cache deliberately bypassed — always a real scan of
   * the postings, the items and the event stream.
   *
   * ⛔ `commit()` caches the ENGINE's next state, because re-deriving from the
   * whole ledger after every write would be O(events) per command. That is a
   * sound optimisation and a trap for any control that reads `state()`:
   * `reconcile()` exists to compare a postings scan against an engine replay,
   * and with a warm cache BOTH sides are the engine. Measured, not assumed — a
   * $123.45 corruption planted in `#deriveTemporal` passed all 48 tests that
   * touch it, `reconcile`'s own plant included.
   *
   * So the control reads THIS and never `state()`. A check whose two sides come
   * from one source cannot fail.
   */
  derivedState(): FundState {
    const policy = this.policy();
    const balances = emptyBalances();
    for (const row of this.db.all<{ account: Account; total: number }>(
      'SELECT account, SUM(amount_cents) AS total FROM ledger_postings GROUP BY account',
    )) {
      balances[row.account] = Number(row.total);
    }

    const items: Record<string, ItemRecord> = {};
    for (const row of this.db.all<ItemRow>('SELECT * FROM items')) {
      items[row.item_id] = rowToItem(row);
    }

    const eventCount = Number(
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_events')?.n ?? 0,
    );

    const temporal = this.#deriveTemporal(policy);
    const state: FundState = {
      balances,
      items,
      policy,
      taxProfile: this.taxProfileOrDefault().profile,
      taxTables: DEFAULT_TAX_TABLES,
      mode: temporal.mode,
      taxYear: temporal.taxYear,
      ytdNetBusinessIncomeCents: temporal.ytdNetBusinessIncomeCents,
      ytdTaxReservedCents: temporal.ytdTaxReservedCents,
      eventCount,
    };
    assertAllInvariants(state);
    this.#cached = state;
    return state;
  }

  /**
   * One ordered pass over the ledger deriving everything that depends on
   * SEQUENCE rather than on totals: the bankroll mode (hysteretic, so it
   * depends on the path NAV took) and the year-to-date tax figures (annual, so
   * they reset at a year boundary).
   *
   * Neither is cached in a column, so neither can drift from the ledger.
   */
  #deriveTemporal(policy: Policy): {
    mode: BankrollMode;
    taxYear: number;
    ytdNetBusinessIncomeCents: Cents;
    ytdTaxReservedCents: Cents;
  } {
    const events = this.db.all<{
      event_id: string;
      type: string;
      occurred_at: string;
      payload_json: string;
    }>('SELECT event_id, type, occurred_at, payload_json FROM ledger_events ORDER BY id');

    const postingsByEvent = new Map<string, { account: Account; amount_cents: number }[]>();
    for (const row of this.db.all<{
      event_id: string;
      account: Account;
      amount_cents: number;
    }>('SELECT event_id, account, amount_cents FROM ledger_postings ORDER BY event_id, seq')) {
      const list = postingsByEvent.get(row.event_id);
      if (list) list.push(row);
      else postingsByEvent.set(row.event_id, [row]);
    }

    const balances = emptyBalances();
    let mode: BankrollMode = 'BOOTSTRAP';
    let taxYear = 0;
    let ytdNetBusinessIncomeCents = 0;
    let ytdTaxReservedCents = 0;

    for (const event of events) {
      for (const p of postingsByEvent.get(event.event_id) ?? []) {
        balances[p.account] += Number(p.amount_cents);
      }
      // Earmarks are credit-normal (negative raw), so adding them subtracts.
      const nav =
        balances.LIQUID +
        balances.INVENTORY_AT_COST +
        balances.TAX_RESERVE +
        balances.OPERATING_RESERVE +
        balances.OWNER_PAYABLE;
      mode = resolveBankrollMode(nav, mode, policy);

      const year = yearOf(event.occurred_at);
      if (year !== taxYear) {
        taxYear = year;
        ytdNetBusinessIncomeCents = 0;
        ytdTaxReservedCents = 0;
      }

      // Business income moved by this event, and the reserve it produced. Both
      // are read off the POSTINGS rather than recomputed, so this pass cannot
      // disagree with what was actually written.
      const postings = postingsByEvent.get(event.event_id) ?? [];
      const taxCredit = postings
        .filter((p) => p.account === 'TAX_RESERVE')
        .reduce((acc, p) => acc - Number(p.amount_cents), 0);
      ytdTaxReservedCents += taxCredit;

      if (event.type === 'SALE' || event.type === 'PASSIVE_RECOVERY') {
        // Profit = the net change in equity before allocations move it around.
        const inventoryCredit = postings
          .filter((p) => p.account === 'INVENTORY_AT_COST')
          .reduce((acc, p) => acc + Number(p.amount_cents), 0);
        const liquidDebit = postings
          .filter((p) => p.account === 'LIQUID')
          .reduce((acc, p) => acc + Number(p.amount_cents), 0);
        ytdNetBusinessIncomeCents += liquidDebit + inventoryCredit;
      } else if (event.type === 'BUSINESS_EXPENSE') {
        const liquidCredit = postings
          .filter((p) => p.account === 'LIQUID')
          .reduce((acc, p) => acc + Number(p.amount_cents), 0);
        ytdNetBusinessIncomeCents += liquidCredit;
      } else if (event.type === 'EXPENSE_CORRECTION') {
        // A settlement has NO postings — it declares that cash returned by some
        // earlier event belonged to this expense — so the amount can only come
        // from the payload. The engine does the same, and `reconcile()` is what
        // proves the two still agree. (It caught this branch being missing.)
        const p = JSON.parse(event.payload_json) as {
          amountCents?: number;
          settledByEventId?: string;
        };
        if (p.settledByEventId !== undefined) {
          ytdNetBusinessIncomeCents += Number(p.amountCents ?? 0);
        }
      } else if (event.type === 'ADJUSTMENT') {
        // Only a reversal moves business income, and only the payload says
        // whether this adjustment is one — the postings of a reversal and of an
        // ordinary cash correction are identical. The payload is inside the
        // hash chain, so trusting it here is no weaker than trusting a posting.
        const payload = JSON.parse(event.payload_json) as { reversesEventId?: string };
        if (payload.reversesEventId !== undefined) {
          const liquidDebit = postings
            .filter((p) => p.account === 'LIQUID')
            .reduce((acc, p) => acc + Number(p.amount_cents), 0);
          ytdNetBusinessIncomeCents += liquidDebit;
        }
      }
    }

    return { mode, taxYear, ytdNetBusinessIncomeCents, ytdTaxReservedCents };
  }

  // --- writing ------------------------------------------------------------

  commit(command: Command): ApplyResult {
    const before = this.state();
    this.#assertReversalIsPossible(command);
    const result = applyCommand(before, command);
    const recordedAt = this.#clock();

    this.db.transaction(() => {
      this.#writeItem(result.state, command);
      this.#writeEvent(result.event, recordedAt);
      this.#writeExpenses(result.event, command, recordedAt);
    });

    this.#cached = result.state;
    return result;
  }

  /**
   * The half of an expense reversal the engine cannot check.
   *
   * `FundState` carries balances and items, not an event registry, so a pure
   * reducer has no way to know whether `reversesEventId` names a real expense
   * or how much of it is left. That check belongs here, where the ledger is,
   * and it runs BEFORE `applyCommand` so a bad reversal never reaches a write.
   */
  #assertReversalIsPossible(command: Command): void {
    if (command.type === 'EXPENSE_CORRECTION') {
      this.#assertCorrectionIsPossible(command);
      return;
    }
    if (command.type !== 'ADJUSTMENT' || command.reversesEventId === undefined) return;
    const target = command.reversesEventId;

    this.#assertIsBusinessExpense(target, 'reverse', 'reversed');

    // The original row is positive, every compensating row negative, so the sum
    // is what is still standing. Reversing twice is allowed; over-reversing is
    // not, because it would turn a correction into invented income.
    const outstanding = this.#outstandingExpense(target);
    if (command.amountCents > outstanding) {
      throw new EngineError(
        'REVERSAL_EXCEEDS_EXPENSE',
        `${outstanding} cents of expense ${target} remain; cannot reverse ${command.amountCents}`,
      );
    }
  }

  #assertIsBusinessExpense(eventId: string, verb: string, participle: string): void {
    const event = this.db.get<{ type: string }>(
      'SELECT type FROM ledger_events WHERE event_id = ?',
      [eventId],
    );
    if (!event) {
      throw new EngineError('UNKNOWN_EVENT', `no event ${eventId} to ${verb}`);
    }
    if (event.type !== 'BUSINESS_EXPENSE') {
      throw new EngineError(
        'NOT_AN_EXPENSE',
        `event ${eventId} is a ${event.type}; only a BUSINESS_EXPENSE can be ${participle} this way`,
      );
    }
  }

  /**
   * A books-only correction has to be checked harder than a cash one, because
   * nothing in the ledger will contradict it afterwards.
   */
  #assertCorrectionIsPossible(command: ExpenseCorrectionCommand): void {
    this.#assertIsBusinessExpense(command.correctsEventId, 'correct', 'corrected');

    const outstanding = this.#outstandingExpense(command.correctsEventId);
    if (command.amountCents > outstanding) {
      throw new EngineError(
        'CORRECTION_EXCEEDS_EXPENSE',
        `${outstanding} cents of expense ${command.correctsEventId} remain; ` +
          `cannot correct ${command.amountCents}`,
      );
    }

    if (command.settledByEventId === undefined) return;

    // Settling claims that a specific event already returned this cash. If that
    // were unchecked, the same returned dollar could settle any number of
    // expenses and the books would quietly stop matching the ledger — the exact
    // failure this mechanism exists to prevent, reintroduced through its own
    // repair path.
    const settler = command.settledByEventId;
    if (settler === command.correctsEventId) {
      throw new EngineError('BAD_INPUT', 'an expense cannot settle itself');
    }
    // LIQUID is debit-normal, so a positive sum is cash arriving.
    const cashReturned = Number(
      this.db.get<{ v: number | null }>(
        `SELECT SUM(amount_cents) AS v FROM ledger_postings
          WHERE event_id = ? AND account = 'LIQUID'`,
        [settler],
      )?.v ?? 0,
    );
    if (cashReturned <= 0) {
      throw new EngineError(
        'NOT_A_RETURN',
        `event ${settler} returned no cash; it cannot settle an expense`,
      );
    }
    const alreadyClaimed = this.#claimedAgainst(settler);
    const available = cashReturned - alreadyClaimed;
    if (command.amountCents > available) {
      throw new EngineError(
        'SETTLEMENT_EXCEEDS_RETURN',
        `event ${settler} returned ${cashReturned} cents and ${alreadyClaimed} are already ` +
          `claimed; cannot settle ${command.amountCents} more`,
      );
    }
  }

  /** How much of one returning event's cash has already been claimed by corrections. */
  #claimedAgainst(settlerEventId: string): Cents {
    let total = 0;
    for (const row of this.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM ledger_events WHERE type = 'EXPENSE_CORRECTION'",
    )) {
      const p = JSON.parse(row.payload_json) as ExpenseCorrectionCommand;
      if (p.settledByEventId === settlerEventId) total += p.amountCents;
    }
    return total;
  }

  /** What is left of an expense after any reversals already recorded against it. */
  #outstandingExpense(eventId: string): Cents {
    const row = this.db.get<{ v: number | null }>(
      `SELECT SUM(amount_cents) AS v FROM expenses
        WHERE event_id = ? OR reverses_event_id = ?`,
      [eventId, eventId],
    );
    return Number(row?.v ?? 0);
  }

  #writeItem(state: FundState, command: Command): void {
    if (!('itemId' in command) || command.itemId === undefined) return;
    const item = state.items[command.itemId];
    if (!item) return;

    this.db.run(
      `INSERT INTO items (
         item_id, name, category, acquired_at, landed_cost_cents, book_value_cents,
         expected_days_to_sale, expected_resale_cents, state, charge_off_reason,
         listing_live, marketplace, sold_at, days_to_sale, realized_profit_cents, updated_at,
         opportunity_id, expected_net_proceeds_cents, expected_profit_cents,
         actual_net_proceeds_cents, overrode_gates, override_reason
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(item_id) DO UPDATE SET
         book_value_cents      = excluded.book_value_cents,
         state                 = excluded.state,
         charge_off_reason     = excluded.charge_off_reason,
         listing_live          = excluded.listing_live,
         sold_at               = excluded.sold_at,
         days_to_sale          = excluded.days_to_sale,
         realized_profit_cents = excluded.realized_profit_cents,
         updated_at            = excluded.updated_at,
         actual_net_proceeds_cents = excluded.actual_net_proceeds_cents`,
      toParams([
        item.itemId,
        item.name,
        item.category,
        item.acquiredAt,
        item.landedCostCents,
        item.bookValueCents,
        item.expectedDaysToSale,
        item.expectedResaleCents,
        item.state,
        item.chargeOffReason ?? null,
        item.listingLive,
        item.marketplace ?? null,
        item.soldAt ?? null,
        item.daysToSale ?? null,
        item.realizedProfitCents,
        this.#clock(),
        item.opportunityId ?? null,
        item.expectedNetProceedsCents ?? null,
        item.expectedProfitCents ?? null,
        item.actualNetProceedsCents ?? null,
        // Written on INSERT only. An override is a fact about the PURCHASE, and
        // nothing later in an item's life can create or erase one, so it is
        // deliberately absent from the ON CONFLICT update list above.
        item.overrodeGates === undefined ? null : JSON.stringify(item.overrodeGates),
        item.overrideReason ?? null,
      ]),
    );
  }

  #writeEvent(event: LedgerEvent, recordedAt: string): void {
    const prev = this.db.get<{ hash: string }>(
      'SELECT hash FROM ledger_events ORDER BY id DESC LIMIT 1',
    );
    const prevHash = prev?.hash ?? null;
    const hash = hashEvent(event, prevHash);

    this.db.run(
      `INSERT INTO ledger_events
         (event_id, type, occurred_at, recorded_at, item_id, memo, payload_json, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      toParams([
        event.eventId,
        event.type,
        event.occurredAt,
        recordedAt,
        event.itemId ?? null,
        event.memo ?? null,
        JSON.stringify(event.payload),
        prevHash,
        hash,
      ]),
    );

    event.postings.forEach((p, seq) => {
      this.db.run(
        `INSERT INTO ledger_postings (event_id, seq, account, amount_cents, memo)
         VALUES (?,?,?,?,?)`,
        toParams([event.eventId, seq, p.account, p.amountCents, p.memo ?? null]),
      );
    });
  }

  /**
   * The analytic record behind item profit vs operating profit. Sale-side costs
   * are expensed; acquisition costs that were capitalised into book value are
   * recorded with `capitalized = 1` so reporting never counts them twice.
   */
  #writeExpenses(event: LedgerEvent, command: Command, recordedAt: string): void {
    const add = (
      suffix: string,
      scope: 'TRANSACTION' | 'BUSINESS',
      itemId: string | null,
      category: string,
      amount: Cents,
      capitalized: boolean,
      reversesEventId: string | null = null,
    ): void => {
      if (amount === 0) return;
      this.db.run(
        `INSERT INTO expenses
           (expense_id, event_id, scope, item_id, category, amount_cents, occurred_at, memo,
            capitalized, reverses_event_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        toParams([
          `${event.eventId}:${suffix}`,
          event.eventId,
          scope,
          itemId,
          category,
          amount,
          command.occurredAt,
          command.memo ?? null,
          capitalized,
          reversesEventId,
        ]),
      );
    };

    switch (command.type) {
      case 'PURCHASE': {
        add('inbound', 'TRANSACTION', command.itemId, 'POSTAGE', command.inboundShippingCents ?? 0, true);
        add('travel', 'TRANSACTION', command.itemId, 'TRAVEL', command.acquisitionTravelCents ?? 0, true);
        break;
      }
      case 'SALE':
      case 'PASSIVE_RECOVERY': {
        add('platform', 'TRANSACTION', command.itemId, 'PLATFORM_FEE', command.marketplaceFeeCents ?? 0, false);
        add('payment', 'TRANSACTION', command.itemId, 'PAYMENT_FEE', command.paymentFeeCents ?? 0, false);
        add('postage', 'TRANSACTION', command.itemId, 'POSTAGE', command.outboundShippingCents ?? 0, false);
        add('packaging', 'TRANSACTION', command.itemId, 'PACKAGING', command.packagingCents ?? 0, false);
        add('other', 'TRANSACTION', command.itemId, 'OTHER', command.otherSaleCostCents ?? 0, false);
        break;
      }
      case 'BUSINESS_EXPENSE': {
        add(
          'expense',
          command.itemId ? 'TRANSACTION' : 'BUSINESS',
          command.itemId ?? null,
          command.category,
          command.amountCents,
          false,
        );
        break;
      }
      case 'ADJUSTMENT': {
        if (command.reversesEventId === undefined) break;
        // Mirror the row being undone — same category, same scope, same item —
        // so the breakdown nets out instead of growing a phantom category. The
        // original is the only row this event wrote, so there is exactly one.
        const original = this.#originalExpenseRow(command.reversesEventId);
        if (!original) {
          // A BUSINESS_EXPENSE of zero writes no row, so there is nothing to
          // compensate. `#assertReversalIsPossible` has already refused any
          // non-zero amount against it.
          break;
        }
        add(
          'reversal',
          original.scope,
          original.item_id,
          original.category,
          -command.amountCents,
          original.capitalized === 1,
          command.reversesEventId,
        );
        break;
      }
      case 'EXPENSE_CORRECTION': {
        const original = this.#originalExpenseRow(command.correctsEventId);
        if (!original) break;
        // Both rows point back at the expense they correct, so `outstanding`
        // and the drift control see one coherent group per expense however many
        // corrections it has accumulated.
        add(
          'from',
          original.scope,
          original.item_id,
          original.category,
          -command.amountCents,
          original.capitalized === 1,
          command.correctsEventId,
        );
        if (command.reclassifyTo !== undefined) {
          // Reclassifying moves money between categories; the total is
          // untouched, which is why settling is the only shape that reduces it.
          add(
            'to',
            original.scope,
            original.item_id,
            command.reclassifyTo,
            command.amountCents,
            original.capitalized === 1,
            command.correctsEventId,
          );
        }
        break;
      }
      default:
        break;
    }
    void recordedAt;
  }

  /** The row a BUSINESS_EXPENSE originally wrote — never one of its corrections. */
  #originalExpenseRow(eventId: string): {
    scope: 'TRANSACTION' | 'BUSINESS';
    item_id: string | null;
    category: string;
    capitalized: number;
  } | undefined {
    return this.db.get(
      `SELECT scope, item_id, category, capitalized FROM expenses
        WHERE event_id = ? AND reverses_event_id IS NULL`,
      [eventId],
    );
  }

  /** The read-only half, for the dashboard. */
  opportunityReader(): OpportunityReader {
    return new OpportunityReader(this.db);
  }

  /** Opportunities live beside the ledger but are not part of it. */
  opportunities(): OpportunityRepository {
    return new OpportunityRepository(this.db);
  }

  // --- reading ------------------------------------------------------------

  events(): StoredEvent[] {
    return this.db.all<StoredEvent>('SELECT * FROM ledger_events ORDER BY id');
  }

  postingsFor(eventId: string): PostingRow[] {
    return this.db.all<PostingRow>(
      'SELECT * FROM ledger_postings WHERE event_id = ? ORDER BY seq',
      [eventId],
    );
  }

  /** Recompute the hash chain. Returns the first event whose hash disagrees. */
  verifyChain(): { ok: boolean; brokenAt?: string } {
    let prevHash: string | null = null;
    for (const row of this.events()) {
      const event: LedgerEvent = {
        eventId: row.event_id,
        type: row.type as LedgerEvent['type'],
        occurredAt: row.occurred_at,
        ...(row.item_id !== null ? { itemId: row.item_id } : {}),
        ...(row.memo !== null ? { memo: row.memo } : {}),
        postings: this.postingsFor(row.event_id).map((p) => ({
          account: p.account,
          amountCents: Number(p.amount_cents),
          ...(p.memo !== null ? { memo: p.memo } : {}),
        })),
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      };
      const expected = hashEvent(event, prevHash);
      if (expected !== row.hash || (row.prev_hash ?? null) !== prevHash) {
        return { ok: false, brokenAt: row.event_id };
      }
      prevHash = row.hash;
    }
    return { ok: true };
  }

  /** Total of a sale's non-capitalised costs, for reporting. */
  static saleCostsOf = saleCostTotal;

  close(): void {
    this.db.close();
  }
}
