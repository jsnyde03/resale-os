# Resale OS — MASTER PLAN

**The queue.** Terse by rule. Detail, rationale and completed narrative live in
[MASTER_PLAN_LOG.md](MASTER_PLAN_LOG.md). Specs live in [docs/](docs/).

Exactly **one** decomposed section on this page — the active item's.

---

## ACTIVE

### Gate 5 — THE PHONE IS THE SYSTEM (re-planned 2026-09-09)

⛔ **This replaces "eBay ingestion", which is pushed to Gate 6.** Three of
Jason's constraints landed at once and together they force it:

| | |
|---|---|
| **No VPN or mesh on the phone** | Spark Driver flags them as manipulation apps. Tailscale is dead, and so is every WireGuard-shaped answer |
| **The desktop has no role** | not a mirror, not a backup client — retired |
| **It must not assume** | *"the app should be smart enough to exactly know my current bankroll"* — so no snapshots, no manual entry, no sync-and-hope |

Exact + offline + no home PC leaves one architecture: **the ledger lives on the
phone.** Hosting it dies in a shop with no signal and puts real money on a
vendor; any sync scheme is "exact as of last sync", which is the assuming that
was rejected.

**Stack: Expo + React Native**, matching GigWorkTracker (Expo 56, RN 0.85,
React 19, TS 6, Vitest — the same runner). ⛔ **Not Capacitor** — Jason spent
months migrating another app off it. ⛔ **Not Swift** — that means rewriting the
engine and discarding 445 tests, which are the reason to trust it with money.

⚡ **What this costs is bounded because of the purity discipline.**
`core + scoring + domain` is **4,878 lines and 445 tests of pure TypeScript that
move unchanged**. `node:sqlite` is imported in exactly one file, which
`ASSUMPTIONS_AND_RISKS` A1 predicted: *"the driver interface is 5 methods."*

- [x] **5.1** ✅ **Done 2026-09-09.** `tests/driver-contract.ts` — 18 cases
      defining what a driver must do, run green against `node:sqlite`. Planted
      twice (rollback becomes commit; nesting loses SAVEPOINT) and both red. It
      asserts what the engine leans on, not "SQLite works".
- [x] **5.2** ✅ **Done 2026-09-09. The purity claim holds.** Expo 56 / RN 0.85
      at `mobile/`, engine imported straight from `../src` and bundled: **1,213
      modules, 3.2 MB iOS Hermes bundle, ZERO edits to `src/`**. Verified by
      finding `INV_IDENTITY`, `PAYOUT_EXCEEDS_PAYABLE`, `SELL_THROUGH_TOO_LOW`
      and `socialSecurityWageBaseCents` inside the compiled bytecode — "it
      bundled" would otherwise be true of a bundle that excluded the engine.
      ⚠️ Metro needed the same `.js`→`.ts` resolver Turbopack did (**B38**).
- [x] **5.3** ✅ **PROVEN 2026-09-09. 16/16 against expo-sqlite on a real iOS
      simulator.** The gamble is retired. Run via GitHub Actions on `macos-26`
      (`.github/workflows/driver-contract-ios.yml`) because this machine has no
      simulator, no spare RAM and no phone that may carry a VPN. ⚡ **The lane
      was planted** — `get()` leaking expo-sqlite's `null` instead of
      `undefined`, the exact divergence the driver normalises — and CI went red
      with *"expected undefined, got null"*. A gate that cannot fail is
      decoration.
- [x] **5.4** ✅ **Done 2026-09-09. The store runs on a phone.** 24/24 on a real iOS simulator.
  - [x] **5.4.1** ✅ Migrations bundled as source, gated against the directory — no filesystem on
        a phone. Bundle them as strings, with a gate so the bundle cannot drift
        from the directory.
  - [x] **5.4.2** ✅ `src/db/engine-scenario.ts` — 8 cases as DATA, like the driver contract: migrate,
        contribute, buy, sell, expense, adjust, correct — then assert the chain
        verifies and `reconcile()` agrees. Run against both drivers.
  - [x] **5.4.3** ✅ **24/24 on the simulator** — 16 driver + 8 engine.
  ⚠️ **NOT "445 tests on device".** 14 of the 27 test files never touch a
  database; they exercise byte-identical pure code with no platform surface, so
  running them on a phone would be theatre. The 13 that touch the store are what
  the driver can actually break.
