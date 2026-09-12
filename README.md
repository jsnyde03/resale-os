# Resale OS

A private resale intelligence and capital management system. One operator, real
money, **and it runs on a phone.**

It runs a resale business as a fund: it decides what may be bought, how much
capital may be risked, tracks every item and transaction, splits profit between
tax, reserves, the owner and reinvestment, and expands its own operating
boundaries as the bankroll grows.

**Status:** Gates 1 to 5 built; Gate 6 — sourcing — is half built. The
deterministic capital engine, the ledger, opportunity scoring, prediction
accuracy and verified backups — **all of it runs on the device**, verified 55/55
against Apple's SQLite in CI and shipped to TestFlight. **The desktop was deleted
on 2026-09-10**: no CLI, no web app, no dev server. 807 tests green.

⚡ **The app decides, it does not only record.** It gives a price ceiling and the
rule that set it; says what would FIX a refusal rather than only naming it; says
whether a refusal is *not yet, at $150* or *never at any bankroll*; and keeps a
record of every decision, the walk-aways included — which is what makes *"why is
nothing passing?"* answerable from evidence.

⚡ **Why a phone.** The operator sources in shops. Nothing may be installed that
reaches a home machine, a hosted ledger dies where there is no signal, and any
sync scheme is only "exact as of last sync" — which is the assuming the design
rejects. Exact, offline and no home PC leaves one architecture: **the ledger
lives on the phone.**

**Live since 2026-09-08 on a real $50 bankroll.** BOOTSTRAP mode: $20 max per
item, 21-day hold ceiling, $8 minimum profit — and **nothing is set aside until
the bankroll reaches $100**, so every after-tax cent compounds until then.

---

## Read in this order

1. **[MASTER_PLAN.md](MASTER_PLAN.md)** — the queue. What is being built right now.
2. **[docs/FINANCIAL_SPEC.md](docs/FINANCIAL_SPEC.md)** — accounts, events, postings,
   invariants. The authority on the money.
3. **[docs/SCORING_SPEC.md](docs/SCORING_SPEC.md)** — Buy Score, Risk Score,
   confidence, max price. Every formula.
4. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — stack, module map, the seven
   rules that do not bend.
5. **[docs/SCHEMA.md](docs/SCHEMA.md)** — every table, including those reserved
   for later gates.
6. **[docs/ASSUMPTIONS_AND_RISKS.md](docs/ASSUMPTIONS_AND_RISKS.md)** — what would
   falsify each assumption and what it costs to reverse.
7. **[MASTER_PLAN_LOG.md](MASTER_PLAN_LOG.md)** — why every decision was made.

---

## Quick start

Requires Node >= 22.5 (for the built-in `node:sqlite` — there is nothing to compile).

```bash
npm install
npm run check          # six gates: bytes, imports, phone bundle, plan, types, 807 tests
cd mobile && npx expo start
```

⚠️ **There is no command-line interface.** `npm run check` is the whole
developer surface; the operator surface is the app. The engine is imported into
it unchanged — `core + scoring + domain` moved to React Native with **zero
edits**, which is what the purity rule below was for.

### How long it will take to sell is derived, not typed

`--sold` and `--active` are the comp counts you can read before buying: how many
sold in 90 days, how many are listed now. The hold time comes out of them.

```
expectedDays = 90 × (activeListings + 1) / soldLast90Days
```

The `+ 1` is your own listing joining the queue. A hand estimate still works but
carries a fixed **30% confidence** — below every mode's floor — so a guess can
never clear the gate on its own.

⚡ **Inverted, that is the sourcing rule you can use in a shop:** to clear
BOOTSTRAP's 21-day ceiling you need roughly **4.3 x (active + 1)** sold in 90
days — ten competing listings means 48 sold. Measured against the live policy,
clearance flips clear the profit and ROI floors easily and are refused on **hold
time**, which is the constraint that actually decides.

`headroom` gives you the number to look for in a shop:

```
To sell inside 10 days against 5 active listings, you need at least
54 sold in 90 days (26 to clear the 21-day ceiling).
```

⚠️ **`--resale` is the GROSS price you expect to sell at**, before fees. The
system nets it through the marketplace fee model — 13.25% + $0.40 on eBay, plus
postage and packaging — before any gate sees a profit figure. Treating gross as
net is how a $7.01 profit looks like $17.00.

⚠️ **`data/resale.db` is a RETIRED snapshot, not the fund.** The ledger moved to
the phone on 2026-09-10 and that file no longer changes. The app keeps its own
backups on the device.

Backups are **automatic** — every write makes a copy,
because a backup that needs discipline is a backup that does not exist.

The copy is verified before it is trusted: it is opened, its hash chain walked,
every invariant checked, and it is **renamed over the target only if all of that
passes**. Verify-then-promote matters — writing straight to the destination
would let a corrupt source destroy a good previous backup before anyone knew it
was corrupt.

The newest 30 are kept, and the position screen reports how many events behind
the last copy is, so a silently failing backup cannot look like a working one.

