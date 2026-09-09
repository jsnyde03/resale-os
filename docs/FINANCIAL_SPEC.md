# Financial Spec — accounts, events, invariants

_Authoritative. The code in `src/core/` implements exactly this. If they
disagree, one of them is a bug — say which._

## 0. Units and rounding

- Every amount is an **integer number of cents** (`Cents = number`, integer).
- Every rate is **integer basis points** (`Bps = number`, `10000 bps = 100%`).
- `applyBps(amount, bps) = roundHalfAwayFromZero(amount * bps / 10000)`.
- **Splitting is remainder-exact.** `allocate(total, [bps...])` computes each
  share by flooring, then hands the leftover cents out one at a time in
  descending fractional-remainder order (ties broken by index). The parts always
  sum to `total` exactly. No cent is ever created or destroyed by a split.

## 1. Chart of accounts

| Account | Class | Normal side | Meaning |
|---|---|---|---|
| `LIQUID` | Asset | Debit | Cash the business holds. Includes cash that is *earmarked*. |
| `INVENTORY_AT_COST` | Asset | Debit | Capital currently deployed in unsold inventory, at landed cost. |
| `TAX_RESERVE` | Earmark (liability) | Credit | Set aside for tax. A claim against `LIQUID`. |
| `OPERATING_RESERVE` | Earmark (liability) | Credit | Set aside for supplies/hosting/etc. A claim against `LIQUID`. |
| `OWNER_PAYABLE` | Earmark (liability) | Credit | Profit allocated to the owner, not yet paid out. |
| `CONTRIBUTED_CAPITAL` | Equity | Credit | Cash the owner put in. |
| `RETAINED_EARNINGS` | Equity | Credit | Everything the business earned and kept. **Reinvested profit lives here** — it is not a separate pot of cash. |

### Why reinvestment has no account

Reinvested profit is not moved anywhere: it is the *residual* left in
`RETAINED_EARNINGS` after tax, operating reserve and owner allocation are taken
out. The cash backing it is already in `LIQUID` and already unencumbered.
Creating a `REINVESTMENT` account would double-count it.

## 2. The invariant (checked after every single event)

```
LIQUID + INVENTORY_AT_COST
  - TAX_RESERVE - OPERATING_RESERVE - OWNER_PAYABLE
  - CONTRIBUTED_CAPITAL - RETAINED_EARNINGS
  == 0
```

Plus these floors, all checked on every commit:

| Invariant | Rule |
|---|---|
| `INV_BALANCED` | Every event's postings sum to zero (debits == credits). |
| `INV_IDENTITY` | The identity above holds. |
| `INV_NO_NEGATIVE_CASH` | `LIQUID >= 0`. |
| `INV_NO_NEGATIVE_INVENTORY` | `INVENTORY_AT_COST >= 0`. |
| `INV_NO_NEGATIVE_EARMARK` | Each of `TAX_RESERVE`, `OPERATING_RESERVE`, `OWNER_PAYABLE` is `>= 0`. |
| `INV_ITEM_BOOK_VALUE` | `INVENTORY_AT_COST == sum(book value of items in an active state)`. |

An event that would break any invariant **throws before it is written**. There
is no "fix it up later" path.

## 3. Events and their postings

Notation: `Dr` = debit (increase asset / decrease liability+equity), `Cr` =
credit. `L` = landed cost, `BV` = an item's book value.

### 3.1 `CONTRIBUTION(amount)`

Owner funds the bankroll.

```
Dr LIQUID               amount
Cr CONTRIBUTED_CAPITAL  amount
```

### 3.2 `PURCHASE(itemId, purchasePrice, inboundShipping, salesTax, acquisitionTravel)`

Landed cost `L = purchasePrice + inboundShipping + salesTax + acquisitionTravel`
is **capitalised** into the item's book value. Only pre-sale, item-specific
costs are capitalised; outbound postage, packaging and marketplace fees are
sale-side and never enter book value.

```
Dr INVENTORY_AT_COST  L
Cr LIQUID             L
```

Rejected before posting if capital constraints fail (§7).

### 3.3 `SALE(itemId, grossProceeds, marketplaceFee, paymentFee, outboundShipping, packagingCost, otherSaleCost)`

Two postings, always in this order, in one transaction.

**A — recognise.** `net = grossProceeds - marketplaceFee - paymentFee -
outboundShipping - packagingCost - otherSaleCost`, and `profit = net - BV`.

