  # Resale OS — MASTER PLAN

**The queue.** Terse by rule. Detail, rationale and completed narrative live in
[MASTER_PLAN_LOG.md](MASTER_PLAN_LOG.md). Specs live in [docs/](docs/).

Exactly **one** decomposed section on this page — the active item's.

---

## ACTIVE

### Gate 5 — THE PHONE IS THE SYSTEM ✅ **BUILT 2026-09-10**

⚡ **The fund lives on the phone, knows its exact position offline, and the
desktop is gone.** 44/44 against Apple's SQLite over the commit that deleted it;
shipped to TestFlight on Codemagic's first run. `core + scoring + domain` — 4,878
lines — moved with **zero edits**, and `node:sqlite` really was confined to one
file, as `ASSUMPTIONS_AND_RISKS` A1 predicted.

⚠️ **The exit criteria were incomplete**, which the phase after-scan found:
"the desktop is gone" was satisfied while a capability only the desktop had went
with it, so **5.12** put the settings screen back. Every item's detail, every
decision and every plant is in **MASTER_PLAN_LOG.md** — 5.1 through 5.12, plus
the phase after-scan.

**What Gate 5 cost that was not the port:** a hash chain quietly importing
`node:crypto`, four platform couplings in the store, two screens that gated a
purchase differently (**D14**), an export carrying a tax profile toward a public
repo, and a CLI that could fork the ledger the moment the fund left. **None were
portability problems. They were things the port made visible.**

---

### Gate 6 — SOURCING: THE APP FINDS AND RECOMMENDS

The data route is settled (**D12**): Browse API to find,
SoldComps to value, own history to accumulate, manual as the fallback that stays
wired.

- [x] **6.0** ✅ **Done 2026-09-10. 47/47 on device.** The aisle screen names the
      FIX and not just the failing gate (**B70**), takes condition and hassle as
      words anchored so the default reproduces the old score (**B64**, **B71**),
      and **records every decision including the walk-aways** (**B68**) — so
      **B3**'s histogram has something to count and **6.5**'s watchlist something
      to watch. Scores are device-local by decision (**D15**).

- [~] **6.1** ⏳ **BLOCKED on eBay account approval — the data route (D12).** ⚠️ **The valuable half
      is gated and may not be winnable**: Marketplace Insights is Limited Release
      and individual developers are denied, so sold comps — the number that
      decides — may stay manual. Build so that a refusal costs a field, never the
      screen.
  - [~] **6.1.1** ⏳ **Submitted 2026-09-10, awaiting eBay approval (~1 business
        day).** Nothing else in 6.1 can start until the keyset exists, so the
        active build moves to **6.2** for the wait.
  - [ ] **6.1.2** The client behind an ADAPTER, in `src/adapters/` — the layer
        that has been empty all along. ⚡ It will red-gate on arrival until its
        import rules are declared, which is 5.11.1's check doing its job.
  - [ ] **6.1.3** ⛔ **Offline-first, and the API never gates.** A shop with no
        signal is the normal case: the network FILLS fields and a failure leaves
        the screen exactly as usable as it is today. The fund must never wait on
        a vendor to answer whether it may buy something.
  - [ ] **6.1.4** GTIN lookup, which is what **B69**'s scanner would feed — sealed
        retail is fungible, so a barcode maps to an exact comp set where a
        keyword search does not.
  - [ ] **6.1.5** On-device verification.

**Exit:** the screen fills what it can from eBay, says where every number came
from, and answers exactly as well as it does today when the network does not.

- [x] **6.2** ✅ **Done 2026-09-10. Closes B3.** *What is stopping you* — the
      binding gate, from the record. ⚡ **The codes are stored STRUCTURALLY now**;
      the histogram used to regex-parse them out of prose, so a reworded reason
      would have emptied the chart in silence (older rows still fall back).
      ⛔ It carries a **denominator**: refusals that yield no code are reported as
      a **bug**, because an empty chart and a broken reader are the same picture.
      ⚠️ And it **reports a tie as a tie** — the first measured case had four gates
      firing on all six candidates, and naming the alphabetically-first one hid
      the only dial that moves. Found by a case failing, not by reading.