- [x] **5.4.4** ✅ **The store is platform-free.** Four couplings found and cut:
      `backup-types.ts`, `migrate-core.ts`, `db-types.ts` (params) and
      `open-store.ts` for the one genuinely platform-specific thing `FundStore`
      did. ⛔ **And the hash chain used `node:crypto`** — now `@noble/hashes`,
      byte-identical, with a golden value pinned and the live ledger still
      verifying.
- [~] **5.5** ⚙️ **Mechanism built and proven on the real ledger; the transfer
      itself needs the phone.** `src/db/portable.ts` — a fund travels as its
      COMMANDS (everything else is derived) and the destination **replays** them,
      comparing every regenerated hash. A mismatch refuses the import rather than
      accepting something that does not verify. ✅ **The live 55-event ledger
      exports and re-imports with every hash reproduced, chain OK, reconciling,
      NAV identical.** `cli export` / `cli import`.
      ⏳ **Needs Jason:** run `export`, get the JSON onto the phone, import.
- [x] **5.5.1** ✅ **D4 answered and built 2026-09-09.** An override is allowed
      and may never be silent: `overrodeGates` + `overrideReason` on PURCHASE,
      refused without a reason, stored in `items` (migration 006), shown by
      `items`, and in the cross-platform scenario so the phone proves it too.
      ⚡ Planted five ways, all red. → closes **B9**.
- [x] **5.6** ✅ **Done 2026-09-09, 41/41 on device.** The write screens —
      shell, buy, sell, money out, adjust, import — over one `FundStore`, with
      refusals as values. ⚡ `quote.ts` and `purchaseCommandFrom` shared with
      the CLI so a fund cannot disagree with itself about what it was allowed
      to buy. Screen coverage via pure form models + an on-device contract
      (**B60** half open: JSX binding still unasserted). D4 and B59 built here.
- [x] **5.7** ✅ **Done 2026-09-09.** Backups from the phone: the ledger's
      COMMANDS, replayed into a scratch database *before* any file exists, so a
      backup is verified by restore rather than by opening a copy. Automatic
      after every write, staleness on the position screen, 30 kept.
      ⚠️ **Getting one OFF the device is 5.9b** — the second obligation, and
      the only one still outstanding.
- [x] **5.8** ✅ **Done 2026-09-09, 42/42 on device.** The read screens —
      items, ledger, and one Reports screen with profit / accuracy / tax —
      rendering `src/server/views.ts` rather than porting it. ⚡ It was one
      import from dragging the desktop SQLite driver into the bundle;
      `lint:phone` now walks the whole graph. → **B62**, **B63**.
- [x] **5.8.7** ✅ **Expense reversal, the half 5.6.4 withheld.** Reached from
      the ledger row that has the event id, capped at what is still standing,
      and proven on-device to move the ledger and the analytic table together.
- [~] **5.9** ✅ **Decided 2026-09-09: TestFlight via CODEMAGIC** (Jason —
      "look at the debt app for how one used it before"). `codemagic.yaml`
      written, adapted from `debt-app-v1`'s proven Expo-56 lane and carrying
      the Hermes pin and the build-the-right-commit banner.
      ⏳ **Needs Jason:** add the repo in Codemagic and point it at the
      `AppleConnect` variable group. Nothing else can be done from here, and
      the FIRST run is the validation pass. The 80-day scheduled rebuild is a
      second workflow, added only after this one passes — scheduling it now
      would schedule a recurring failure.
- [x] **5.9b** ✅ **Done 2026-09-09.** A backups screen with a share sheet:
      `expo-sharing`, the newest copy first, and wording that claims only what
      the app can actually observe — a file was OFFERED elsewhere, not that it
      arrived. ✅ **43/43 on device** — `Installing ExpoSharing (57.0.18)` in the
      pod log, so the native module really was compiled in.
