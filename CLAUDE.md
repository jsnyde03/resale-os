# Resale OS — start here

Private resale intelligence and capital management system. One operator, real
money, no SaaS, no App Store, no multi-user.

**⚠️ `MASTER_PLAN.md` is the queue and the point of truth for what to build
next.** Exactly one item is decomposed on it — the active one. Detail and
rationale live in `MASTER_PLAN_LOG.md`; read the entry for anything you are
about to change.

**Status (2026-09-09): Gates 1-4 CLOSED. Gate 5 — THE PHONE IS THE SYSTEM — is ACTIVE.**

Live on a real **$50** bankroll. 463 tests. `npm run check` runs four gates:
source bytes, import direction, typecheck, tests.

---

## Where things stand — read this first

**The fund is live and real.** $50 of actual money, `data/resale.db`, backed up
to OneDrive after every command that moves money.

```
Bankroll (NAV)   $50.00    BOOTSTRAP: $20 max/item, 21-day ceiling, $8 min profit
Set-aside        OFF until $100 - profit compounds
Tax profile      configured (set locally — see below)
Backup           current, a OneDrive folder outside the repo
```

⛔ **The operator's actual tax profile never goes in a file that is committed.**
Filing status, income, county and local rate are **inputs** — `TaxProfile` is a
parameter for exactly this reason — and they live in `data/resale.db`, which is
gitignored. The repo is **public**. A doc that writes them down for convenience
puts a real person's filing status, income and county on the internet, and
force-pushing does not take it back: **GitHub keeps the objects, fetchable by
SHA.** Measured twice on this project. Write "the operator's county", never the
county. Same for `C:/Users/<name>/...` paths.

**Gates 1–3 are closed.** The ledger is correct and tamper-evident; the system
scores opportunities and recommends purchases with reasons; it reports its own
prediction accuracy and backs itself up. **Gate 4 (dashboard) is the active
build** — see `MASTER_PLAN.md`, which carries the decomposed sub-steps.

### What needs a human, not a session

| | |
|---|---|
| **B32** | Confirm OneDrive is genuinely signed in and syncing. The folder was empty apart from `desktop.ini`, so backups are *configured* but their sync has never been observed. A backup that never leaves the disk is the failure this prevents. |
| **B26** | Verify the operator's state and local rates against the tax authority's published table. They were recalled, not looked up, and `stateRateBasis` says so. |
| **D2** | The owner split (20/10/70 of after-tax profit) is still a default nobody has confirmed. |

### The one thing a new session should not re-litigate

⛔ **Categories are deliberately deferred** (D5, 2026-09-08). The system gates on
**sell-through**, not on a category list, and the architecture stays
category-neutral. Books were considered and moved to Growth mode — they are a
margin play needing hold tolerance a $50 fund does not have. Backlog **B28**.

### Four gates run on every check

```
npm run check    # source bytes · import direction · typecheck · 463 tests
```

Each was **planted against and verified to red**, then the restore verified to
green. A control that has never been planted is not a control.

---

## The seven rules

Break any of these and the product stops being what it is.

1. **`src/core/**` is pure.** No I/O, no clock, no randomness, no framework. It
   imports nothing from `db`, `server` or `cli`. The clock is passed in.
2. **Integer cents. Always.** No floats in the ledger, ever. Rates are integer
   basis points. `allocate()` is remainder-exact.
3. **The ledger is append-only double-entry.** Balances are derived by summing
   postings; there is no authoritative stored balance. Corrections are
   `ADJUSTMENT` events, never row edits.
4. **Invariants are asserted before a state is accepted.** A violation throws
   and the database is untouched. There is no repair path.
5. **No LLM in financial calculation, capital rules or accounting.** Ava is out
   of scope. Determinism is the product.
6. **Confidence travels with every estimate.** It caps the Buy Score directly.
7. **Capital safety cannot be bought off.** Expected profit is not an input to
   any capital gate, and a single gate failure is fatal to a recommendation.

---

## Where things are defined

| Question | File |
|---|---|
| What accounts exist, what each event posts, what invariant holds | `docs/FINANCIAL_SPEC.md` |
| Every scoring formula, the two Buy Score caps, max price | `docs/SCORING_SPEC.md` |
| Stack, module map, dependency direction, Postgres path | `docs/ARCHITECTURE.md` |
| Every table, including reserved ones | `docs/SCHEMA.md` |
| What would falsify an assumption, and what reversing costs | `docs/ASSUMPTIONS_AND_RISKS.md` |
| Why a decision was made | `MASTER_PLAN_LOG.md` |