**Exit:** the fund can answer *"why is nothing passing?"* from its own record
instead of from a hunch.

---

## Queue

| # | Gate | State |
|---|---|---|
| 1 | Architecture, schema, deterministic capital engine, tests | ✅ Done 2026-09-08 |
| 2 | Opportunity + Buy/Risk score + eligibility + recommendation | ✅ Done 2026-09-08 |
| 3 | Inventory & sale lifecycle, expenses, reserves, distributions, charge-offs, recoveries | ✅ Done 2026-09-08 |
| 4 | Dashboard + rules/config UI | ✅ Done 2026-09-08 |
| 5 | **The phone is the system** — engine ported, ledger on-device, desktop retired | ✅ **Built 2026-09-10** — 5.11 (the phase after-scan) is closing it |
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
| D15 | Whether a backup carries scoring history | ✅ **No — scores are DEVICE-LOCAL, 2026-09-10.** The export is the commands plus config, and **everything in it is verified by regenerating it**. Opportunities are neither, and not derivable — a score records what was decided, when, under which policy — so carrying them would spend that guarantee on advisory data. ⚠️ A lost phone loses the rejection histogram and the watchlist, and **none of the fund**. The app says so on the backups screen |
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
| **Every 80 days** | **Rebuild and re-publish to TestFlight.** Builds expire after **90 days**, so this fires before the expiry rather than after it. ⚠️ **Not a CI cron** — Jason deploys Codemagic manually (2026-09-10), so this is a reminder, not a workflow. The plan previously assumed a second scheduled workflow; that assumption is retired. First publish: **2026-09-10**, so the next is due **2026-11-29**. |
| **At each year boundary** | Any `TaxTablesAcceptance` expires by design. If the tables for the new year are not in yet, `tax show` starts warning again — that is the system asking, not a bug. |

---

## Deferred backlog (v1)

Filed, not forgotten. Nothing here is in a gate until it is promoted.

- ~~**B3**~~ ✅ **Closed 2026-09-10 in 6.2**, on the phone, once **B68** gave it
  something to count.
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
- ~~**B12**~~ ✅ **Moot 2026-09-10** — the CLI that printed the warning is deleted.
- **B13** `BUSINESS_EXPENSE` with an `itemId` that does not exist fails on the
  foreign key with a raw SQLite error rather than an EngineError. → Gate 3.
- **B14** Revisit Vitest 5 once rolldown ships a working Windows binding (see
  log D-02).
- **B16** Reopen **D1** before year end: decide `incomeTaxBps` with real numbers
  in hand rather than a guess. The reserve currently covers SE tax only.
- ~~**B17**~~ ✅ **Answered 2026-09-10.** `data/resale.db` is a retired snapshot,
  not the fund. The live ledger is on the phone, backed up on-device after every
  write, with a copy shared off it. The open half is **B32**.
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
- **B41** Visual design pass — re-pointed 2026-09-10 from the deleted dashboard to
  the **phone app**. The screens are correct and plain; nothing asserts legibility
  (**B60**), and that judgement is Jason's. → Gate 6.
- **B51** Anne Arundel and Frederick counties are **graduated**, not flat, and
  are deliberately absent from `MD_2026.localRateBps` — a flat approximation of
  a graduated rate is the exact error 4.8 removed. They fall back to the flat
  profile rate. Only matters if the operator moves. → if ever needed.
- ~~**B49**~~ ✅ closed in 4.9 — it did, and 4.9 was mostly a screen.
- **B49 (was)** ⚡ **`rejectionHistogram()` already exists** on the repository and is
  now reachable read-only — **4.9 is mostly a screen**, not a build. Noticed
  during 4.7's before-scan.