- [ ] **5.9c** ⚡ **ACTIVE BUILD.** ⛔ **THE GAP BETWEEN RECORDING AND DECIDING.** A sourcing screen:
      score an opportunity in the field and get the **walk-away price**.
      ⚠️ Found 2026-09-09 by asking what "ready" means — twelve screens on the
      phone and none answers *"should I buy this, and at what price?"*. `buy`
      only assesses a price already chosen. ⚠️ **Before-scan corrected the item
      2026-09-10:** `src/server/sourcing.ts` already IS this screen's model, so
      this is reuse like 5.8 — and **B58 measured true**, which is now .0.
  - [x] **5.9c.0** ✅ **Done 2026-09-10. One gate set (D14).** `scoring/purchase.ts`
        is the only path that decides a purchase — buy screen, `cli buy` and the
        on-device scenario all go through it. ⛔ **`assessQuote` DELETED**, not
        deprecated: it had tests, and a tested export reads as a blessed one.
        `tests/purchase-parity.test.ts` compares the two doors over a 140-row
        grid; **planted three ways, all red** (the old rule set → 8 + 69 + 309
        contradictions). 590 tests. → **B66**.
  - [x] **5.9c.1** ✅ **Done 2026-09-10.** `mobile/app/sourcing.tsx` renders
        `evaluateForm` — headline, ceiling + `boundBy`, ordered reasons, failed
        gates. Nothing recomputed; first button on the home screen, above Buy.
  - [x] **5.9c.2** ✅ **Done 2026-09-10.** Handoff carries every field plus
        `opportunityIdFrom(name, eventCount)` — collision-free where the old
        `aisle-<name>` was not. The asking price travels, not the ceiling: what
        is recorded is what was paid. ⚡ The SCORED class is now asserted
        on-device; only QUOTED was, and planted two ways.
  - [~] **5.9c.3** On-device verification. ⚠️ First run failed at TYPECHECK,
        not the build: `npm run check` never ran `mobile/tsconfig.json`, so
        phone screens were only typechecked in CI. Now local, and planted.
        Re-run in flight. B60's JSX-binding half still open.
- [ ] **5.10** Retire `src/cli`, `src/server`, `src/app` — 3,715 lines — once
      the phone covers them. ⛔ Not before, and ⚠️ **not until the fund has
      actually moved**: `cli export` is how it gets onto the phone. `views.ts`
      MOVES rather than goes (**B62**).
- [ ] **5.11** Tests, and the phase after-scan.

**Exit:** the fund lives on the phone, knows its exact position offline, and the
desktop is gone.

---

## Queue

| # | Gate | State |
|---|---|---|
| 1 | Architecture, schema, deterministic capital engine, tests | ✅ Done 2026-09-08 |
| 2 | Opportunity + Buy/Risk score + eligibility + recommendation | ✅ Done 2026-09-08 |
| 3 | Inventory & sale lifecycle, expenses, reserves, distributions, charge-offs, recoveries | ✅ Done 2026-09-08 |
| 4 | Dashboard + rules/config UI | ✅ Done 2026-09-08 |
| 5 | **The phone is the system** — engine ported, ledger on-device, desktop retired | ⚡ **ACTIVE** |
| 6 | **Sourcing: the app finds and recommends** — Browse API for candidates, SoldComps for value, own history accumulating | ⚡ **NEXT** — data route settled (**D12**) |
| 6.5 | **The watchlist that unlocks** — an out-of-reach opportunity is kept, carries the NAV at which it clears every gate, and resurfaces when the fund crosses it | Open |
| 7 | Market Radar beta — scarcity, demand, momentum, market opportunity, confidence | Open |
| 7.5 | **Drop intel** — dated retail drops, monitoring and alerting. ⛔ Checkout automation is OUT, see **D13** | Open |
| 8 | *(architecture only until 1–7 are reliable)* authorization states, drop intel, autonomy | Not started, not startable |

**Gate exit criteria are in the log**, one entry per gate.

---

## Owned by Jason — do not decide these