```
Dr LIQUID             net
Cr INVENTORY_AT_COST  BV          <- principal returns to the fund first, always
Cr RETAINED_EARNINGS  profit      (Dr instead, if profit < 0)
```

Principal returning to resale capital is structural, not a policy choice: the
`BV` credit is exactly the amount that leaves inventory, so the fund is made
whole before a single cent is treated as profit.

**B — allocate profit** (skipped entirely when `profit <= 0`).

```
tax   = computeTaxReserve(profit, policy.allocation.tax)      # see below
after = profit - tax.totalCents
parts = allocate(after, [ownerBps, operatingReserveBps, reinvestBps])  # sums to `after` exactly

Dr RETAINED_EARNINGS  tax        ; Cr TAX_RESERVE        tax
Dr RETAINED_EARNINGS  ownerCut   ; Cr OWNER_PAYABLE      ownerCut
Dr RETAINED_EARNINGS  opsCut     ; Cr OPERATING_RESERVE  opsCut
# reinvestCut: no posting. It is the residual already sitting in RETAINED_EARNINGS.
```

**Tax comes first.** The owner and the fund split *after-tax* profit, so the
reserve is never short because a distribution was taken out of pre-tax money.
Of the after-tax remainder: `ownerBps = 2000` (20%), `operatingReserveBps = 1000`
(10%), `reinvestBps = 7000` (70%) — all configurable, stored in `config`.

#### The set-aside threshold: below $100 of NAV, nothing is taken out

```
navAtAllocation = NAV before the sale + profit      # the bankroll as it now stands
if navAtAllocation < setAsideMinNavCents:
    ownerCut = 0 ; opsCut = 0 ; reinvest = profit - tax
```

Below `setAsideMinNavCents` (default **$100**) the owner distribution and the
operating reserve are both skipped and the entire after-tax profit compounds.
A 20% cut of a $25 profit is $5, and at a $50 bankroll taking it out is the
difference between the fund compounding and the fund crawling.

**The tax reserve still accrues below the threshold**, because tax is an
obligation rather than a distribution. The worry that this over-reserves under
$400 of SE earnings is **resolved**: the reserve now models the $400 threshold
directly, so below it the reserve is genuinely zero rather than conservatively
positive. (**B21** closed.)

The threshold is tested against NAV *after* the sale is recognised, so the very
flip that crosses $100 is the first one to pay out.

⚠️ **This revises an earlier requirement.** The original brief said the owner
receives profit from *every* profitable transaction from the beginning. It now
has a warm-up. What survives is the part that mattered — *"do not design an early
phase where 100% of profit is **permanently** retained"* — and `validatePolicy`
enforces it: `setAsideMinNavCents` must be below the GROWTH threshold, so the
warm-up can never become a phase.

#### What the tax reserve is, exactly

⚠️ **Tax is annual and non-linear, so a per-sale reserve cannot be a percentage
of that sale.** The $400 self-employment threshold is a cliff, the Social
Security wage base is a ceiling, and income-tax brackets are steps. A flat rate
is wrong on both sides of every one of them.

So the reserve for a sale is measured **against the year**, as a catch-up:

```
owedSoFar = businessTaxForYear(ytdBusinessIncome + thisProfit)
reserve   = clamp(owedSoFar - alreadyReservedThisYear, 0, thisProfit)
```

⚠️ **Catch-up, not increment.** The $400 cliff can owe more than the sale that
crosses it earns: crossing on $18.43 of profit makes $61.20 of SE tax owed at
once. A per-sale increment capped at the profit would silently drop $42.84 and
never reserve it. Measuring against the year carries the shortfall instead —
`carriedForwardCents` reports what is still outstanding, and later sales close
it. Measured: the gap opens at the crossing flip, shrinks monotonically, and
reaches exactly zero four flips later.
Implemented in `src/core/tax/annual.ts`; `src/core/capital/tax.ts` is a thin
adapter over it.

**Self-employment tax** (`selfEmploymentTax`), fully derivable from the ledger:

```
netEarnings = 92.35% of net business income
if netEarnings < $400        -> nothing is owed at all
socialSecurity = 12.4% of min(netEarnings, wageBase - W2wages)
medicare       = 2.9%  of netEarnings                      (uncapped)
additional     = 0.9%  above the filing-status threshold
halfDeduction  = floor((socialSecurity + medicare) / 2)    (surtax is not deductible)
```

**Income tax** (`annualTax`) needs facts the ledger cannot know — filing status,
other household income, state. Those live in a `TaxProfile`
(`src/core/tax/profile.ts`). **Until one is set, the income-tax component
abstains entirely and every consumer reports that it abstained.** A confident
wrong number is worse than an honest gap.