⚠️ **A copy ON the device is not a backup OF the device.** The app can share one
out, and it can only observe that a file was OFFERED — never that it arrived. It
says exactly that, because the one claim an operator would act on by not
checking is the one that must never be a lie.

⚠️ **Policy lives in the database, not in the code.** Changing a default in
`policy.ts` does not change a fund that already exists — `ensureSeeded()` only
writes when the row is absent. ⛔ **And nothing can currently change it:** the
commands that did went with the desktop, and the replacement screen is **5.12**.

### What that run actually does

```
$50.00 in.  BOOTSTRAP: max $20 per item, 21-day hold, $8 min profit.
            Set-aside OFF until $100 - profit compounds.

A $45 bag with a 45-day hold is refused, and says why:
  ✗ HOLD_TOO_LONG                  expected 45d hold vs 21d ceiling in BOOTSTRAP
  ✗ LONG_HOLD_ALLOCATION_EXCEEDED  long-hold capital would be $45.00 vs a $0.00 ceiling
  ✗ MAX_PER_ITEM_EXCEEDED          $45.00 in one item vs a $20.00 cap

A $15 pin sold at $39 gross, $10.92 of fees and postage:
  profit $13.08  ->  tax $1.26 · owner $0 · operating $0 · reinvested $11.82
  (bankroll $63.08 is below the $100 set-aside threshold - it all compounds)
  (the year is under $400 of SE earnings, so the $1.26 is income tax alone)

hash chain: OK.  replay: OK.
```

### What to buy

The **sourcing screen** scores an opportunity against the fund as it stands
right now, on the device, offline:

```
$15.00 landed  ->  $28.08 net  ->  $13.08 profit (87% ROI)
60 sold / 4 active  ->  ~8d (p90 18d)

buy score     77
risk score    41
confidence    72%
max to pay    $20.00  (limited by per item)

BUY  cart-01
  Buy at up to $20.00.
  Strongest on expected speed of sale and ROI.
  Risk 41/55, mostly share of the fund in one item, modeled downside, uncertain hold time.
```

⚠️ **The ranked feed is not on the phone yet.** It looked like this, and it is
what **B3** and **B68** are for — nothing currently saves a score to rank:

```
id            buy  risk  conf  days  profit    max pay   rec
cart-02       82   31    70%   3     $12.27    $12.27    BUY
cart-01       77   41    72%   8     $13.08    $20.00    BUY
thin-01       51   59    53%   9     -$0.67    $5.33     REJECT
slow-01       30   47    35%   315   $16.95    $20.00    REJECT
```

⚠️ **`slow-01` has the highest profit in that list and is rejected**, on a
315-day hold. Expected profit is not an input to any capital gate.

**Buy Score and Risk Score are never blended.** Autonomy will one day require a
high score *and* a low risk; collapsing them into one number would destroy that
gate before it exists.

⚠️ **Which gate is actually binding** — the thing to look at when nothing is
passing — needs scores to be saved first, and they are not yet. Backlog **B3**,
behind **B68**.

### Three profit numbers, and why they are kept apart

```
item profit               $12.48
  less business expenses  -$8.99
operating profit           $3.49
  less tax reserve        -$3.12
owner distributable        $0.37
```

That is a real flip. **$12.48 of item profit is 37 cents the owner may take** —
one packaging order and the tax reserve absorbed the rest. Reporting item profit
as "profit" is how a business quietly spends its tax money on boxes.

### How good were the guesses?

Scoring an item and then recording the purchase from that screen carries the
prediction onto the item, which is the only thing that makes this measurable:

```
scored sales            1
median days error       +6d
sold on time or early   0%
median proceeds error   -$2.60
realisation             83%
```

⚠️ **This is the instrument for the highest-ranked risk in the project:** the
ledger will be exactly right about numbers you guessed. An item bought without a
scored opportunity has no prediction and is **excluded**, not counted as zero.
And the verdict refuses to read a trend from fewer than five sales.

### The tax reserve

**Tax is annual and non-linear, so the reserve is not a percentage of a sale.**
It is the difference that sale makes to the year:

```
reserve = annualTax(ytdBusinessIncome + thisProfit) - annualTax(ytdBusinessIncome)
```

That is correct across the $400 self-employment cliff, the Social Security wage
base and every bracket step, because it never assumes a rate. Below $400 of net
SE earnings for the year the reserve is genuinely **zero**; the sale that
crosses the line carries the whole thing at once.

Income tax needs facts the ledger cannot know, so it **abstains until you set a
profile** rather than guessing.

⚡ **The 2026 tables are VERIFIED and are the default.** The figures came from a
sibling project's tax engine (IRS Rev. Proc. 2025-32; SSA 2026 COLA), were
**generated by script rather than typed**, and were machine-checked back against
the source — 65 figures, exact. ⛔ **Never hand-transcribe a bracket:** a typo is
wrong money and reads exactly like a correct number. The 2025 tables are kept,
still `verified: false`, for replaying older events.