---

## Things that cost real time to rediscover

- ⛔ **Policy lives in the DATABASE, not in the code.** Changing a default in
  `policy.ts` does nothing to a fund that already exists — `ensureSeeded()` only
  writes when the row is absent. A $100 floor passed 139 tests while the live
  fund still ran $8. `policy show` warns when the stored version differs from
  the code's; `policy adopt-defaults` applies. **Bump `Policy.version` on every
  policy change** — it is the only thing that can detect the divergence.
- ⚠️ **A profit floor and a per-item cap multiply into a constraint neither one
  states.** A $100 per-flip floor + 40% of a $50 NAV = a 7.2x required on every
  flip. `src/core/capital/reachability.ts` computes it and `status` prints it.
  When you change either number, check the other.
- ⛔ **"Profit floor" is ambiguous, and I picked wrong.** It can mean the
  *per-flip minimum profit* (`minExpectedProfitCents`) or the *bankroll below
  which profit is retained* (`setAsideMinNavCents`). On 2026-09-08 I read
  "no profit floor below 100" as the first and rebuilt around a number that
  collided with the $50 bankroll; it meant the second. **When a money term could
  name two different knobs, ask — do not pick the reading that implies more
  work.**
- ⛔ **An invisible byte can sit in source and break nothing you can see.** A
  literal NUL landed inside a string in `src/db/hash.ts`: it compiled, all 104
  tests passed, and the only symptom was git silently reclassifying the file as
  binary, so it produced no diffs. `npm run lint:bytes` now fails on any control
  byte in source, and it was planted and verified rather than assumed to work.
  Prefer the Edit/Write tools over shell escapes for source containing anything
  unusual.
- ⛔ **Negating a zero balance produces `-0`, and `-0 !== 0` under `Object.is`.**
  It made nine assertions fail against correct code. Every sign flip in this
  codebase goes through `normalizeZero()`. If you add a negation, use it.
- ⚠️ **`node:sqlite` rejects booleans and `undefined` outright.** Everything
  going into a query passes through `toParam()` / `toParams()` in
  `src/db/driver.ts`. It is the only place `node:sqlite` is imported.
- ⚠️ **Vitest is pinned to `^3.2.4` on purpose.** Vitest 5 bundles rolldown,
  whose native binding does not install on this machine, and a clean reinstall
  did not fix it. See log D-02 before "upgrading".
- ⛔ **The engine records what happened; it does not gate decisions.**
  `applyCommand` enforces only invariants. Policy gates live in
  `constraints.ts`. A ledger that refuses to record a purchase the operator
  already made is worse than useless. Do not move gates into the engine.
- ⚠️ **Mode is hysteretic, so it depends on the path NAV took.** That is why
  `FundStore` derives it by replaying the NAV series instead of caching a
  column. Do not "optimise" that into a stored value.
- ⛔ **THE DESKTOP IS BEING RETIRED.** Gate 5, 2026-09-09: the ledger moves to
  the phone (Expo + React Native, matching GigWorkTracker). Three constraints
  forced it — Spark Driver flags VPN/mesh apps so nothing can be installed to
  reach a home PC; the desktop has no role; and the app must know the fund
  EXACTLY, so no snapshot or sync. ⛔ **Not Capacitor** (months were spent
  migrating another app off it) and ⛔ **not Swift** (that means rewriting the
  engine and discarding its tests). `core + scoring + domain` — 4,878 lines,
  pure — move unchanged; `node:sqlite` lives in one file, as A1 predicted.
- ⚠️ **`tests/driver-contract.ts` is the port's control.** One contract, run
  against every driver: `node:sqlite` in Node, `expo-sqlite` on a device. Both
  passing their own tests would prove nothing about each other.
- ⚠️ **Writing about escape sequences through a Python script puts CONTROL BYTES
  in the file.** `\b` is a backspace. It happened THREE times on 2026-09-09 — in
  a regex that then matched nothing, and twice in this very rule. `lint:bytes`
  caught all three. Use a raw string (`r'...'`), or the Edit tool.
- ⛔ **Screens never do arithmetic on money**, and `npm run lint:imports` now
  enforces it in `src/app` and `src/server`. `formatCents` renders it;
  `toDollarsInput` makes it editable in a form. The rule was stated in 4.2 and
  broken three times in 4.11 before anything checked.