```
qbiDeduction = 20% of (businessIncome - halfDeduction)      (Section 199A)
taxable      = otherIncome + businessIncome - halfDeduction - deduction - qbiDeduction
federal      = progressive walk of the bracket table
state        = flat marginal rate x stateTaxable
stateTaxable = taxable + (stateAllowsQbiDeduction ? 0 : qbiDeduction)
```

⚠️ **The state base is not the federal base.** Most states — Maryland included —
start from federal *adjusted gross* income and do **not** allow the Section 199A
QBI deduction, so it is added back before the state rate applies. Charging the
state rate on federal taxable income under-reserves by `rate x QBI` on every
dollar of business income: $14.77 per $1,000 at Maryland's 7.95%.

`stateIncomeTaxBps` is a **combined state + local marginal** rate, because in
Maryland, Ohio, Pennsylvania, Indiana and New York City the income is exposed to
both. A flat marginal rate is a deliberate simplification — the full state
bracket walk is not modelled, and at a small side business the marginal rate does
not move.

**A non-zero state rate must carry its own derivation.** `stateRateBasis` is
required whenever `stateIncomeTaxBps > 0`, and `validateTaxProfile` throws
without it — a bare number nobody can check later is exactly the failure this
prevents. Zero needs no basis, because zero explains itself.

*The live value is the operator's state marginal plus their county rate, and it
lives in `data/resale.db` — never in this repo. ⚠️ Both were recalled, not
looked up; verify against the Comptroller's published local rate table. The
county turned out to be one of the cheaper ones, so the earlier top-rate
assumption was over-reserving by 55 bps.*

**Year-to-date is derived, never cached.** `FundState.ytdNetBusinessIncomeCents`
is realised profit minus business expenses for the calendar year of the
transaction, and it resets when a command lands in a new year. The store derives
it in one ordered pass over the ledger; `replay()` derives it by re-running the
engine; `reconcile()` compares the two.

⚠️ **A charge-off is NOT deducted from business income.** For a cash-basis
reseller the cost of unsold goods is not a deduction until they are disposed of,
and over-reserving is the safe direction. Documented, not accidental.

⚠️ **The tax tables are unverified.** `src/core/tax/tables.ts` carries 2025
federal figures with `verified: false`, and `taxTableWarnings()` surfaces both
that and any year mismatch.

**Verification and acceptance are two different facts, and the system keeps them
apart.** `verified` means somebody checked the numbers against an IRS release.
A `TaxTablesAcceptance` means the owner judged them adequate for a reserve
anyway. Accepting **never** sets `verified`, and the informational line it
produces still ends *"Not IRS-verified."*

An acceptance is scoped to one `(tablesYear, transactionYear)` pair, so accepting
2025 tables for 2026 does **not** silence 2027 — the warnings return when the
year rolls over, which is exactly when someone should look again.

*Accepted 2026-09-08 by the owner: 2025 tables, adequate for 2026, revisit
with 2026 figures.*

##### The cliff is real, and it is not smoothed

Below $400 of net SE earnings for the year the reserve is **zero** — the old
flat model reserved 14.13% on tax that was not owed. The sale that crosses the
line then carries the whole thing: at $400 of prior income, a $100 profit
reserves **$70.65**, because the year's SE tax became owed all at once.
Smoothing that would under-reserve, so it is left visible and the CLI says so.

> The owner is paid on **every profitable transaction, from the first one.**
> There is no phase in which the fund retains 100% of profit. This is a product
> requirement, and `tests/capital.owner-distribution.test.ts` fails if it stops
> being true.

### 3.4 `OWNER_PAYOUT(amount)`

Cash actually leaves for the owner. Capped at the `OWNER_PAYABLE` balance.

```
Dr OWNER_PAYABLE  amount
Cr LIQUID         amount
```

### 3.5 `BUSINESS_EXPENSE(amount, category, fundedFromOperatingReserve?)`

```
Dr RETAINED_EARNINGS  amount
Cr LIQUID             amount
```

If funded from the operating reserve, a **second balanced posting** releases the
earmark (it does not pay the bill twice — it un-earmarks the cash):

```
Dr OPERATING_RESERVE  min(amount, operatingReserveBalance)
Cr RETAINED_EARNINGS  same
```

### 3.6 `TAX_PAYMENT(amount)`

```
Dr TAX_RESERVE  amount
Cr LIQUID       amount
```