The owner is paid on the first profitable transaction. There is no configuration
in which the fund keeps everything — `validatePolicy()` throws on it.

---

## The rules that do not bend

| | |
|---|---|
| **Integer cents, always.** | No floats touch the ledger. Splits are remainder-exact: no cent is ever created or destroyed. |
| **The ledger is append-only and double-entry.** | Balances are derived from postings, never stored. A mistake is corrected with an `ADJUSTMENT`, which leaves both the error and the fix visible. |
| **Invariants are checked before a write, not after.** | A command that would break the accounting identity throws, and the database is untouched. |
| **The financial core is pure.** | `src/core/**` has no I/O, no clock, no randomness, and imports nothing from the layers above it. |
| **No LLM touches money.** | Ava and any model are out of scope for financial calculation, capital rules and accounting. Determinism is the product. |
| **Confidence travels with every estimate.** | Low-confidence data is never spent like high-confidence data — it caps the Buy Score directly. |
| **Capital safety cannot be bought off.** | Expected profit is not an input to any capital gate. |

---

## Where the money is defined

Seven accounts. Assets `LIQUID` and `INVENTORY_AT_COST`; earmarks `TAX_RESERVE`,
`OPERATING_RESERVE`, `OWNER_PAYABLE`; equity `CONTRIBUTED_CAPITAL` and
`RETAINED_EARNINGS`.

```
NAV = LIQUID + INVENTORY_AT_COST - TAX_RESERVE - OPERATING_RESERVE - OWNER_PAYABLE
```

NAV is the bankroll, and NAV — not cash — decides the mode. A fund with its
capital deployed has not gotten poorer.

On a sale, **principal returns to the fund before anything is called profit**.
Then tax comes off the top — the incremental annual tax that sale causes — and
the after-tax remainder splits owner / operating reserve / reinvestment. Reinvested profit is the residual left in
retained earnings; it has no account, because the cash backing it is already
unencumbered.

---

## Bankroll modes

| | BOOTSTRAP (< $500) | GROWTH (>= $500) |
|---|---|---|
| Objective | capital **velocity** | velocity, plus a capped slice of medium holds |
| Max hold | 21 days | 60 days |
| No penalty below | 10 days | 21 days |
| Long-hold capital | **0%** | 30% of NAV |
| Max per item | 40% of NAV | 20% of NAV |
| Min profit / ROI | $8 / 35% | $15 / 25% |

### The warm-up: below $100, nothing is set aside

Under **$100 of NAV** the owner distribution and the operating reserve are both
skipped, and the whole after-tax profit compounds. A 20% cut of a $25 profit is
$5, and at a $50 bankroll taking it out is the difference between compounding
and crawling. The tax reserve still accrues, because tax is an obligation rather
than a distribution.

The threshold is checked against NAV *after* the sale, so the flip that crosses
$100 is the first one to pay out. `validatePolicy` requires the threshold to sit
below the GROWTH line, so the warm-up can never quietly become a permanent
100%-retention phase.

### When a floor stops fitting its bankroll

A profit floor and a per-item cap multiply into a constraint neither one states.
At the shipped $8 floor a $50 fund needs a 1.95x flip — fine. At a $100 floor it
would need **7.2x**, and `src/core/capital/reachability.ts` says so, along with
the inverse: a $100 floor implies about **$165** of bankroll at a 3x flip. The
warning prints in `status` rather than surfacing as a wall of rejections.

Promotion at $500, demotion below $450 — a hysteresis band, so a fund hovering
at the boundary cannot rewrite its own rules on every sale.

---

## Layout

```
src/core/      PURE deterministic engine — money, ledger, capital, constraints
src/core/tax/  annual tax model: SE tax, brackets, QBI, the incremental reserve
src/domain/    an opportunity and everything derivable from it
src/scoring/   Buy Score, Risk Score, confidence, max price, recommendation
src/screens/   screen MODELS — decided outside the .tsx, so they are testable
               where there is no browser and no device
src/db/        driver, migrations, store, replay, hash chain
src/ui/        pure form models the write screens are made of
src/adapters/  the outside world. TWO vendors: SoldComps for the
               market (D16 killed eBay) and UPCitemdb for barcodes,
               because SoldComps takes none. An adapter may reach
               src/core and nothing else                    [Gate 6]
src/core/market.ts  what a market READING is — the seam an adapter
               fills and a screen renders. Not src/market/ below
src/core/product.ts what a BARCODE resolves to, and the keyword
               derived from it. ⛔ The keyword is a money decision:
               two defensible readings measured 68% apart
src/core/drop.ts    a dated retail drop, and why an analogy to last
               year's model is CAPPED rather than trusted  [Gate 7.5]
src/market/    scarcity, demand, momentum, radar            [Gate 7]
mobile/        the Expo app; the engine is imported from src/, unchanged
tests/         807 tests; financial logic weighted heaviest
```

A visually impressive screen with incorrect bankroll math is unacceptable, so
the math was Gate 1 and the screens came fourth and fifth.
