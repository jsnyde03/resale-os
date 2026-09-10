# Resale OS

A private resale intelligence and capital management system. One operator, one
machine, real money.

It runs a resale business as a fund: it decides what may be bought, how much
capital may be risked, tracks every item and transaction, splits profit between
tax, reserves, the owner and reinvestment, and expands its own operating
boundaries as the bankroll grows.

**Status:** Gates 1 to 4 complete — deterministic capital engine and ledger,
plus opportunity scoring, a ranked feed, prediction accuracy and verified
backups. **Gate 5 — the phone is the system — is nearly done:** the engine, the
ledger, every screen and the backups run on the device, verified 43/43 against
Apple's SQLite in CI. 583 tests green.

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
npm run check          # five gates: bytes, imports, phone bundle, types, 583 tests
```

Run a real fund:

```bash
npx tsx src/cli/index.ts contribute --amount=50
npx tsx src/cli/index.ts buy  --id=pin-01 --name="Disney 50th pin" \
                              --category=DISNEY_PINS --price=12 --resale=32 \
                              --sold=60 --active=4
npx tsx src/cli/index.ts sell --id=pin-01 --gross=32 --fee=4.24 --payment=0.30 \
                              --postage=4.68 --packaging=0.35 --days=5
npx tsx src/cli/index.ts status
npx tsx src/cli/index.ts verify
```

### How long it will take to sell is derived, not typed

`--sold` and `--active` are the comp counts you can read before buying: how many
sold in 90 days, how many are listed now. The hold time comes out of them.

```
expectedDays = 90 × (activeListings + 1) / soldLast90Days
```

The `+ 1` is your own listing joining the queue. `--days=7` still works as a hand
estimate, but it carries a fixed **30% confidence** — below every mode's floor —
so a guess can never clear the gate on its own.

`headroom` gives you the number to look for in a shop:

```
To sell inside 10 days against 5 active listings, you need at least
54 sold in 90 days (26 to clear the 21-day ceiling).
```

`npx tsx src/cli/index.ts help` lists everything.

⚠️ **`--resale` is the GROSS price you expect to sell at**, before fees. The
system nets it through the marketplace fee model — 13.25% + $0.40 on eBay, plus
postage and packaging — before any gate sees a profit figure. Treating gross as
net is how a $7.01 profit looks like $17.00.

⚠️ **The ledger lives at `data/resale.db` and is git-ignored.** It is the one
file here that is not regenerable.

```bash
npx tsx src/cli/index.ts backup config --to="$OneDrive/resale-os-backups"
```

After that it is **automatic** — every command that moves money writes a copy,
because a backup that needs discipline is a backup that does not exist.

The copy is verified before it is trusted: it is opened, its hash chain walked,
every invariant checked, and it is **renamed over the target only if all of that
passes**. Verify-then-promote matters — writing straight to the destination
would let a corrupt source destroy a good previous backup before anyone knew it
was corrupt.

`latest` is refreshed every time; one dated copy per day gives point-in-time
recovery, pruned past 90 days, and pruning never empties the directory.

`status` reports how many events behind the last successful copy is, so a
silently failing backup cannot look like a working one.

The most useful command in the field:

```bash
npx tsx src/cli/index.ts headroom --category=DISNEY_PINS
# DISNEY_PINS: up to $20.00 landed cost clears every capital gate.
# To clear the $8.00 minimum profit on a $20.00 item, it has to sell for at
# least $38.91 gross on EBAY.
```

⚠️ **Policy lives in the database, not in the code.** Changing a default in
`policy.ts` does not change a fund that already exists. `policy show` warns when
the two versions disagree; `policy adopt-defaults` applies them.

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

`opp` scores an opportunity against the fund as it stands right now.

```bash
npx tsx src/cli/index.ts opp add --id=cart-01 --name="retro cartridge"       --category=GAMES --price=15 --resale=39 --sold=60 --active=4       --comps=38,39,40,38.50
```

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

`opp list` is the ranked feed — best score, then least risk, then soonest to sell:

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

`opp rejections` says which gate is actually binding, which is the thing to look
at if nothing is passing.

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

`buy --from-opp=X` carries a scored opportunity's prediction onto the item, which
is the only thing that makes this measurable:

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
profile** rather than guessing:

```bash
npx tsx src/cli/index.ts tax profile set --filing=MARRIED_JOINT \
      --other-income=45000 --w2-wages=45000 --state-rate-bps=0
npx tsx src/cli/index.ts tax show      # the year so far, and any shortfall
```

⚠️ **The tax tables are 2025 figures marked `verified: false`.** They are
*accepted as adequate for 2026* by the owner, which is deliberately **not** the
same as verified — `tax tables` shows both facts, and the acceptance expires at
the 2027 year boundary so the question comes back.

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
src/scoring/   Buy Score, Risk Score, confidence, max price, recommendation
src/db/        driver, migrations, store, replay, hash chain
src/ui/        pure form models the write screens are made of
src/adapters/  source adapters (eBay, manual, CSV)          [Gate 6]
src/market/    scarcity, demand, momentum, radar            [Gate 7]
src/cli/       the operator interface — retired at 5.10
mobile/        the Expo app; the engine is imported from src/, unchanged
tests/         583 tests; financial logic weighted heaviest
```

A visually impressive dashboard with incorrect bankroll math is unacceptable, so
the dashboard is Gate 4 and the math was Gate 1.