| # | Decision | State |
|---|---|---|
| D1 | What the tax reserve covers | ✅ **Incremental annual tax, 2026-09-08.** SE tax + federal brackets + QBI + state. ⚠️ Income tax abstains until a `TaxProfile` is set — **D7** |
| D14 | Which gate set decides a purchase, given the two paths disagree | ✅ **One evaluator everywhere — 2026-09-10.** `evaluateOpportunity` gates every purchase, typed or scored; `assessQuote`'s candidate stops being a decision path. ⚠️ **Deliberately stricter on the live fund:** a buy typed with no comps and middling sell-through now needs **D4**'s override with a reason. Measured first — 64 divergences in 96 cases, both directions (**B58**) |
| D13 | How far the app goes in online drops | ⛔ **Monitoring and alerting IN; checkout automation OUT — 2026-09-09.** Being first to KNOW is clean and is most of the edge; automating checkout violates retailer terms, and the penalty is order cancellations, account bans and flagged payment methods. **For a fund that is a capital event** — risking the accounts and payment rails the whole operation runs on, to win one console. ⛔ Nothing that defeats anti-bot systems: no CAPTCHA solving, fingerprint spoofing, proxy rotation or multiple accounts. ⚡ And the strategy points the same way: online drops are where the competition is scripts; **in-store allocation is where it is people, and Jason is in stores all day** |
| D12 | How the app values what it finds | ✅ **Browse API to find, SoldComps to value, own history to accumulate, manual as fallback — 2026-09-09.** ⛔ Sold comps are gated (Marketplace Insights is Limited Release and individual devs are denied; the logged-out sold search hit a login wall Aug 2026), and **without them the 45% confidence gate refuses nearly every purchase** — so this is a precondition, not an enhancement. Start on the free tier (100/mo); **Jason: "9 bucks is nothing"**, so Starter (2,000/mo) is pre-approved when it bites. ⚠️ The resellers work around eBay and the direction of travel is tightening — the manual path stays wired |
| D11 | When the fund starts buying | ⛔ **Not until the system is ready, and never arbitrarily** (Jason 2026-09-09): *"It doesn't make sense to arbitrarily buy something."* A purchase this system cannot justify is the exact thing it exists to prevent, so "exercise it with a real buy" is not a reason. **Ready means the phone can decide, not just record** — 5.9c |
| D2 | Owner split of after-tax profit (default 20/10/70) | ⚙️ **Default stands, revisit at $100 NAV** (Jason 2026-09-09). Not live: set-aside is off below $100 and the fund is at $50.00. ⚠️ That is four to six flips away, so decide it against the first real sales rather than in the abstract |
| D3 | Real starting bankroll and start date | ✅ **$50, live 2026-09-08.** $20 max per item |
| D4 | Whether a constraint override is ever allowed, and what it must record | ✅ **Allowed, and it must say so, 2026-09-09.** A purchase carries `overrodeGates` + `overrideReason`; the engine refuses an override with no reason, the item keeps both for life, and `items` prints them. `--force` now needs `--reason`. Unblocks 5.6 |
| D5 | What to source against | ✅ **Sell-through gate, category-neutral, 2026-09-08.** The hold time is derived from comps; categories deferred until the bankroll supports them |
| D6 | When profit starts being set aside | ✅ **At $100 of NAV, 2026-09-08.** Below it, owner + operating reserve are skipped and everything after tax compounds. Tax still accrues |
| D7 | The tax profile | ✅ **Set 2026-09-08.** Filing status, other income, W-2 wages and a combined state+local rate, plus standard deduction and QBI claimed federally and added back for the state. ⛔ **The figures live in `data/resale.db`, not in this repo** — `TaxProfile` is an input for exactly that reason |
| D8 | The 2025 tax tables | ✅ **Accepted as adequate for 2026, 2026-09-08.** ⚠️ Acceptance is not verification — `verified` stays false, and the acceptance expires at the 2027 year boundary |
| D10 | ✅ **Copy the figures, cite the sources, 2026-09-08.** How resale-os should take GigWorkTracker's verified 2026 tax tables | ✅ Done in 4.6 |
| A4 | How the phone reaches the dashboard, given nothing can be installed on it | ⛔ **MOOT, closed 2026-09-09.** Answered by the architecture rather than by a decision: Gate 5 puts the ledger ON the phone and 5.10 retires `src/app`, so there is no dashboard to reach. The VPN constraint that reopened it still stands and is recorded in `phone-cannot-run-vpn-apps` |
| D9 | How to clear the $1.50 of smoke-test SUPPLIES on the live book | ✅ **Add the no-cash correction, 2026-09-08.** `EXPENSE_CORRECTION` settles an expense against the event that already returned its cash, or reclassifies it between categories. Live book cleared; `evt_000005`/`evt_000006` |

---

## Recurring — fires on a date, not on a gate

⚠️ **Deliberately NOT in the queue above.** A recurring obligation with a
checkbox gets ticked once and then never fires again; these need to survive
being "done".