- **B50** Nothing can change an opportunity's status — re-pointed 2026-09-10: the
  premise was the read-only WEB surface, which is gone. The phone can write, but
  nothing saves a score to change the status OF. Folded behind **B68**. → Gate 6.5.
- **B52** `headroom` has no screen. ⚠️ Half stale 2026-09-10: `ledger` DOES have
  one on the phone. Headroom is covered by what the sourcing screen prints.
  → Gate 6.
- ~~**B44**~~ ✅ **Merged into B64 2026-09-10** — the same defaults, one item.
- ~~**B45**~~ ✅ **Superseded 2026-09-10 by B68.** The premise was the WEB screen
  recomputing from a URL; the phone screen has no URL. Saving a score is B68.
- ⛔ ~~**B42**~~ **DEAD 2026-09-09. Tailscale cannot be used at all.** Jason
  drives for **Spark Driver**, which flags VPN and mesh apps as "manipulation
  apps" — installing one risks the driver account, which is real income. **No
  phone-side VPN, ever**, in this project or any other. **A4 is reopened.**
- ~~**B43**~~ ✅ **Moot 2026-09-10** — the session cookie went with the auth gate.
- ~~**B53**~~ ✅ **Moot 2026-09-10** — the password gate is deleted.
- ~~**B39**~~ ✅ **Moot 2026-09-10** — the dashboard is deleted. The phone's
  styling is unasserted for the same reason and that is **B60**.
- ~~**B40**~~ ✅ **Moot 2026-09-10** — no dashboard, and no CLI to be stale against.
  The phone reads its own ledger.
- **B38** **Metro** needs an `extensionAlias` resolver for this repo's
  `.js`-for-`.ts` imports. ⚠️ Re-pointed 2026-09-10: the Turbopack half died with
  Next.js; the Metro half is live and the phone depends on it.
- **B37** `#claimedAgainst` scans every EXPENSE_CORRECTION payload in the ledger
  on each settlement. Fine at 6 events, linear forever. Index it if corrections
  ever become common — they should not.
- **B35** The drift control covers the `expenses` projection only. It is the one
  analytic table `reconcile` never saw; if another is added, it needs its own
  two-source check rather than inheriting this one. → whenever a projection is
  added.
- **B32** ⚠️ **Re-pointed 2026-09-10: this is about the PHONE now.** The desktop
  OneDrive path is gone. The app writes backups on-device and can share one out,
  but it can only observe that a file was OFFERED — never that it arrived. There
  is no recurring off-device guarantee, and the phone is the only home.
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
- ~~**B62**~~ ✅ **Closed 2026-09-10 in 5.10.3.** `views.ts` is now
  `src/screens/views.ts` — it moved rather than went, as filed.
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
- ~~**B58**~~ ✅ **Closed 2026-09-10 by D14 in 5.9c.** One gate set; `assessQuote`
  deleted; `tests/purchase-parity.test.ts` compares the two doors.
- ~~**B64**~~ ✅ **Closed 2026-09-10 in 6.0.2.**
- ~~**B67**~~ ✅ **Closed 2026-09-10 in 5.11.1.** Not by generating the YAML —
  by making it ANSWER to the discovered closure. `check-phone-bundle.mjs
  --print-layers` emits the layers the phone reaches; `tests/ci-scope.test.ts`
  fails if the filter misses one. The two sides are an import-graph walk and a
  hand-typed list, which is what makes it a control. ⚠️ Scoped to the `paths:`
  block, not a grep of the file — every one of those directories is also named
  in a comment there.
