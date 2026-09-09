# Scoring Spec — Buy Score, Risk Score, Confidence

_Deterministic. No randomness, no clock, no LLM. `score(opportunity, portfolio,
policy)` returns the same result forever. Implemented in `src/scoring/`._

Every helper below is defined in `src/core/math.ts`:
`clamp01(x)`, `lerp(a,b,t)`, `bps(x) = round(x * 10000)`.

---

## 1. Confidence (computed first — it caps the Buy Score)

Confidence is **data quality**, not optimism. It is a weighted mean of four
0..1 signals, each defaulting to a deliberately pessimistic value when absent.

| Signal | Weight | Source | Default when absent |
|---|---|---|---|
| `compConfidence` | 0.40 | comp count + dispersion + recency (§1.1) | 0.30 |
| `demandConfidence` | 0.25 | whether sell-through came from real sold data | 0.25 |
| `conditionConfidence` | 0.20 | operator-entered 0..1 (photos, description quality) | 0.40 |
| `sourceConfidence` | 0.15 | adapter-declared reliability of the listing data | 0.50 |

### 1.1 `compConfidence`

```
countTerm      = clamp01(compCount / 8)                   # 8 comps ~ saturated
dispersionTerm = 1 - clamp01(compCv / 0.50)               # CV of 50% ~ worthless
recencyTerm    = 1 - clamp01(compMedianAgeDays / 90)
compConfidence = 0.40*countTerm + 0.40*dispersionTerm + 0.20*recencyTerm
```

`compCv = stddev(compPrices) / mean(compPrices)`, 0 when fewer than 2 comps
(and `countTerm` already punishes that case).

`confidenceBps = bps(confidence)`.

---

## 2. Buy Score (0–100) — "should this specific listing be purchased?"

Six sub-scores, each 0..1, combined by weight, then **capped twice**.

| Sub-score | Weight | Definition |
|---|---|---|
| `S_demand` | 0.30 | `clamp01(0.70*sellThrough + 0.30*velocityNorm)` |
| `S_speed` | 0.20 | piecewise on expected days-to-sale (§2.1) |
| `S_profit` | 0.20 | `clamp01( ln(1 + p/target) / ln(4) )`, `p = max(0, expectedNetProfitCents)` |
| `S_roi` | 0.15 | `clamp01(expectedRoiBps / roiTargetBps)` |
| `S_comp` | 0.10 | `compConfidence` from §1.1 |
| `S_ops` | 0.05 | `1 - clamp01(hassleIndex)` |

- `sellThrough = sold / (sold + active)` over the comp window; 0.5 default at low confidence.
- `velocityNorm = clamp01(soldPer30d / 30)` — one sale a day saturates it.
- `S_profit` saturates at `p = 3 * profitTargetCents` (because `ln(4)`), so it is
  monotonic with real diminishing returns rather than a cliff.
- `hassleIndex` is a 0..1 operator/adapter input: weight, fragility, bundle
  count, authentication burden, listing effort.

⚠️ **`expectedDaysToSale` is DERIVED, not entered** (`src/core/velocity.ts`, added
2026-09-08). Two counts observable before buying — how many sold in 90 days, how
many are listed now — give a queue model:

```
expectedDays    = 90 * (activeListings + 1) / soldLast90Days
expectedDaysP90 = 2.303 * expectedDays        # waits are exponential, not tight
confidence      = clamp01(soldLast90Days / 20)
```

The `+ 1` is your own listing joining the queue. A hand-typed hold is still
allowed but carries a fixed **30%** confidence, deliberately below every mode's
`minConfidenceBps`, so a guess can never clear the gate on its own.

```
raw = 100 * (0.30*S_demand + 0.20*S_speed + 0.20*S_profit
           + 0.15*S_roi    + 0.10*S_comp  + 0.05*S_ops)
```

### 2.1 `S_speed` — the velocity term

With `d = expectedDaysToSale` and the mode's `idealHoldDays` / `penaltyHardDays`
/ `maxHoldDays`:

```
d <= ideal                  -> 1.0
ideal < d <= penaltyHard    -> lerp(1.0, 0.35, (d-ideal)/(penaltyHard-ideal))
penaltyHard < d <= maxHold  -> lerp(0.35, 0.0, (d-penaltyHard)/(maxHold-penaltyHard))
d > maxHold                 -> 0.0        (and HOLD_TOO_LONG rejects it outright)
```

### 2.2 The two caps — this is where the product intent is enforced

⚠️ **Corrected 2026-09-08, by a test.** The original justification here said a
slow item with great economics "could still score in the 90s". That is **false**:
with `S_speed = 0` the weighted maximum is `100 × 0.80 = 80`, so the weights
alone already make 91 impossible on a 30-day hold.

What the caps actually buy is larger. **80 clears the 65 minimum**, so on weights
alone a 30-day hold in Bootstrap would be *recommended*. The velocity cap takes
it to **30** — below the floor — turning a buy into a pass. That is the real
enforcement, and it is stronger than the requirement as originally stated.

```
velocityCap   = 100 * (0.30 + 0.70 * S_speed)
confidenceCap = 100 * (0.55 + 0.45 * confidence)
buyScore      = round( min(raw, velocityCap, confidenceCap) )
```

Consequences, all of them asserted as tests:

- In BOOTSTRAP, `d = 30` gives `S_speed = 0` -> **cap 30**, against a raw 80.
  A Buy Score of 91 with a 30–60 day hold is arithmetically impossible, and more
  importantly the item cannot reach the 65 minimum either. *(Required by spec.)*
- In BOOTSTRAP, `d = 14` gives `S_speed = 0.35` -> cap 54.5. The "substantial
  penalty above 10–14 days" is a hard ceiling, not a nudge.
- A 90+ score requires `confidence >= 0.78` **and** `S_speed >= 0.857`
  (in BOOTSTRAP, `d <= 11`). "A score in the 90s means it sells quickly and with
  high confidence" is therefore true by construction, not by hope.

### 2.3 What is stored

`buy_score` (integer 0–100) **and** `confidence_bps` (integer) are stored as
separate columns, plus `score_breakdown_json` holding every sub-score and which
cap bound the result. Low-confidence data is never rounded up into looking like
high-confidence data.

---

## 3. Risk Score (0–100, higher = worse) — a separate concept

Risk is **not** the inverse of Buy Score and is never blended into it. Purchase
autonomy will eventually require a high Buy Score **and** a low Risk Score;
collapsing them into one number would destroy that gate.

Twelve normalised 0..1 risk factors, weights summing to exactly 100:

| Factor | Weight | Definition (0 = safe, 1 = maximal) |
|---|---|---|
| `capitalConsumed` | 16 | `clamp01(landedCost / (0.50 * NAV))` — half the fund in one item is max risk |
| `modeledDownside` | 16 | `clamp01(downside / (0.25 * NAV))` |
| `compUncertainty` | 11 | `1 - compConfidence` |
| `counterfeitRisk` | 9 | category base rate, overridable per opportunity |
| `holdUncertainty` | 8 | `clamp01((daysP90 - daysP50) / max(1, daysP50))` |
| `priceVolatility` | 7 | `clamp01(compCv / 0.40)` |
| `conditionUncertainty` | 7 | `1 - conditionConfidence` |
| `returnRisk` | 6 | category base rate x condition factor |
| `concentration` | 6 | `clamp01(categoryExposureAfter / maxCategoryExposure)` |
| `sellerRisk` | 5 | `1 - sellerScore` (feedback, account age, adapter signal) |
| `shippingComplexity` | 5 | weight/fragility/dimensional index |
| `restockRisk` | 4 | reprint / restock likelihood for the SKU |

```
riskScore = round( sum(weight_i * factor_i) )        # weights already sum to 100
```

`modeledDownside = landedCost - estimatedLiquidationNet`, floored at 0, where
`estimatedLiquidationNet` defaults to `applyBps(estimatedResaleValue, 4000)`
net of fees (a fire-sale at 40% of comp) when no explicit value is given.

---

## 4. Max recommended purchase price

Deterministic inverse of the gates. `netProceeds` does not depend on what we
pay, so with `otherLanded = inboundShipping + salesTax + travel`:

```
byRoi      = floor(netProceeds * 10000 / (10000 + minExpectedRoiBps)) - otherLanded
byProfit   = netProceeds - minExpectedProfitCents - otherLanded
byPerItem  = applyBps(nav, maxCapitalPerItemBps) - otherLanded
byCapital  = deployableCapital - otherLanded
maxRecommendedPriceCents = max(0, min(byRoi, byProfit, byPerItem, byCapital))
```

This is the single most useful number the system produces in the field: it is
what the operator negotiates against.

---

## 5. Recommendation

```
gates = evaluateConstraints(...)          # every gate, always, no short-circuit
if (gates.some(failed))            -> REJECT   (reasons = failed codes)
else if buyScore >= minBuyScore
     && riskScore <= maxRiskScore
     && confidenceBps >= minConfidenceBps -> BUY
else if buyScore >= minBuyScore - 10      -> WATCH
else                                      -> PASS
```

`reasoning` is a generated, deterministic string list — never prose from a
model — built from the failing codes and the three highest- and lowest-scoring
sub-components.

---

## 6. Market scores (Gate 6) — a different question

`Market Opportunity Score` answers *"should the system hunt this product or
category at all?"*, whereas Buy Score answers *"should this listing be bought?"*
They share inputs and must never share a column.

| Score | Inputs |
|---|---|
| `ScarcityScore` | active listing count, change in active supply, unique seller count, known edition size, restock frequency, geographic availability |
| `DemandScore` | sold velocity, sell-through, median sold price, price stability, expected days-to-sale |
| `MomentumScore` | 7/30/90-day price and volume movement, supply contraction, sales acceleration |
| `MarketOpportunityScore` | weighted blend of the three, times a confidence factor, times an eligibility factor |

Each carries its own confidence. Radar buckets: `TARGET`, `WATCH`, `COOLING`,
`AVOID`, plus the derived flags `RISING_DEMAND`, `FALLING_SUPPLY`,
`UNUSUAL_PRICE_MOVEMENT`.

### Watch-only / future-market eligibility

A market outside the current bankroll is still tracked, never hidden:

```
minRecommendedBankrollCents = typicalEntryCost / maxCapitalPerItemBps * 10000
currentEligibility          = ELIGIBLE | WATCH_ONLY | OUT_OF_RANGE
unlockReadiness             = clamp01(nav / minRecommendedBankroll)
```

At `unlockReadiness >= 0.80` the market surfaces as *"approaching unlock"*. When
NAV crosses the threshold the market becomes eligible **automatically** — the
operator is never required to hand-enable each category as the fund grows.