| when | what |
|---|---|
| **Every January** | **The tax-table review.** A new tax year means new federal brackets, a new standard deduction and a new SS wage base. Add `TAX_TABLES_<year>`, generate it from GigWorkTracker's config **by script**, and re-run the 65-figure comparison — nothing re-checks that transcription automatically, because a cross-repo test would red-gate this project whenever the other app moves *(was B47)*. ⚠️ **GigWorkTracker needs the same review in the same month** — its ROADMAP §6 describes its half. Do them together or they drift *(was B48)*. |
| **At each year boundary** | Any `TaxTablesAcceptance` expires by design. If the tables for the new year are not in yet, `tax show` starts warning again — that is the system asking, not a bug. |

---

## Deferred backlog (v1)

Filed, not forgotten. Nothing here is in a gate until it is promoted.

- **B1** Ledger hash-chain verifier script (`scripts/verify-ledger.ts`). Schema
  carries `prev_hash`/`hash` already; the verifier is not written. → Gate 3.
- **B2** Import-direction lint (`core` must not import upward). → Gate 3.
- **B3** Rejection-code histogram on the dashboard — shows *which gate is
  binding*, which is the instrument for R2. → Gate 4.
- **B4** Prediction-accuracy calibration loop (expected vs actual days and
  proceeds feeding back into confidence). → Gate 6.
- **B5** Period-close event for reserve true-ups (monthly). → post-Gate 4.
- **B6** Schedule-C-shaped expense export. → post-Gate 4.
- **B7** Multi-currency / sub-cent support. Only if selling internationally.
- **B8** Postgres driver implementation. Only when SQLite actually hurts.
- ~~**B9**~~ ✅ closed 2026-09-09 in **5.5.1**. Not a new event type in the end — an override is a property OF the purchase, and a separate event would have let the two drift apart.
- **B10** `channel_quotes` + marketplace routing comparison. → post-Gate 5.
- **B11** Backtest harness: replay historical opportunities against a new policy
  version to see what it would have bought. → Gate 6.
- **B12** Suppress the `node:sqlite` ExperimentalWarning in CLI output (it
  currently prints on every command). Cosmetic. → Gate 3.
- **B13** `BUSINESS_EXPENSE` with an `itemId` that does not exist fails on the
  foreign key with a raw SQLite error rather than an EngineError. → Gate 3.
- **B14** Revisit Vitest 5 once rolldown ships a working Windows binding (see
  log D-02).
- **B15** Year-to-date-aware SE tax: stop the 12.4% Social Security half at the
  annual wage base. Needs YTD earnings including W-2 wages. Irrelevant until the
  fund is very much larger. → post-Gate 4.
- **B16** Reopen **D1** before year end: decide `incomeTaxBps` with real numbers
  in hand rather than a guess. The reserve currently covers SE tax only.
- **B17** ⚠️ **Back up `data/resale.db`.** It is git-ignored, and it is the one
  file in this project that is not regenerable. A disk failure loses the whole
  book. Needs a decision on where backups go before the ledger has much in it.
- **B18** Category-specific eBay fee rates and any store-subscription rate.
  `src/core/fees.ts` uses the standard 13.25% + $0.40 for everything. → Gate 5.
- **B19** Make the per-item cap scale differently at tiny bankrolls — 40% of NAV
  is a diversification rule, and two items is not diversification.
- ~~**B15**~~ ✅ closed 2026-09-08 — the Social Security wage base is modelled.
- ~~**B21**~~ ✅ closed 2026-09-08 — the $400 threshold is modelled, so the
  reserve is genuinely zero below it rather than conservatively positive.
- **B22** Estimated quarterly payment scheduling: `tax show` knows the year's
  liability, so it could name the four due dates and amounts. → post-Gate 4.
- **B23** A `tax year-end` report shaped like a Schedule C, using the same
  model. Supersedes **B6**. → post-Gate 4.
