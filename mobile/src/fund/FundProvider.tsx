/**
 * One ledger, one store, for the whole app.
 *
 * ⛔ **Exactly one `FundStore` instance.** `state()` is cached inside the store
 * and invalidated by its own writes; a second instance over the same file would
 * hold a cache nothing invalidates, and a screen would show a balance that was
 * true before the other instance spent it. The desktop never had this problem
 * because each CLI command was a process.
 *
 * ⚠️ **Every write goes through `commit` here**, which refreshes after the
 * store writes. A screen calling `store.commit()` directly would move money and
 * leave every other screen showing the old number.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { FundStore } from '../../../src/db/store.js';
import type { Command } from '../../../src/core/capital/commands.js';
import type { FundState } from '../../../src/core/capital/state.js';
import type { Policy } from '../../../src/core/capital/policy.js';
import type { TaxProfile } from '../../../src/core/tax/profile.js';
import type { OpportunityInput } from '../../../src/domain/opportunity.js';
import type { Evaluation } from '../../../src/scoring/evaluate.js';
import { OpportunityRepository } from '../../../src/db/repositories/opportunities.js';
import { computeMetrics, type CapitalMetrics } from '../../../src/core/capital/metrics.js';
import { EngineError } from '../../../src/core/capital/engine.js';
import { InvariantViolation } from '../../../src/core/ledger/invariants.js';
import { PolicyError } from '../../../src/core/capital/policy.js';
import { TaxProfileError } from '../../../src/core/tax/profile.js';
import { LedgerTransferError } from '../../../src/db/portable.js';
import { openMobileFundStore } from '../db/open-store.js';
import { writeDeviceBackup } from '../backup/deviceBackup.js';
import { backupStaleness } from '../../../src/db/backup-types.js';

/**
 * The outcome of asking the fund to record something.
 *
 * ⚡ A refusal is a **value**, not an exception. A rejected command is a normal
 * outcome — the operator asked for something the rules do not allow and the
 * ledger is untouched — and the CLI learned that the hard way when an
 * unhandled `EngineError` printed a stack trace at the operator. On a phone the
 * equivalent mistake is a red screen, which is worse: it looks like the app
 * broke rather than like the fund said no.
 */
/** A config write either landed or was refused with a reason. */
export type ConfigOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: string };

export type CommitOutcome =
  | { readonly ok: true; readonly eventId: string }
  | { readonly ok: false; readonly refusal: string; readonly hint?: string };

/**
 * Turn a thrown error into something an operator can act on.
 *
 * ⚠️ Only the four the engine deliberately raises are treated as refusals.
 * Anything else is a genuine fault and must not be dressed up as a rule — a
 * bug that reads as "the fund said no" is a bug nobody reports.
 */
function refusalFrom(err: unknown): CommitOutcome {
  if (err instanceof EngineError) {
    return { ok: false, refusal: err.message };
  }
  if (err instanceof InvariantViolation) {
    return {
      ok: false,
      refusal: err.message,
      hint: 'The ledger refused to leave itself inconsistent. Nothing was recorded.',
    };
  }
  if (err instanceof TaxProfileError) {
    return { ok: false, refusal: err.message, hint: 'Set the tax profile before recording profit.' };
  }
  if (err instanceof PolicyError) {
    return {
      ok: false,
      refusal: err.message,
      hint: 'This fund is running a policy this build rejects.',
    };
  }
  if (err instanceof LedgerTransferError) {
    return { ok: false, refusal: err.message, hint: 'Nothing was imported.' };
  }
  throw err;
}

/**
 * The refusal as one block of text.
 *
 * Four screens were formatting this identically, which is four places for the
 * wording to drift apart while every one of them keeps looking right.
 */
export function refusalText(outcome: Extract<CommitOutcome, { ok: false }>): string {
  return outcome.hint ? `${outcome.refusal}
${outcome.hint}` : outcome.refusal;
}