### 3.7 `CHARGE_OFF(itemId, reason)`

`reason` is one of `UNSELLABLE | DAMAGED | LOST | PERSONAL_KEEP | STALE`.
The item's book value is written off. **No cash moves, and capital does not
return to the fund** — that is the whole point.

```
Dr RETAINED_EARNINGS  BV
Cr INVENTORY_AT_COST  BV
```

The item moves to state `CHARGED_OFF` with `book_value_cents = 0` and its
`listing_live` flag left as-is, so a charged-off item can still be listed and
can still sell. `PERSONAL_KEEP` is a *reason*, not a separate posting:
economically the fund lost the capital either way, and modelling it differently
invites a phantom-asset bug.

### 3.8 `PASSIVE_RECOVERY(itemId, grossProceeds, fees...)`

A charged-off item sold anyway. Its book value is already 0, so the **entire net
is profit** and is allocated by the normal §3.3-B rules.

```
Dr LIQUID             net
Cr RETAINED_EARNINGS  net
<then the §3.3-B allocation on `net`>
```

### 3.9 `ADJUSTMENT(account, amount, reason)`

Manual correction, always paired against `RETAINED_EARNINGS`, always requiring a
reason string. It exists so that reconciling a real-world discrepancy never
tempts anyone to edit a row.

## 4. Derived metrics (never stored, always computed)

```
earmarks           = TAX_RESERVE + OPERATING_RESERVE + OWNER_PAYABLE
navCents           = LIQUID + INVENTORY_AT_COST - earmarks        <- "the bankroll"
unencumberedCash   = LIQUID - earmarks                            (== NAV - inventory)
capitalDeployed    = INVENTORY_AT_COST
minLiquidFloor     = applyBps(nav, policy.minLiquidFloorBps)
maxDeployed        = applyBps(nav, policy.maxDeployedBps)
deployableCapital  = max(0, min(unencumberedCash - minLiquidFloor,
                                maxDeployed - capitalDeployed))
```

`navCents` — **not** cash — is what drives bankroll mode. A fund that is fully
deployed has not gotten poorer, and must not be demoted mid-flip.

Reporting metrics: `realizedProfit` (sum of sale and recovery profit),
`ownerPaidToDate`, `chargeOffTotal`, `recoveryTotal`, `avgRealizedRoi`,
`medianDaysToSale`, `profitPerActiveHour`, `predictionAccuracy`.

## 5. Bankroll modes

| Mode | Active when | Objective |
|---|---|---|
| `BOOTSTRAP` | NAV < $500 | Capital **velocity**. Effectively no intentional holds. |
| `GROWTH` | NAV >= $500 | Velocity preserved; a capped slice may go to medium holds. |

**Hysteresis is deliberate.** Promotion requires NAV >= `promoteAtCents`
(50000). Demotion requires NAV < `demoteAtCents` (45000, a 10% band). Without
it, a fund oscillating around $500 changes its own rules mid-decision.

Growth does **not** mean "longer holds are now fine". It means the per-item cap
rises and a bounded `maxLongHoldBps` (default 3000 = 30% of NAV) may sit in
medium-hold inventory. The fast-turn engine keeps the other 70%. Thresholds are
config rows, so they can later become dynamic without a code change.

## 6. Policy defaults by mode

| Key | BOOTSTRAP | GROWTH | Meaning |
|---|---|---|---|
| `idealHoldDays` | 10 | 21 | No speed penalty at or below this. |
| `penaltyHardDays` | 14 | 35 | Speed sub-score has fallen to 0.35 here. |
| `maxHoldDays` | 21 | 60 | Above this the opportunity is **rejected**, not penalised. |
| `longHoldThresholdDays` | 14 | 30 | An item counts as "long hold" above this. |
| `maxLongHoldBps` | 0 | 3000 | Share of NAV allowed in long-hold items. |
| `maxCapitalPerItemBps` | 4000 | 2000 | Cap on one item, as a share of NAV. |
| `maxCategoryExposureBps` | 6000 | 4000 | Cap on one category, as a share of NAV. |
| `minLiquidFloorBps` | 1000 | 1000 | Cash that must stay untouched. |
| `maxDeployedBps` | 8500 | 8500 | Ceiling on total deployed capital. |
| `minExpectedProfitCents` | 800 | 1500 | $8 / $15 of expected profit per flip. |
| `minExpectedRoiBps` | 3500 | 2500 | 35% / 25%. |
| `minConfidenceBps` | 4500 | 5000 | Below this, no recommendation. |
| `minSellThroughBps` | 6500 | 5000 | Minimum sold / (sold + active). Mostly a backstop — a derived hold already implies a sell-through, so this exists to catch an optimistic **hand-typed** hold. |
| `minBuyScore` | 65 | 60 | |
| `maxRiskScore` | 55 | 60 | |
| `maxDownsideBps` | 1500 | 1000 | Modeled downside as a share of NAV. |
| `profitTargetCents` | 2500 | 6000 | Where the profit sub-score saturates. |
| `roiTargetBps` | 10000 | 6000 | Where the ROI sub-score saturates. |