- ~~**B24**~~ ✅ closed 2026-09-08 — the local rate looked up; combined rate set.
- ~~**B47**, ~~**B48**~~ ⚡ promoted into **Recurring** above — they fire on a date, not on a gate.
- **B46** ⚡ **GigWorkTracker's `services/tax-engine` already has VERIFIED 2026
  tables**, and resale-os is running unverified 2025 ones. Sourced there to IRS
  Rev. Proc. 2025-32, the SSA 2026 COLA fact sheet, Maryland statute, and the
  DLS/Comptroller local-rate table. Measured differences: SS wage base
  $176,100 → **$184,500**; single standard deduction $15,000 → **$16,100**;
  every federal bracket shifted up. All of it makes resale-os **over**-reserve,
  which is the safe direction — so this is accuracy and provenance, not a leak.
  ⚡ **The local rate is CONFIRMED** by that source, which answers **B26**'s
  county half. ✅ **Taken in 4.6** — D10 answered: copy the figures, cite the sources.
- **B26** ⚠️ **Half closed 2026-09-08.** The local rate is **CONFIRMED**
  against the published county table via GigWorkTracker. ⚠️ The **state
  marginal is still unchecked** — GigWorkTracker models Maryland as 10 statutory
  brackets rather than a flat rate, so the right fix is **B25**, not a lookup.
- ~~**B1**~~ ✅ closed — `verify` walks the hash chain and `reconcile()` cross-checks.
- ~~**B2**~~ ✅ closed — `npm run lint:imports`, planted and verified.
- ~~**B13**~~ ✅ closed — an unknown `itemId` on an expense is now an `EngineError`.
- ~~**B17**~~ ✅ closed — `backup` copies and **verifies** the copy; live ledger backed up.
- **B29** A passive recovery sets no `daysToSale`, so recovered items contribute
  nothing to prediction accuracy. Surfaced by the accuracy tests. → Gate 4.
- ~~**B30**~~ ✅ closed in 4.11 — one completeness check, derived from the defaults.
- **B30 (was)** Unify the config-drift defence. Four variants shipped in two days
  (policy repair, tax-profile repair, tax-table year, a validator that fell
  behind). Each is fixed; the *pattern* is not. One versioned-config helper with
  a validator driven off the default would close the class. → Gate 4.
- ~~**B31**~~ ✅ closed 2026-09-08 — automatic after every money-moving command,
  to OneDrive, verify-then-promote, dated dailies with 90-day retention, and
  staleness on `status`.
- ~~**B33**~~ ✅ closed 2026-09-08 — an `ADJUSTMENT` carries `reversesEventId`,
  the store writes a compensating expense row, and `verify` gained a drift
  control. ⚠️ It cannot see a reversal that does not DECLARE itself, which is
  why the legacy live residue is **D9** and not a bug.
- ~~**B36**~~ ⚡ promoted into **4.2.4**.
- **B36 (was)** ⚠️ **The CLI has no tests at all.** `src/cli/index.ts` is 1,200 lines
  routing every command, and nothing exercises it — the raw-stack-trace bug on a
  refused command shipped because no test opens the CLI. Gate 4 adds a second
  interface over the same functions, so a thin harness now serves both. → Gate 4,
  alongside 4.2.
- **B41** Visual design pass on the dashboard. Jason's read of 4.3 was "a basic
  screen" — accurate, and deliberate: 4.3 bought correct content and hierarchy,
  not craft. Worth doing once the screens exist and there is something to design
  *across*, not one card at a time. Pairs naturally with **B39** (nothing
  asserts styling). → after **4.11**, when every screen is built.
- **B51** Anne Arundel and Frederick counties are **graduated**, not flat, and
  are deliberately absent from `MD_2026.localRateBps` — a flat approximation of
  a graduated rate is the exact error 4.8 removed. They fall back to the flat
  profile rate. Only matters if the operator moves. → if ever needed.
- ~~**B49**~~ ✅ closed in 4.9 — it did, and 4.9 was mostly a screen.
- **B49 (was)** ⚡ **`rejectionHistogram()` already exists** on the repository and is
  now reachable read-only — **4.9 is mostly a screen**, not a build. Noticed
  during 4.7's before-scan.
- **B50** The feed cannot change a row's status from the phone (`setStatus` is a
  write, and the web surface is read-only by type). Marking something
  bought/passed is the same decision as **B45**: the first write from the web.
  → decide both together.
- **B52** `ledger` and `headroom` still have no screen. The event log is an
  audit view that belongs on a laptop; headroom is covered by the sourcing
  screen's ceiling. Both were checked against the gate exit line and judged out
  — recorded so the judgement is visible rather than an omission. → if wanted.
