# Assumptions and Risks

_Written at Gate 1. Each item says what would falsify it, because an assumption
nobody can disprove is just a belief._

## A. Engineering assumptions (reversible, cheap)

| # | Assumption | Falsified by | Cost to reverse |
|---|---|---|---|
| A1 | `node:sqlite` (experimental in Node 22) is stable enough for single-user local data. | An API break on a Node upgrade, or a corruption event. | Low — the driver interface is 5 methods; swapping to `better-sqlite3` or `pg` is one file. |
| A2 | Hand-written SQL behind a repository beats an ORM at this size. | The repository layer passing ~1500 lines, or migrations becoming error-prone. | Medium — introduce Drizzle over the same tables. |
| A3 | Integer cents are sufficient; no sub-cent or multi-currency needs. | Selling internationally, or a platform reporting fractional-cent fees. | Medium — add a currency column and a minor-unit scale. |
| A4 | One operator, one machine, no auth beyond a local gate. | Wanting to check the dashboard from a phone on cellular. | Low — put it behind a single-password middleware and a tunnel. |
| A5 | Next.js at Gate 4 is soon enough; nothing before it needs a UI. | Needing to eyeball data before Gate 4. | Low — the CLI covers Gates 1–3. |

## B. Financial-model assumptions (the ones that can actually cost money)

| # | Assumption | Falsified by | Response |
|---|---|---|---|
| B1 | ⚠️ **REBUILT 2026-09-08. The reserve is the incremental annual tax a sale causes**, modelling the $400 SE threshold, the Social Security wage base, progressive brackets, QBI and a state rate. Income tax **abstains until a `TaxProfile` is set**. | A year-end bill the reserve does not cover — most likely because the profile's `expectedOtherIncomeCents` was wrong, or the tax tables were stale. | `tax show` compares the reserve against the estimate and names the shortfall. The tables carry `verified: false` until a human checks them. |
| B2 | **Landed cost capitalisation is the right cost basis.** Only pre-sale item-specific costs enter book value. | An accountant preferring expense-as-incurred. | The ledger records both; the split is derivable either way. |
| B3 | **NAV, not cash, drives bankroll mode.** | Wanting mode to reflect liquidity rather than net worth. | One line in `resolveBankrollMode`. Cash-based mode would demote the fund mid-flip, which is why it was rejected. |
| B4 | **Charge-off and personal-keep are economically identical to the fund.** | Wanting to track owner draws in-kind separately for tax. | The reason code is already stored; a separate report is additive, not a re-model. |
| B5 | **Profit allocation happens per transaction, not per period.** | Wanting monthly true-ups. | Additive: a period-close event that adjusts reserves. |
| B6 | **Below $100 of NAV, no profit is set aside** — the owner and operating reserve are skipped and everything after tax compounds (owner decision, 2026-09-08). The tax reserve still accrues. | Wanting a payout from the very first flip. | `setAsideMinNavCents` is a config row; 0 restores pay-from-the-first-cent. `validatePolicy` bounds it below the GROWTH threshold so it can never become permanent retention. |

## C. Product risks (ranked by what they'd actually cost)

### R1 — Estimate quality, not math quality, decides whether this makes money. **(Highest)**

The ledger will be exactly right about numbers the operator guessed. A Buy Score
is only as good as `estimatedResaleValue` and `expectedDaysToSale`. At Gate 1
these are hand-entered.

**Mitigation, built in from the start:** every scored opportunity stores its
prediction; every sale stores the actual. `predictionAccuracy` is a first-class
dashboard metric, not an afterthought, and the calibration loop (Gate 6+) reads
that history. If predictions are systematically optimistic, the system will be
able to say so with a number.

### R2 — A $50 bankroll is below the friction floor of most channels. **(Live risk)**

At the 40% per-item cap a $50 fund buys a **$20** item, which must sell for
about **$38.91 gross** to clear the $8 minimum profit after eBay fees and
postage — a 95% markup on every flip. The gates will reject a lot.

Compounding is what makes this survivable: below $100 of NAV nothing is set
aside, so every after-tax cent of profit goes back into the next purchase.

**Mitigation:** the constraints are honest about it — rejecting a lot is correct
behaviour, not a bug. `src/core/capital/reachability.ts` reports the multiple
each flip must hit and the bankroll any floor implies, and `status` warns when a
floor has become unreachable, so a misconfiguration is a number rather than a
mystery. The rejection-code histogram (Gate 4) shows which gate is binding.

### R3 — eBay ingestion is the fragile part of Gate 5.

eBay's Browse/Marketplace-Insights APIs need an application key and have
approval friction; scraping is brittle and against terms.

**Mitigation:** the adapter interface is designed so a **manual/CSV/paste
adapter is a first-class source**, not a fallback. Gate 5 ships with manual
ingestion working and eBay behind a credential check, so a blocked API delays
automation, never the business.

### R4 — Category concentration is nearly unavoidable at this size.

With a 60% category cap and a $50 fund, the ceiling is $30 in any one category —
so two $16 pins breach it.

**Mitigation:** the cap is a config row per mode; the constraint reports the
exact overage so the operator can make an informed override. **There is no
silent override** — an override, when it is built, will be a recorded event with
a reason.

### R5 — Scope. This document describes a system far larger than Gate 1.

**Mitigation:** the gates are ordered so each one is independently useful.
Gate 3 alone (a correct book plus inventory lifecycle) is already worth running
a real business on. Nothing later is allowed to start until the gate before it
has a green test suite.

### R6 — The tax model is a reserve, not a return.

It models self-employment tax, federal income tax at the marginal bracket, QBI
and a flat state rate. It does **not** handle: itemised-deduction detail, credits,
estimated-payment scheduling, multi-state apportionment, collected sales tax
(marketplaces remit it), or 1099-K reconciliation. It does not produce filings.

⚠️ **The two inputs most likely to make it wrong are the owner's, not the
system's:** `expectedOtherIncomeCents` (which decides the bracket) and the tax
tables (currently 2025 figures, `verified: false`).

**Mitigation:** stated here explicitly so it is a known gap rather than a
discovered one. `expenses` and `ledger_events` carry enough detail to produce a
Schedule-C-shaped export later.

## D. Things deliberately not being built now

Ava/LLM integration · autonomous purchasing · multi-channel routing ·
pre-release drop execution · multi-user · mobile-native packaging · pallets and
lot-splitting economics. Each has exactly one reserved seam (adapter interface,
`authorizations` table, `marketplace` column, `channel_quotes`) and no more.