- ⚠️ **Run the whole `npm run check`, not the one gate you are editing.** A
  Python `\b` put four literal 0x08 bytes into a regex, which then matched
  nothing; `lint:bytes` named the file and byte the moment it ran, but I had
  been running `lint:imports` alone. A gate you skip is a gate you do not have.
- ⚠️ **The web can write CONFIG but never the ledger** (Gate 4 decision,
  2026-09-08). `withConfigStore` is a *separate* door with five methods, not
  `LedgerReader` plus writes — that shape invites one more capability each time.
  Saving opportunities and changing their status from the phone is tier 3, still
  closed, and is Gate 5's **5.5**.
- ⛔ **The dashboard reaches the ledger through `src/server/views.ts` and
  nowhere else**, and `npm run lint:imports` enforces it — `src/app` may not
  import `src/db`, `src/cli` or `node:sqlite`. The view layer does no
  arithmetic on money; even formatting goes through `formatCents`. A screen
  that needs a number it does not have gets it added to `src/core` with tests.
- ⚠️ **Two tsconfigs, and `npm run typecheck` runs BOTH.** The root is node-only
  by design (no DOM, no JSX); `tsconfig.web.json` is the web half. Next rewrites
  whichever config it is pointed at, so `next.config.ts` sets
  `typescript.tsconfigPath` — otherwise it edits the root one and the split is
  gone. `agentRules: false` likewise stops `next dev` appending to this file.
- ⛔ **A DEV SERVER EXECUTES CODE THAT DOES NOT TYPECHECK.** On 2026-09-08 a
  `store.commit()` was planted in `page.tsx` to prove `LedgerReader` rejected
  it. `tsc` rejected it exactly as intended — and a **forgotten dev server on
  port 3000** was watching the filesystem, recompiled the page, and ran the
  commit **47 times against the live ledger in 18 seconds.** Reversed with two
  ADJUSTMENTs (a CONTRIBUTION touches two accounts and an adjustment only pairs
  against retained earnings); the 47 events and their reversal are in the
  ledger forever, which is what append-only means.
  **Three rules came out of it:** ⚠️ *check every dev port before editing app
  files*, not just the one you started; ⚠️ **never plant a side effect in a
  file a running server can execute** — plant type errors and verify with
  `tsc`, then restore before starting anything; and ⛔ **a type is a
  compile-time promise only** — `withStore` now hands screens an object that
  physically has no `commit` on it, so the same mistake gets a `TypeError`
  instead of writing to a real financial record.
- ⚠️ **The auth gate is on `withStore`, NOT in `src/proxy.ts`.** Next's own docs
  say proxy "should not be used as a full session management or authorization
  solution", and a routing check is default-open: it protects the paths someone
  remembered to match. Gating the DATA means a new screen is gated the moment it
  reads anything. The proxy only redirects so an expired session sees a login
  form. ⛔ **No loopback exemption anywhere** — a tunnel makes every remote
  request arrive looking local.
- ⛔ **The dev server binds `0.0.0.0` unless told otherwise**, which put the whole
  financial position on the LAN with no auth for two items. `dev` and `start`
  now pass `--hostname 127.0.0.1`. Reading it on a phone needs LAN access, which
  needs the auth gate (4.9) — do not undo the binding without doing 4.9 first.
- ⛔ **The feed reports stored verdicts; it never recomputes them.** Re-running
  today's policy over an old row would show a score that was never the reason
  for any decision. A row whose `policy_version` has moved on is marked **stale**
  and keeps its numbers; re-scoring is a CLI action because it is a decision.
  ⚠️ An UNSCORED row (`policy_version === null`) is not stale — different fact.
- ⚠️ **The dashboard reaches opportunities through `OpportunityReader`**, not
  `opportunities()` — the repository can `save()` and `setStatus()`. Both share
  the same module-level query functions, so there is one implementation of the
  ranking reachable two ways with different powers.
- ⛔ **"Too expensive" and "walk away" are different answers, and the difference
  is measured.** `priceFixable` re-runs the evaluator with the asking price set
  to the ceiling; if that is a BUY, price is the whole problem. Do not infer it
  from which gates failed — a gate can care about price indirectly. And the
  screen's explanation follows the verdict: the price ceiling explains a price
  problem, the failing gate explains everything else.
- ⚠️ **The screen's DECISIONS live in `src/server/screens.ts`, not in the `.tsx`.**
  Which rows, in what order, which warnings and how loud — all tested there,
  because there is no browser here. `page.tsx` is typography only. ⛔ Styling and
  legibility are asserted by NOTHING (B39); that judgement is Jason's.