- **B44** The sourcing screen defaults hassle to 20%, comp age to 45 days, and
  postage/travel/tax to zero. Fine for a thrift-store flip, wrong for anything
  shipped in. Revisit when the fund buys something bulky. → Gate 5.
- **B45** A scored candidate cannot be saved from the screen — it recomputes
  from the URL each time. The URL IS the record, which is enough for now, but
  the feed (4.6) will want `opp add` from the phone. That is the first write
  from the web surface and needs its own decision. → **4.7**.
- ⛔ ~~**B42**~~ **DEAD 2026-09-09. Tailscale cannot be used at all.** Jason
  drives for **Spark Driver**, which flags VPN and mesh apps as "manipulation
  apps" — installing one risks the driver account, which is real income. **No
  phone-side VPN, ever**, in this project or any other. **A4 is reopened.**
- **B43** ⚡ **Now live, not deferred.** The session cookie sets `secure: false`
  because a tailnet served plain HTTP. Any public HTTPS endpoint makes that
  wrong immediately. → whatever A4 becomes.
- **B53** ⚠️ **The password gate has no rate limiting.** Irrelevant on a private
  mesh; a real gap the moment the endpoint is reachable from the internet. →
  whatever A4 becomes.
- **B39** ⚠️ **Nothing renders the dashboard in a browser, in CI or otherwise.**
  `screens.ts` makes the *decisions* testable, but styling, contrast and
  whether a row is legible at arm's length are asserted by nobody. A headless
  browser is the obvious answer and this machine cannot install one (see the
  npm tarball note). → revisit at Gate 5.
- **B40** The dashboard is read-only and there is no way to refresh it from the
  phone after a CLI command — it needs a manual reload. A poll or a revalidate
  button is cheap, but the phone-access decision landed at **4.4**, so this is
  unblocked. → post-Gate 4.
- **B38** ⚠️ **`dev` and `build` are pinned to `--webpack`.** Turbopack does not
  honour `extensionAlias`, so it cannot resolve this repo's `.js`-for-`.ts`
  imports and 500s on every page. The alternative was rewriting the extension
  off every import in the financial core to suit the dashboard. Revisit when
  Turbopack supports it, or if webpack support is dropped. → Gate 5.
- **B37** `#claimedAgainst` scans every EXPENSE_CORRECTION payload in the ledger
  on each settlement. Fine at 6 events, linear forever. Index it if corrections
  ever become common — they should not.
- **B35** The drift control covers the `expenses` projection only. It is the one
  analytic table `reconcile` never saw; if another is added, it needs its own
  two-source check rather than inheriting this one. → whenever a projection is
  added.
- **B32** Confirm OneDrive is actually signed in and syncing. The folder was
  empty apart from `desktop.ini`, so the destination is *configured* but its
  sync has not been observed. A backup to a folder that never leaves the disk is
  the failure this was meant to prevent.
- **B27** 7-day listing engagement as the fast feedback loop — watchers and views
  within a week, rather than waiting for a sale to close. Needs listing tracking.
  → Gate 5.
- **B28** Revisit categories (books as a margin play, per-category risk inputs)
  when the bankroll supports the hold tolerance. → Growth mode.
- ~~**B25**~~ ✅ closed in **4.8**.
- **B63** `store.events()` loads the whole ledger to render the last 40. Fine
  at 55 events and linear forever. Add a limit/offset read when the ledger is
  big enough to notice — not before, and the ledger screen already caps what it
  DRAWS. → post-Gate 5.
- **B62** ⚠️ **5.10 plans to retire `src/server`, and `views.ts` must NOT go
  with it** — the phone now depends on it. Move it to `src/ui/` (beside the
  form models) when the retirement happens, rather than deleting a read model
  the app is built on. Filed at 5.8's switch-in, before the retirement can get
  it wrong. → 5.10.
- ~~**B61**~~ ⚡ **Promoted to 5.9b, 2026-09-09** — the lane is green, so a
  native module can be validated.
- **B60** ⚙️ **Half closed 2026-09-09** (Jason: *both — contract now, RNTL
  later*). The form models are pure, tested and executed on-device. ⚠️ **What
  is still uncovered is the JSX binding** — whether the price box is wired to
  `price`. Add `@testing-library/react-native` only if a wiring bug actually
  reaches the device; until then the gap is named rather than guessed at.
  → Gate 5.