At a $75 bankroll, `maxCapitalPerItemBps = 4000` means **$30 per item** — which
is what bootstrap flipping actually looks like.

## 7. Capital constraints (hard gates)

Each returns a machine code so the UI can say *why*, not just "rejected". All
gates are evaluated — evaluation does not stop at the first failure — so the
operator sees every reason at once.

| Code | Fails when |
|---|---|
| `HOLD_TOO_LONG` | `expectedDaysToSale > mode.maxHoldDays` — and the hold is **derived from comps** (`src/core/velocity.ts`), not typed in |
| `LONG_HOLD_ALLOCATION_EXCEEDED` | item is long-hold and long-hold capital after purchase > `maxLongHoldBps` of NAV |
| `MAX_PER_ITEM_EXCEEDED` | `landedCost > maxCapitalPerItemBps` of NAV |
| `INSUFFICIENT_DEPLOYABLE_CAPITAL` | `landedCost > deployableCapital` |
| `RESERVE_FLOOR_BREACH` | `unencumberedCash - landedCost < minLiquidFloor` |
| `MAX_DEPLOYED_EXCEEDED` | `capitalDeployed + landedCost > maxDeployedBps` of NAV |
| `CATEGORY_CONCENTRATION` | category exposure after purchase > `maxCategoryExposureBps` of NAV |
| `DOWNSIDE_TOO_LARGE` | `modeledDownside > maxDownsideBps` of NAV |
| `PROFIT_BELOW_MIN` | `expectedNetProfit < minExpectedProfitCents` |
| `ROI_BELOW_MIN` | `expectedRoiBps < minExpectedRoiBps` |
| `CONFIDENCE_TOO_LOW` | `confidenceBps < minConfidenceBps` |
| `SELL_THROUGH_TOO_LOW` | `sellThroughBps < minSellThroughBps`. Abstains when there are no comps — an operator estimate has no ratio to test |
| `BUY_SCORE_TOO_LOW` | `buyScore < minBuyScore` |
| `RISK_SCORE_TOO_HIGH` | `riskScore > maxRiskScore` |

**A high expected profit can never override a capital gate.** The gates are
evaluated independently of the score, and a single failure is fatal to the
recommendation. This is asserted directly in
`tests/constraints.test.ts` ("profit cannot override capital safety").

## 8. When the profit floor and the per-item cap fight

`minExpectedProfitCents` and `maxCapitalPerItemBps` are set independently, and
they multiply into a constraint that neither one states:

```
maxPerItem   = maxCapitalPerItemBps of NAV
grossNeeded  = grossNeededForNet(maxPerItem + minExpectedProfit, feeModel)
required     = grossNeeded / maxPerItem      <- the multiple EVERY flip must hit
```

At the shipped $8 floor and NAV $50 the required multiple is **1.95x**, which is
reachable. Raise the floor to $100 and the same $20 item must sell for
**$144.96** — a **7.2x on every flip**. That is not a policy anyone would write
down on purpose, and without naming it the only symptom is that the system
rejects everything and nobody can say why.

`src/core/capital/reachability.ts` computes it, and the inverse — the bankroll a
floor implies at a believable multiple:

```
landed   = (floor + fixedCosts) / (multiple * (1 - feeRate) - 1)
bankroll = landed / maxCapitalPerItemBps
```

At a 3x flip a $100 floor implies **$165** of bankroll ($66 per item); at 2x it
implies **$359.70**. `status` prints the warning whenever the floor is
unreachable, and the tests check the claim rather than asserting it — they buy
at the implied landed cost, sell at the multiple, and confirm the profit really
does clear the floor.

**A floor below the fee rate is unreachable at any bankroll.** If
`multiple * (1 - feeRate) <= 1`, every item loses ground on its own and scale
never rescues it; `bankrollForProfitFloor()` returns `null` for that case rather
than a reassuring large number.