- ⚠️ **`dev` and `build` are pinned to `--webpack`.** Turbopack does not honour
  `extensionAlias` and cannot resolve this repo's `.js`-for-`.ts` imports; every
  page 500s. Backlog B38. Kill the dev server when done — check the port.
- ⛔ **This machine cannot download a large npm tarball in one shot, and npm
  does not resume.** Anything over ~20 MB dies partway with
  `ERR_SSL_WRONG_VERSION_NUMBER` (npm) or `SEC_E_INVALID_TOKEN` (curl) — the
  payload is arriving, the TLS teardown is what breaks, and `--fetch-retries`
  does not help because each retry RESTARTS. Measured: `--http1.1` and
  `--tlsv1.2` truncate too, at different offsets each time, so it is not a
  protocol setting. **The workaround, which works:**
  ```bash
  # resume-loop until gzip validates, then seed the content-addressed cache
  curl -C - -o $TEMP/pkg.tgz <tarball-url>     # repeat; gzip -t $TEMP/pkg.tgz
  npm cache add $TEMP/pkg.tgz
  npm install <pkg>                            # now hits cacache by integrity
  ```
  It cost `next` (41 MB) and `@next/swc-win32-x64-msvc` (34 MB). Same class as
  the rolldown binding that pins Vitest to 3.x — **two independent native
  packages now, so assume the next big dep needs this too.**
- ⛔ **SQLite cannot alter a CHECK constraint** — a new event type means
  rebuilding `ledger_events`, and rebuilding a table that `ledger_postings` and
  `expenses` reference needs `PRAGMA foreign_keys = OFF` **outside** a
  transaction. Measured: `defer_foreign_keys` does NOT survive the DROP. A
  migration whose first line is `-- self-managed` runs outside the runner's
  transaction and owns its own; it is recorded only after committing, so it
  MUST be safe to re-run.
- ⛔ **An `EXPENSE_CORRECTION` moves no money and must be exactly one of
  reclassify or settle.** Neither would silently drop an expense the ledger
  still says was paid — B33's drift coming back through its own repair path.
  Settling is checked hardest because nothing in the ledger contradicts it
  afterwards: the named event must really have returned that cash, and no two
  settlements may claim the same dollar.
- ⛔ **`reconcile()` must read `derivedState()`, never `state()`.** `commit()`
  caches the ENGINE's next state, so with a warm cache both sides of the
  comparison are the engine and the control cannot fail. Measured: a $123.45
  corruption planted in `#deriveTemporal` passed all 48 tests that touch it,
  including reconcile's own plant — which only ever worked because it corrupts
  the *replay* side. Any future control that compares against the store must
  bypass the cache too.
- ⛔ **An `ADJUSTMENT` that undoes an expense must carry `reversesEventId`.**
  Expenses live in the ledger AND in the analytic `expenses` table; without the
  link only the ledger moves and `profit` drifts. `verify` prints a drift line.
  ⚠️ It cannot see an UNDECLARED reversal — that is indistinguishable from an
  ordinary cash correction, which is exactly why the declaration exists.
- ⚠️ **A round trip through one encoder proves nothing.** `reconcile()` compares
  two genuinely different derivations — summing postings vs replaying every
  command through the engine. Its tests **plant** a corruption and assert it is
  caught; a control that has never been planted is not a control.
- ⛔ **The tax reserve is INCREMENTAL ANNUAL TAX, not a rate.** `reserve =
  annualTax(ytd + profit) - annualTax(ytd)`. Never reintroduce a percentage: the
  $400 SE threshold is a cliff, the wage base is a ceiling, brackets are steps,
  and a flat rate is wrong on both sides of each. `src/core/tax/annual.ts` is the
  model; `src/core/capital/tax.ts` is a thin adapter.
- ⛔ **A REPAIR PATH MUST NOT DEPEND ON THE BROKEN THING.** This shipped twice:
  `policy adopt-defaults` and `tax profile set` both read-and-validated the
  stored value before replacing it, so the one command that could fix a stale
  config could not run against one. Adding a required field to any stored config
  makes every existing row invalid — including for the repair. Use
  `taxProfileOrDefault()`-style loaders, and gate it with a test.
- ⛔ **`expectedDaysToSale` is DERIVED from comps, never typed.** `90 * (active+1) /
  sold90`. A hand estimate is capped at 30% confidence — below every mode floor —
  so it cannot clear the gate alone. Do not add a path that trusts a typed hold.