- ~~**B59**~~ ✅ **Answered 2026-09-09: record it, and split the report.** The
  risk pointed the other way — after 5.10 the scorer is the rare path, so a
  report that ignores the prediction the operator actually decided from is
  blind, not conservative. Built in 5.6.7.
- **B58** ⛔ **MEASURED 2026-09-09 and THEY DO NOT AGREE — promoted into 5.9c.**
  `assessQuote` (buy screen) and `evaluateOpportunity` (sourcing) reach the same
  `assessPurchase`, which skips any gate whose field is `undefined`: the quote
  candidate carries **velocity** confidence and **no** buy score, the evaluation
  carries **composite** confidence and one. 64 divergences in a 96-case sweep,
  **both directions** — BUY then `CONFIDENCE_TOO_LOW`, and REJECT then allowed.
  → decided in 5.9c.0.
- **B64** No screen takes **condition** or **hassle**; both fall to the schema
  defaults (`hassleBps` 2,000, condition a pessimistic 40%). Both move
  confidence, so they are real dials — but they are new financial input
  surface. → Gate 6.
- **B67** ⛔ **The iOS lane's `paths:` filter went stale twice more in one
  item** — 5.8 put `src/server/views.ts` on the device and 5.9c put
  `src/scoring/purchase.ts` there, and neither triggered a run. Fixed by hand
  again, which is the third time. `lint:phone` DISCOVERS the closure by scanning
  `mobile/`; a YAML path list cannot, so the fix is to generate the filter or to
  trigger broadly and gate inside the job. → Gate 5/6.
- **B68** A score made in the aisle is **not saved** — the phone evaluates and
  hands off, and nothing lands in `opportunities`. Correct for 5.9c (writing
  opportunities is tier 3, still closed) but it is the precondition for **6.5**,
  whose watchlist has nothing to watch until it exists. → Gate 6.5.
- **B66** ⚠️ **`assessPurchase` fails OPEN by construction and nothing detects
  it.** Every `PurchaseCandidate` gate field is optional, and a missing one
  skips its gate silently — which is right for `sellThroughBps` under an
  operator estimate (abstain, do not fail an unknown) and was wrong for the
  buy score for a whole surface (**B58**). The two cases are indistinguishable
  in the code. `validatePolicy` solved the same class by being exhaustive off a
  defaults object's keys; this wants the same treatment, or a lint. → Gate 6.
- **B65** `src/server/sourcing.ts` **MOVES rather than goes** at 5.10, exactly
  like `views.ts` (**B62**) — the phone renders it.
- **B57** The app has no icon — a white square on the home screen. Cosmetic,
  and only visible because a CI screenshot caught it. → before any TestFlight
  build (**5.9**).
- **B56** ⚠️ **The pre-publish scrub covered `src/` and `data/` and MISSED the
  planning docs.** `MASTER_PLAN`, the log, `CLAUDE.md` and `FINANCIAL_SPEC` were
  public for a day carrying filing status, income, county and a
  `C:/Users/<name>/` path. Scrubbed 2026-09-09, and `CLAUDE.md` now carries the
  rule. ⚠️ **The old objects stay fetchable by SHA** — hence the fresh repo.
  Anything published from here gets a whole-tree sweep, not a directory list.
  ⏳ **Needs Jason: delete `resale-os-prescrub-2` and `resale-os-prescrub-private`**
  — both private, both still holding the data, and the CLI token cannot delete.
- **B54** ⚠️ **`store.state()` answers from a cache, and a test that reads it
  is testing the engine against itself.** Cost a real hour in 5.5.1: a
  round-trip test passed with the new column dropped on the write path. Every
  storage assertion must use `derivedState()`. Worth a lint rather than a
  convention — nothing enforces it. → Gate 5.
- **B55** The migration-rebuild test hard-coded `[REBUILD]` as everything stage
  2 would run, so migration 006 broke it — and because the store was closed
  *after* the assertions, the real failure surfaced as an EBUSY from the temp
  directory cleanup. Both fixed in 5.5.1. Audit the other suites for
  hard-coded migration lists and for handles closed inside a `try`.
- **B20** `policy set` covers two knobs. Widen it, or build the config UI at
  Gate 4 and stop editing policy from a shell.
