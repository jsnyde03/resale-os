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
import { computeMetrics, type CapitalMetrics } from '../../../src/core/capital/metrics.js';
import { EngineError } from '../../../src/core/capital/engine.js';
import { InvariantViolation } from '../../../src/core/ledger/invariants.js';
import { PolicyError } from '../../../src/core/capital/policy.js';
import { TaxProfileError } from '../../../src/core/tax/profile.js';
import { LedgerTransferError } from '../../../src/db/portable.js';
import { openMobileFundStore } from '../db/open-store.js';

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
  readonly commit: (command: Command) => CommitOutcome;
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
    return {
      store,
      state,
      metrics: computeMetrics(state),
      isEmpty: state.eventCount === 0,
      refresh,
      commit: (command: Command): CommitOutcome => {
        try {
          const result = store.commit(command);
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