- ⛔ **`validatePolicy` is exhaustive BY CONSTRUCTION**, driven off
  `DEFAULT_BOOTSTRAP_POLICY`'s keys. A hand-written field list let
  `minSellThroughBps` through: a stored policy older than the field gave
  `undefined`, which reached a gate as `NaN` and printed "vs a NaN% minimum". It
  failed closed by luck. **Never replace that loop with an explicit list.**
- ⚠️ **The state tax base is not the federal one.** Most states do not allow the
  QBI deduction, so it is added back before `stateIncomeTaxBps` applies.
  `stateIncomeTaxBps` is state **plus local**, combined — and a non-zero rate
  **requires** `stateRateBasis` saying where it came from, or validation throws.
- ⛔ **The reserve is a CATCH-UP against the year, not a per-sale increment.**
  The $400 SE cliff can owe more than the crossing sale earns, and an increment
  capped at the profit drops the rest forever. `computeTaxReserve` takes
  `ytdTaxReservedCents` for exactly this reason, and `carriedForwardCents`
  reports what is still outstanding.
- ⚠️ **Income tax abstains without a `TaxProfile`** and every consumer reports
  that it abstained. Do not add a default rate — a confident wrong number is
  worse than an honest gap.
- ⚡ **`TAX_TABLES_2026` is VERIFIED and is the default.** The figures came from
  **GigWorkTracker's `services/tax-engine`** (IRS Rev. Proc. 2025-32; SSA 2026
  COLA), were **generated by script rather than typed**, and were machine-checked
  back against the source — 65 figures, exact. ⛔ **Never hand-transcribe a
  bracket**: a typo is wrong money and reads exactly like a correct number.
  `TAX_TABLES_2025` is kept, still `verified: false`, for replaying older events —
  point any test about unverified-table behaviour at it, or the test passes
  while asserting nothing. ⚠️ Nothing re-checks the transcription automatically
  (a cross-repo test would red-gate this repo); re-run the comparison each
  January — backlog **B47**.
- ⚠️ **The local rate is confirmed** against the published county table.
  The **state rate is still a flat approximation** of 10 statutory
  brackets — see **B25**, and GigWorkTracker already has them. ⛔ **Owner acceptance is NOT verification** — a `TaxTablesAcceptance`
  quiets the warning down to one line that still says "Not IRS-verified", and
  never touches the flag. The acceptance is scoped to one
  `(tablesYear, transactionYear)` pair so it expires when the year rolls over.
- ⚠️ **A high W-2 earner reserves LESS self-employment tax, not more** — their
  wages already consumed the Social Security wage base. A test asserts it,
  because the opposite intuition is very natural and wrong.
- ⛔ **Backups verify THEN promote.** The copy lands on a `.tmp` name, is opened,
  hash-chain-walked and invariant-checked, and only then renamed over the target.
  Writing straight to the destination would let a corrupt source destroy a good
  previous backup before anyone knew it was corrupt. A test asserts yesterday's
  copy survives today's catastrophe.
- ⚠️ **`autoBackup` never throws.** The command already moved the money; failing
  it because a sync folder was offline is worse than a missing backup. It warns,
  records the error, and `status` reports staleness in **events behind**.
- ⚠️ **Backup settings read tolerantly, policy does not.** A malformed backup
  config degrades to defaults; a malformed policy stops the world. Different
  jobs: one is a safety net, the other is the rules.
- ⚠️ **Capitalised costs are recorded in `expenses` with `capitalized = 1`.**
  They are already inside an item's book value. Reporting that sums the expense
  table without that filter double-charges every item.

---

## Working agreements

- **Before starting any item:** re-read `~/.claude/CLAUDE.md` and this file, run
  the before-scan, and decompose the item into numbered sub-steps in
  `MASTER_PLAN.md`. Exactly one decomposed section on the page.
- **After finishing any item:** run the after-scan, file surfaced ideas to the
  Deferred backlog **in the same edit** that marks the item done, push the
  narrative to `MASTER_PLAN_LOG.md`, and promote the next active build.
- **Before presenting any choice:** lead with an explicit recommendation —
  which option, and one line of why.
- `npm run check` (typecheck + tests) must be green before an item is called
  done. A financial change without a test that would have caught its absence is
  not finished.

---

## Commands

```bash
npm run check                       # typecheck + full suite
npm test                            # vitest run
npx tsx src/cli/index.ts help       # the operator interface
npx tsx src/cli/index.ts verify     # hash chain + independent replay
```