export interface Fund {
  readonly store: FundStore;
  readonly state: FundState;
  readonly metrics: CapitalMetrics;
  /** True until a ledger exists here — a fresh install, or before an import. */
  readonly isEmpty: boolean;
  /** How many events have happened since the last verified copy, and whether that is a problem. */
  readonly backup: { readonly behind: number; readonly stale: boolean; readonly lastError: string | null };
  readonly commit: (command: Command) => CommitOutcome;
  /**
   * ⛔ **CONFIG, and only config.** A separate door with two methods, not the
   * ledger's door widened by two — that shape invites one more capability each
   * time. These write the fund's RULES; they record no event and move no money,
   * and the ledger cannot be reached through them.
   *
   * ⚠️ They refresh, like `commit` does. A screen that wrote policy and forgot
   * would leave every other screen reading the old numbers.
   */
  readonly setPolicy: (policy: Policy) => ConfigOutcome;
  readonly setTaxProfile: (profile: TaxProfile) => ConfigOutcome;
  /**
   * ⚡ **B68.** Record a scored opportunity. Not a ledger event and not config —
   * an analytic row, so it moves no money and the hash chain does not know it
   * happened. It is what **B3**'s rejection histogram counts and what **6.5**'s
   * watchlist watches, and until now nothing wrote one from the phone.
   *
   * ⚠️ **Not covered by the backup**, which carries commands and config only.
   * Scoring history dies with the device. Filed as **6.0.5**.
   */
  readonly saveOpportunity: (input: OpportunityInput, evaluation: Evaluation) => ConfigOutcome;
  /** Re-read after something wrote outside `commit` — an import, a restore. */
  readonly refresh: () => void;
}

const FundContext = createContext<Fund | null>(null);

export function useFund(): Fund {
  const fund = useContext(FundContext);
  if (!fund) throw new Error('useFund() outside FundProvider');
  return fund;
}

export function FundProvider({
  children,
  open = openMobileFundStore,
  fallback,
}: {
  children: ReactNode;
  /** Injectable so a test can hand it `:memory:`. */
  open?: () => FundStore;
  /** Rendered instead of `children` when the ledger will not open. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}) {
  // ⚠️ Lazy initialiser, not an effect. The store must exist before the first
  // render that reads it, and an effect runs after — which would mean every
  // screen handling a null store forever, for one frame of benefit.
  const [opened, setOpened] = useState<{ store: FundStore } | { error: Error }>(() => {
    try {
      return { store: open() };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const retry = useCallback(() => {
    try {
      setOpened({ store: open() });
    } catch (err) {
      setOpened({ error: err instanceof Error ? err : new Error(String(err)) });
    }
  }, [open]);

  const store = 'store' in opened ? opened.store : null;

  // `version` is the dependency on purpose: it is what a write bumps, and the
  // store's own cache is what makes re-reading cheap.
  const value = useMemo<Fund | null>(() => {
    if (!store) return null;
    const state = store.state();
    const backupState = store.backupState();
    return {
      store,
      state,
      metrics: computeMetrics(state),
      isEmpty: state.eventCount === 0,
      backup: {
        ...backupStaleness(backupState, state.eventCount),
        lastError: backupState.lastError,
      },
      refresh,
      setPolicy: (policy: Policy): ConfigOutcome => {
        try {
          store.setPolicy(policy);
          // Config is not an event, so the hash chain does not move — but the
          // backup carries `config`, and a rule change nobody backed up is a
          // rule change that dies with the phone.
          writeDeviceBackup(store);
          return { ok: true };
        } catch (err) {
          return { ok: false, refusal: err instanceof Error ? err.message : String(err) };
        } finally {
          refresh();
        }
      },
      saveOpportunity: (input: OpportunityInput, evaluation: Evaluation): ConfigOutcome => {
        try {
          new OpportunityRepository(store.db).save(input, evaluation, new Date().toISOString());
          return { ok: true };
        } catch (err) {
          return { ok: false, refusal: err instanceof Error ? err.message : String(err) };
        } finally {
          refresh();
        }
      },
      setTaxProfile: (profile: TaxProfile): ConfigOutcome => {
        try {
          store.setTaxProfile(profile);
          writeDeviceBackup(store);
          return { ok: true };
        } catch (err) {
          return { ok: false, refusal: err instanceof Error ? err.message : String(err) };
        } finally {
          refresh();
        }
      },
      commit: (command: Command): CommitOutcome => {
        try {
          const result = store.commit(command);
          // ⛔ Backed up before this returns, not on a timer and not on the way
          // out of the app. The desktop copied after every command that moved
          // money and the phone has a harder version of the same job: it holds
          // the ONLY current copy. `writeDeviceBackup` never throws — a backup
          // failure must not make a successful sale look lost — so the outcome
          // is a value the screens read off `fund.backup`.
          writeDeviceBackup(store);
          return { ok: true, eventId: result.event.eventId };
        } catch (err) {
          return refusalFrom(err);
        } finally {
          // ⛔ In `finally`, not after a success. A refusal leaves the ledger
          // untouched but the screen still has to re-render to show the
          // refusal, and a partial write that somehow landed must not be the
          // one thing the UI never re-reads.
          refresh();
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, refresh]);

  if (!value) {
    const error = 'error' in opened ? opened.error : new Error('the ledger did not open');
    return <>{fallback ? fallback(error, retry) : null}</>;
  }
  return <FundContext.Provider value={value}>{children}</FundContext.Provider>;
}