- **B72** ⚡ **The scorer has four verdicts and can produce two.** Measured
  2026-09-10: 15,360 evaluations returned **BUY and REJECT only**; `WATCH` and
  `PASS` never occurred and no test had ever asserted either. **Mechanism proven
  by plant:** every score threshold `recommend()` checks — buy score, risk,
  confidence — is ALSO a capital gate on the same `ModePolicy` field, and a
  failed gate short-circuits to REJECT; disabling the buy-score gate made both
  verdicts appear immediately. ⚠️ **So the Buy and Risk scores inform but never
  decide** — anything they would reject, a gate already did.
  ⛔ **Not deleted:** `opportunities.recommendation` has a CHECK naming all four
  and old rows may carry them. Pinned by `tests/verdict-reachability.test.ts`,
  which asserts the INVARIANT rather than the dead code. → read before **6.5**.
- **B73** ⚠️ **Settings covers three fields of ONE mode.** 5.12 edits the ACTIVE
  mode's per-item cap, profit floor and hold ceiling. Not editable: the OTHER
  mode (so GROWTH's rules cannot be set before the fund reaches $500), and the
  whole `allocation` block — owner split and the set-aside NAV threshold. ⚡
  **That block is what D2 needs**, and D2 is due at $100 NAV, which is four to
  six flips away. → before D2 is answered.
- **B74** ⚠️ **SoldComps: `totalItems` is the count on the CURRENT PAGE, not a
  grand total.** Reading it as the sold count returns the page size — a plausible
  wrong number, which is the worst kind. The real count needs paginating until
  `hasNextPage` is false, and each page costs quota. ⚡ **A page is 240**, and the
  clearance rule needs `sold ≥ 4.3 × (active + 1)`, so one request settles almost
  every real case: an exact count when `hasNextPage` is false, otherwise a floor
  of 240 that clears any realistic ceiling. → **6.1.2**, before a line is written.
- **B69** ⚡ **Barcode scanning in the aisle** (Jason, 2026-09-10). The SCAN is
  the easy part — `expo-camera` does it offline, one screen. ⛔ **But a barcode
  is a product identity, not a price**, and the sourcing screen's binding fields
  are asking price (the tag in front of you — always typed), resale, sold-in-90
  and comps. A UPC supplies **none** of them without the eBay data route, which
  is **D12**, and sold comps are the gated half of D12. ⚡ **The offline-first
  win is different and better: scan → OWN HISTORY.** A UPC is a stable key, so
  the third leg of D12 — "own history to accumulate" — works on the device with
  no network and gets better every flip. ⚠️ **Scoped to RETAIL CLEARANCE by Jason, 2026-09-10** — Walmart
  racks, not thrift. That **removes** the no-barcode caveat (new retail is fully
  barcoded) and **improves** the data route: sealed product is fungible, so a
  GTIN maps to an exact comp set and Browse API's `gtin` filter beats keyword
  search. ⚡ **But the deciding number is sell-through, which is D12's gated
  half** — measured 2026-09-10: clearance flips clear profit and ROI easily and
  are refused on HOLD_TOO_LONG. The scan makes the query clean; it does not make
  the data available. → Gate 6, AFTER D12's data route.
- ~~**B70**~~ ✅ **Closed 2026-09-10 in 6.0.1.**
- ~~**B71**~~ ✅ **Closed 2026-09-10 in 6.0.2.**
- ~~**B68**~~ ✅ **Closed 2026-09-10 in 6.0.3.** ⚠️ The backup half is **6.0.5**.
- **B66** ⚠️ **`assessPurchase` fails OPEN by construction and nothing detects
  it.** Every `PurchaseCandidate` gate field is optional, and a missing one
  skips its gate silently — which is right for `sellThroughBps` under an
  operator estimate (abstain, do not fail an unknown) and was wrong for the
  buy score for a whole surface (**B58**). The two cases are indistinguishable
  in the code. `validatePolicy` solved the same class by being exhaustive off a
  defaults object's keys; this wants the same treatment, or a lint. → Gate 6.
- ~~**B65**~~ ✅ **Closed 2026-09-10 in 5.10.3**, alongside **B62**.
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
- ~~**B20**~~ ✅ **Superseded 2026-09-10 by 5.12.** `policy set` is deleted; the
  need it named is now the whole missing surface.