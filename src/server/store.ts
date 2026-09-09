/**
 * The one door to the ledger, and the gate that stands in it.
 *
 * ⛔ **Read-only by TYPE.** The callback gets a `LedgerReader`, which has no
 * `commit`, no `setPolicy`, and a `db` narrowed to `get`/`all`. A screen that
 * tries to write does not compile. That is what makes exposing this to a phone
 * a disclosure risk rather than a data-loss one.
 *
 * ⛔ **And the auth check lives HERE, not in the proxy.** Next's own guidance is
 * that proxy "should not be used as a full session management or authorization
 * solution", and a routing check is default-open in the worst way: it protects
 * the paths someone remembered to match. Gating the data means a new screen is
 * gated the moment it reads anything, without its author having to know the
 * gate exists. `src/proxy.ts` only redirects for the sake of appearances.
 *
 * A fresh store per request is correct rather than wasteful. `state()` caches
 * inside one instance, so a long-lived one would serve numbers from before the
 * last CLI command. SQLite is in WAL mode and this is one operator's machine;
 * the open costs microseconds and the staleness would cost trust.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FundStore, type ConfigWriter, type LedgerReader } from '../db/store.js';
import { openFundStore } from '../db/open-store.js';
import { DEFAULT_DB_PATH } from '../db/driver.js';
import { SESSION_COOKIE, authConfigFromEnv, isConfigured, sessionIsValid } from './auth.js';

/**
 * Throws (by redirecting) unless this request may see the fund.
 *
 * With no password configured the process is bound to loopback — enforced at
 * startup by `scripts/check-binding.mjs` — so the only possible client is this
 * machine, and there is nothing to prove.
 */
export async function requireSession(): Promise<void> {
  const config = authConfigFromEnv();
  if (!isConfigured(config)) return;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionIsValid(config, token, Date.now())) redirect('/login');
}

/**
 * A reader that is narrow at RUNTIME, not only at compile time.
 *
 * ⛔ This exists because of a real incident, 2026-09-08. A `store.commit()` was
 * planted in `page.tsx` to prove the `LedgerReader` type rejected it — which it
 * did, loudly, under `tsc`. But a forgotten dev server was watching the
 * filesystem, and **a dev server executes code that does not typecheck.** It
 * recompiled the page and ran the commit 47 times against the live ledger in
 * eighteen seconds.
 *
 * A type is a compile-time promise. Handing the screens an object that has no
 * `commit` on it makes the same promise at runtime, so the next time something
 * executes code that should never have compiled, the worst it gets is a
 * `TypeError` instead of 47 events in a real financial record.
 */
function readerFor(store: FundStore): LedgerReader {
  return {
    // Only `get` and `all` — never `run`, `exec` or `transaction`.
    db: { all: (sql, params) => store.db.all(sql, params), get: (sql, params) => store.db.get(sql, params) },
    state: () => store.state(),
    derivedState: () => store.derivedState(),
    events: () => store.events(),
    postingsFor: (eventId) => store.postingsFor(eventId),
    verifyChain: () => store.verifyChain(),
    policy: () => store.policy(),
    taxProfile: () => store.taxProfile(),
    taxProfileOrDefault: () => store.taxProfileOrDefault(),
    taxTablesAcceptance: () => store.taxTablesAcceptance(),
    backupSettings: () => store.backupSettings(),
    backupState: () => store.backupState(),
    // A read. It answers "how much of this expense is still standing", which a
    // screen offering to reverse one has to show before it asks for an amount.
    outstandingExpense: (eventId) => store.outstandingExpense(eventId),
    opportunityReader: () => store.opportunityReader(),
  };
}

/**
 * Config editing, and nothing else.
 *
 * ⛔ Same runtime narrowing as `readerFor`: the object handed over physically
 * has no `commit` on it, so code that should never have compiled cannot write
 * to the ledger anyway. That lesson cost 47 events in a real book.
 */
function configWriterFor(store: FundStore): ConfigWriter {
  return {
    policy: () => store.policy(),
    taxProfile: () => store.taxProfile(),
    taxProfileOrDefault: () => store.taxProfileOrDefault(),
    setPolicy: (policy) => store.setPolicy(policy),
    setTaxProfile: (profile) => store.setTaxProfile(profile),
  };
}

export async function withConfigStore<T>(fn: (config: ConfigWriter) => T): Promise<T> {
  await requireSession();
  const store = openFundStore(process.env.RESALE_DB ?? DEFAULT_DB_PATH);
  try {
    return fn(configWriterFor(store));
  } finally {
    store.close();
  }
}

export async function withStore<T>(fn: (store: LedgerReader) => T): Promise<T> {
  await requireSession();
  const store = openFundStore(process.env.RESALE_DB ?? DEFAULT_DB_PATH);
  try {
    return fn(readerFor(store));
  } finally {
    store.close();
  }
}
