# Resale OS — Plan Log

Why every decision was made. Chronological. The plan is the queue; this is the
record. Read the entry for anything you are about to change.

---

## 2026-09-08 — Project created; Gate 1 built and green

### What exists

A private, single-operator resale capital system. Deterministic financial core,
SQLite persistence, a CLI, and 120 tests.

```
docs/ARCHITECTURE.md          stack, module map, the 7 non-negotiable rules
docs/FINANCIAL_SPEC.md        accounts, events, postings, invariants, policy defaults
docs/SCORING_SPEC.md          Buy Score, Risk Score, confidence, max price, market scores
docs/SCHEMA.md                every table, including the ones reserved for Gates 2/5/6
docs/ASSUMPTIONS_AND_RISKS.md what would falsify each assumption, and what it costs
src/core/                     PURE. money, ledger, capital engine, constraints
src/db/                       driver, migrations, store, replay, hash chain
src/cli/                      the operator interface until Gate 4
tests/                        120 tests, financial logic weighted heaviest
```

### Gate 1 exit criteria — all met

- `$75` bankroll in, every event type recorded, balances explainable to the cent.
- The accounting identity holds after every event; a violation throws before a
  row is written and the database is left untouched.
- Two independent derivations of fund state agree (postings-sum vs full replay).
- `npm run check` — typecheck plus 120 tests — is green.

### Decisions made, and why

**D-01. Stack: Node 22 + `node:sqlite` + hand-written SQL, no ORM.**
`better-sqlite3` needs a native build, which is exactly the class of thing that
eats an evening on Windows. `node:sqlite` ships with the runtime. An ORM buys
little across ~15 tables and costs a dependency; all SQL sits behind a 5-method
`Db` interface, so the Postgres port is a driver swap. *Reversible.*

**D-02. Vitest pinned to `^3.2.4`, not 5.**
Vitest 5 bundles with rolldown, whose native binding did not install on this
machine (`Cannot find module '@rolldown/binding-wasm32-wasi'`, and a clean
reinstall did not fix it). Vitest 3 is esbuild-based and works. Revisit when
rolldown's Windows story settles. *Reversible.*

**D-03. One sign convention: debit-positive for every account.**
Postings store `+` for a debit and `−` for a credit regardless of account class.
Consequences: an account balance is `SUM(amount_cents)`; the whole table always
sums to `0`; and the accounting identity becomes a one-line check instead of
per-class bookkeeping. `presentedBalance()` flips the sign for display, in one
place.

**D-04. Reinvested profit gets no account.**
It is the residual left in `RETAINED_EARNINGS` after tax, owner and operating
reserve are taken out, and the cash backing it is already unencumbered in
`LIQUID`. A `REINVESTMENT` account would double-count it. The split is still
reported explicitly on every sale, so the operator sees all four numbers.

**D-05. Tax is taken before owner and reinvestment.**
Otherwise a distribution comes out of pre-tax money and the reserve is short at
year end. The rate is a configurable *estimate* (default 25%) and the spec says
so out loud — this system does not pretend to compute a tax liability.

**D-06. The owner is paid from the first profitable transaction.**
`validatePolicy()` throws if `ownerBps <= 0`. There is deliberately no
configuration in which the fund retains 100% of profit, because that was an
explicit product requirement and a config default is not a guarantee. Tested
down to a 3-cent profit.

**D-07. NAV, not cash, drives bankroll mode.**
A fund with $60 of its $75 deployed has not become poorer, and demoting it
mid-flip would change the rules under an in-flight decision.

**D-08. Mode transitions are hysteretic (promote at $500, demote below $450).**
Without the band, a fund oscillating around $500 rewrites its own hold limits on
every sale. The cost is that mode depends on the *path* NAV took, so the store
derives it by replaying the NAV series rather than caching a column — there is
no cached mode that could drift from the ledger.

**D-09. Charge-off and personal-keep are the same posting, distinguished by
reason.** Economically the fund lost the capital either way. Modelling
personal-keep as an in-kind owner distribution created a phantom asset and an
`OWNER_PAYABLE` that could go negative. The reason code is stored, so a separate
in-kind report is additive later. A charged-off item keeps `listing_live`, which
is what makes passive recovery possible; recovery books the entire net as profit
because there is no principal left to return.

**D-10. The engine records what happened; constraints gate decisions.**
`applyCommand` enforces only invariants (you cannot spend money you do not
have). Policy gates live in `constraints.ts` and are advisory to a *purchase
decision*. A ledger that refuses to record a purchase the operator already made
in a parking lot is worse than useless. The CLI runs the gates first and needs
`--force` to record a failing purchase.
⚠️ **Gap:** a `--force` purchase is recorded but not *flagged* as an override.
That is backlog **B9**, blocked on decision **D4**.

**D-11. Every constraint gate is evaluated; evaluation never short-circuits.**
The operator sees all the reasons at once instead of fixing one and discovering
the next. The smoke test shows it: a $45, 45-day bag on a $75 fund returns
`HOLD_TOO_LONG`, `LONG_HOLD_ALLOCATION_EXCEEDED` and `MAX_PER_ITEM_EXCEEDED`
together.

**D-12. `normalizeZero()` on every sign flip.**
Negating a zero balance produces `-0`, which is not `0` under `Object.is` and
made nine assertions lie about correct code. It is never a meaningful money
value, so every negation in the codebase routes through one helper.

**D-13. Buy Score is capped, not merely weighted.**
⚠️ **The reasoning recorded here was wrong, and a test caught it on 2026-09-08 —
see D-28.** With `S_speed = 0` the weighted maximum is 80, so the weights alone
do satisfy the literal "91 is impossible" requirement. The caps earn their place
for a stronger reason: 80 clears the 65 minimum, so weights alone would
*recommend* a 30-day hold. Original text follows. So the weighted
score is bounded by `velocityCap = 100 * (0.30 + 0.70 * S_speed)` and
`confidenceCap = 100 * (0.55 + 0.45 * confidence)`. At 30 days in Bootstrap
`S_speed = 0`, so the ceiling is 30. A 90+ score therefore *requires*
`confidence >= 0.78` and a hold of ~11 days or less. Specified in
`docs/SCORING_SPEC.md` §2.2; implemented in Gate 2.

**D-14. A control-byte gate on source (`npm run lint:bytes`).**
A literal NUL byte got written into a string in `src/db/hash.ts`. It compiled,
all 104 tests passed, and the only symptom was git reclassifying the file as
binary — which means it produced no diffs and review could never have caught it.
The separator is now a printable `'|'` and `scripts/check-source-bytes.mjs`
fails the build on any control byte. It was **planted** (a NUL reintroduced into
`replay.ts`) to confirm it reds, and the restore was verified to confirm it
greens again. Turning the class into a gate beats remembering the instance.

---

## 2026-09-08 (later) — D1 and D3 answered; the tax reserve is now derived

### D-15. The tax reserve is **self-employment tax**, computed, not guessed

Jason: *"Tax reserve should be the amount taken out for self employment."*

The flat 25% was replaced by `src/core/capital/tax.ts`, which computes the
reserve from the actual formula:

```
seBase = 92.35% of profit
seTax  = 15.3% of seBase        (12.4% Social Security + 2.9% Medicare)
       = 14.13% of profit, effective
```

`AllocationPolicy.taxReserveBps` became `AllocationPolicy.tax: TaxPolicy`, whose
four fields are the SE base, the SE rate, an income-tax rate, and whether to take
the half-SE deduction. `validatePolicy` throws a message naming this entry if it
meets an old-shape policy, so a stale `config` row fails loudly at load rather
than silently reserving nothing.

**Why decompose rather than change one number to 1413.** A single blended rate
cannot be checked by anyone, and it hides *which* tax is covered. Split into
named components, the reserve is explainable on every sale — the CLI prints the
SE line, and the income-tax line whenever it is non-zero.

⚠️ **What this deliberately leaves uncovered, and it is the biggest open money
risk in the project:** `incomeTaxBps = 0`. Income tax is owed on the same profit
and is not being reserved for. Setting it to 1200 brings the total to **25.28%**
— almost exactly where the old flat guess sat, which is a decent sign the 25%
was not crazy, only unexplainable. Filed as **B16**, to be reopened before year
end with real numbers rather than a guess.

**Not modelled, each erring toward over-reserving:** the $400 annual SE
threshold (reserving from the first dollar is conservative; the reserve is
released if not owed), and the Social Security wage-base cap (**B15** — needs YTD
earnings including W-2 wages, and is not a real case at this scale). The half-SE
deduction is rounded **down** so its rounding error also over-reserves.

**Planted, not assumed.** Dropping the SE rate to 12.4% (Social Security only)
turns 14 tests red across 4 files; restoring it returns all 120 to green. One
test asserts the rate is specifically the *sum* of the two halves, so an edit
that drops Medicare fails rather than merely shifting a number.

The policy version went `2026-09-08.1` -> `2026-09-08.2`. An allocation is only
meaningful next to the rules that produced it.

### D-16. D3 answered: the real bankroll is $50, starting now

Jason, same sitting: *"Real starting bankroll is 50 dollars and I want to start
asap."*

At $50 in BOOTSTRAP the constraints resolve to: **$20 max per item**, $5 liquid
floor, $42.50 deployable, $30 category ceiling, $8 minimum profit, 21-day hold
ceiling.

⚠️ **That $8 floor on a $20 item is the binding constraint, and it is tight.**
After eBay fees (~13.25% + $0.30) and postage, a $20 item needs roughly **$33–35
gross** to clear it — a 65–75% markup on every flip. The gates will reject a lot.
That is correct behaviour rather than a bug, but it makes **D5** (which
categories to actually source) urgent rather than a Gate 5 concern: sourcing
starts now and the system has no opinion yet about where to look.

Risk **R2** in `docs/ASSUMPTIONS_AND_RISKS.md` was rewritten around the real
number, and **R4** with it: a $30 category ceiling means two $16 pins breach it.

`data/resale.db` was created and funded with the real $50.

## 2026-09-08 (button-up) — making the start-here docs match the code

An audit rather than an assumption, and it found four pieces of drift plus a
real defect.

### Doc drift, all corrected

- **`docs/SCHEMA.md` knew nothing about migrations `002` or `003`.** It restated
  every column, so it went stale within a day of the migrations landing. ⚡
  **Rewritten to stop restating SQL**: the migrations are the schema, and the
  document now explains the *conventions and the decisions* — the
  debit-positive convention, why `capitalized` exists, why nullable means
  "nobody produced this number", why `authorizations` has no writer. A doc that
  duplicates code will always drift; one that explains it does not.
- **`docs/ARCHITECTURE.md`'s module map** listed `core/money/` as a directory
  (it is a file), omitted `core/tax/`, `fees.ts`, `velocity.ts` and
  `db/repositories/`, and still marked `scoring/` as "[Gate 2]".
- **`FINANCIAL_SPEC` §6** was missing `minSellThroughBps`.
- **`CLAUDE.md`** still said *"Gate 1 CLOSED. Gate 2 ACTIVE."*

Verified as matching and left alone: the CLI help against the actual command
list (19 each), and the twelve risk weights against `SCORING_SPEC` §3.

### A real defect, found by cleaning up after myself

Two smoke-test expenses ($1.00 and $0.50 of SUPPLIES) had been recorded against
the **live** ledger while verifying auto-backup. Reversing them surfaced two
things:

1. ⛔ **There was no `adjust` command.** `ADJUSTMENT` existed in the engine —
   the sanctioned, append-only way to correct a mistake — with no operator path
   to it. The only way to fix a slip was to edit the database by hand, which is
   precisely what the hash chain exists to detect. **Added.**
2. ⚠️ **An `ADJUSTMENT` does not reverse the analytic `expenses` row.** After the
   reversal the ledger correctly returned to $50.00 while `profit --expenses`
   still reported $1.50 of SUPPLIES. **Two sources of truth for expenses, and
   only one self-corrects.** Filed as **B33**, with the warning written into
   `reporting.ts` itself so the dashboard cannot report either number in
   ignorance.

The reversal is deliberately visible in the ledger rather than tidied away —
`evt_000004` says what it reverses and why. That is the design working: both the
error and the correction remain.

## 2026-09-08 (end of session) — B31: backups that actually happen

### D-29. The destination was the easy half

Jason: *"What is your rec for backups?"* — then *"sounds good."*

**Where:** a OneDrive folder outside the repo. The ledger is **132 KB**
and will be single-digit MB after years; this was never a storage problem. It is
a "does a second copy exist off this disk" problem, and OneDrive is already
installed, already paid for, and already syncing.

**When mattered more than where.** The failure mode was never a bad destination —
it was a `backup` command that exists and never gets run by a solo operator doing
this in evenings. So it runs **automatically after every command that moves
money**. At 132 KB a verified copy costs milliseconds, and the entire class of
"I forgot" disappears. No scheduler, nothing to remember.

**Three design decisions worth keeping:**

1. ⚡ **Verify then promote, never promote then verify.** The copy lands on a
   `.tmp` name and is renamed over the target only after it opens, walks its
   hash chain and passes every invariant. Writing straight to the destination
   would let a corrupt source destroy a good previous backup *before anyone knew
   it was corrupt*. A test writes catastrophe over the live file and asserts
   yesterday's copy survives.
2. **`autoBackup` never throws.** The command already succeeded and the money
   already moved; refusing to acknowledge that because a sync folder was offline
   would be worse. It warns loudly, records the error, and `status` reports
   **events behind** — staleness measured in the unit that matters for a ledger.
3. **Backup settings read tolerantly; policy does not.** A malformed backup
   config degrades to defaults, because backup is a safety net and must never be
   the reason a command fails. A malformed policy still stops the world.

`latest` is refreshed every time so a restore is never more than one command
stale; one dated file per day gives point-in-time recovery, pruned past 90 days.
**Pruning never empties the directory** — a retention rule that can is a delete
script wearing a backup's clothes.

**A display wart caught by running it:** `status` printed inside a mutating
command reported the backup state from *before* that command's backup ran —
technically true and actively misleading. The line now appears only on a
standalone `status`, and the automatic backup announces itself in place.

⚠️ **Open: B32.** The OneDrive folder was empty apart from `desktop.ini`, so the
destination is *configured* but its sync has never been observed from here. A
backup to a folder that never leaves the disk is exactly the failure this was
built to prevent, and it needs confirming by hand.

## 2026-09-08 (end of session) — Gate 3 closed, and a phase-level look back

### Gate 3 — what shipped

| | |
|---|---|
| migration `003` | items gain `expected_net_proceeds_cents`, `expected_profit_cents`, `actual_net_proceeds_cents` |
| `buy --from-opp=X` | re-evaluates against the fund **as it is now**, carries the prediction onto the item, and computes expected profit against what was actually **paid** rather than the asking price |
| `accuracy.ts` | the instrument for risk R1 — expected vs actual days and proceeds, with a verdict that refuses to read a trend from fewer than five sales |
| `reporting.ts` | item profit vs operating profit vs owner-distributable, and an expense breakdown that excludes capitalised costs |
| `backup.ts` | copies the ledger and **verifies the copy opens, walks its hash chain and passes every invariant** — deleting it if not |
| `check-import-direction.mjs` | **B2**, planted and verified |

⚡ **The three profit numbers, on a real flip:**

```
item profit               $12.48
  less business expenses  -$8.99
operating profit           $3.49
  less tax reserve        -$3.12
owner distributable        $0.37
```

$12.48 of item profit is **37 cents** the owner may take. One packaging order and
the tax reserve absorbed the rest. That is the whole argument for keeping the
three apart, in one screen.

**A prediction gap fixed:** `expectedResaleCents` was a GROSS price while the
outcome was NET, so accuracy would have been comparing different things. Items
now store the expectation in the same terms as the outcome — and **null when
there is no prediction**, because treating a missing expectation as zero would
manufacture a huge fake error and poison the average.

**Two real bugs found while building it:**

- A file-handle leak in `backup.ts`. `openDb` runs PRAGMAs in its constructor, so
  a source that is not a database throws before there is a handle to close, and
  `node:sqlite` leaks the OS handle — on Windows the file then cannot be deleted.
  Fixed by checking the 16-byte SQLite magic header **before** opening anything.
- **B13**: an unknown `itemId` on a business expense surfaced as a raw SQLite
  foreign-key error from three layers down. Now an `EngineError` at the boundary.

---

## Phase after-scan — Gates 1 to 3 viewed together

Three patterns only visible across the whole phase.

### P1. Four variants of one bug: stored config drifting from code

`policy adopt-defaults` and `tax profile set` both **read and validated the
broken thing before replacing it**, so the repair could not run against what it
existed to repair. The tax tables needed a year-scoped acceptance so a decision
would not silently carry into the next year. And `validatePolicy` checked a
**hand-written list**, so a new field slipped through as `undefined`, reached a
gate as `NaN`, and printed *"vs a NaN% minimum"* — failing closed by luck.

Each is fixed. **The pattern is not.** The root is identical every time: a stored
value and a code definition that can disagree, with nothing forcing a comparison.
Filed as **B30** — one versioned-config helper with a validator driven off the
default object would close the class rather than the instances.

⚠️ **I fixed the instance and not the class once already this session, and it
recurred within the hour.**

### P2. Three confident claims, all false, all falsified only by computing them

1. *"80% of the weight sits outside speed, so strong economics could carry a slow
   item into the 90s."* The weighted maximum is 80.
2. *"A higher earner reserves more tax."* They reserve **less** — their W-2 wages
   already consumed the Social Security wage base.
3. *"$32 gross is $32 of proceeds."* It is $22.01, and that one would have
   approved unprofitable purchases with real money.

All three were written down confidently, survived review, and were caught by a
test or a probe. **Measure before asserting** is in CLAUDE.md, and this phase is
the evidence for why.

### P3. The shell corrupted source three times

A literal NUL byte in `hash.ts`, a `
` becoming a real newline inside a string
literal, and every backslash eaten out of a regex. `npm run lint:bytes` catches
the first class; the other two only failed loudly because TypeScript rejected
them. **Prefer Write/Edit over shell heredocs for anything containing escapes.**

### Coverage checked across the phase

`npm run check` now runs four gates: source bytes, import direction, typecheck,
and 282 tests. Every plant this session was verified to red **and** the restore
verified to green.

## 2026-09-08 (later still) — Gate 2 closed

### D-28. A test corrected the reason the Buy Score caps exist

The spec justified the two caps like this: *"80% of the weight sits outside
speed, so strong economics could carry a slow item into the 90s."*

**That is false, and a test found it.** With `S_speed = 0` the weighted maximum
is `100 x 0.80 = 80`. The weights alone already make 91 impossible on a 30-day
hold, so the literal requirement never needed a cap at all.

⚡ **What the caps actually buy is bigger than the requirement.** 80 clears the
65 minimum, so on weights alone a 30-day hold in Bootstrap would be
**RECOMMENDED**. The velocity cap takes it to 30 — below the floor — and turns a
buy into a pass. Two tests now assert both halves: that 91 is impossible, and
that the raw 80 would have passed while the capped 30 does not.

The wrong reasoning was in `buy-score.ts`, `SCORING_SPEC.md` §2.2 and log D-13.
All three are corrected in place, with D-13 marked rather than rewritten.

**The lesson is the familiar one.** The claim was plausible, written down
confidently, and survived a spec review and an implementation. Only computing it
falsified it.

### Gate 2 — what shipped

`src/scoring/` and `src/domain/opportunity.ts`, 263 tests green.

| | |
|---|---|
| `confidence.ts` | comp count, dispersion and recency; four weighted signals. `demandConfidence` is `velocity.confidenceBps` — corrected from the spec's "did it come from sold data" |
| `buy-score.ts` | six sub-scores, two hard caps, the binding cap reported |
| `risk-score.ts` | twelve factors, weights asserted to sum to 100 **at module load** — a mis-weighted risk model must never run at all |
| `max-price.ts` | five-way inverse, reporting which limit binds. Goes through the fee model, so gross is never mistaken for net |
| `recommend.ts` | BUY/WATCH/PASS/REJECT with generated reasons; a failed gate is fatal regardless of score |
| `evaluate.ts` | one entry point, so the feed and the screen can never disagree |
| `opportunity.ts` | zod at the boundary; refuses input where the hold time has no source |
| migration `002` | opportunities + authorizations. `APPROVED`/`ARMED` already in the CHECK |
| `repositories/opportunities.ts` | ranked feed, filters, and the rejection histogram |

**Corrections made to the pre-authored decomposition at switch-in**, per the
verify-before-acting rule — all four premises had gone stale in a day:

- 2.1's fee model and velocity had already shipped (D-17, D-26).
- 2.2's `demandConfidence` definition was superseded by `velocity.ts`.
- 2.4's `categoryRiskDefaults` was **dropped**: D5 deferred categories, so risk
  inputs are per-opportunity with conservative defaults (→ **B28**).
- 2.7's schema in `SCHEMA.md` predated comps and had no columns for them.

**What the feed looks like on the live fund:**

```
id            buy  risk  conf  days  profit    max pay   rec
cart-02       82   31    70%   3     $12.27    $12.27    BUY
cart-01       77   41    72%   8     $13.08    $20.00    BUY
thin-01       51   59    53%   9     -$0.67    $5.33     REJECT
slow-01       30   47    35%   315   $16.95    $20.00    REJECT
```

⚡ **`slow-01` has the highest profit in the list and is rejected.** That is the
"profit never overrides capital safety" rule visible in output rather than
asserted in a doc, and a test asserts it end to end.

`opp rejections` reports which gate is actually binding — the instrument risk R2
asked for, arriving two gates earlier than planned because the data was already
there.

### D-26. D5 answered: gate on sell-through, not on a category list

Jason, on the category question: *"I'm not sure for D5. Give me your rec."* Then,
on my proposal to measure category fit over 60 days: *"60 days is too long of a
lead time at first."* Then: *"sounds good. We can focus on categories when the
bankroll supports it."*

⚡ **He was right and it changed the answer.** My first recommendation was books
as the primary vertical — cheapest unit, most at-bats, a rural county under-picked
for them. But books turn in 30-90 days, and a $50 fund cannot wait that long to
find out whether any of this works. The at-bats argument survives; the category
does not.

**What replaced it:** the thing that predicts days-to-sale is observable *before*
buying, at zero lead time — how many sold recently against how many are listed.

```
expectedDays = 90 * (activeListings + 1) / soldLast90Days
```

The `+ 1` is your own listing joining the queue. `src/core/velocity.ts`.

**Three consequences, all improvements on what I first proposed:**

1. **`expectedDaysToSale` is no longer typed in.** It was a guess, and R1 says
   estimate quality — not math quality — decides whether this makes money.
2. **A hand-typed hold carries 30% confidence**, fixed, deliberately below every
   mode's `minConfidenceBps`. A guess cannot clear the gate alone, which closes
   the obvious way around the evidence requirement.
3. **`expectedDaysP90 = 2.303 x mean`**, because waiting for one buyer out of a
   Poisson stream is exponential — the p90 is not the mean plus a nudge.

**`SELL_THROUGH_TOO_LOW` added**, and it is honestly a backstop: a derived hold
already implies a sell-through, so it rarely binds on comp-based estimates. Its
real job is catching an optimistic hand-typed hold. It **abstains** when there
are no comps rather than failing an unknown.

`headroom` now names the number to look for in the field: *"to sell inside 10
days against 5 active listings you need at least 54 sold in 90 days (26 to clear
the 21-day ceiling)."*

**Categories deferred until the bankroll supports them** — the architecture stays
category-neutral, which is what the original brief asked for. Books become a
Growth-mode play, when there is hold tolerance for a margin bet. **B28.**

### D-27. A validator that could fall behind, and did

Adding `minSellThroughBps` to `ModePolicy` broke the live fund in the worst
possible way: `validatePolicy` checked a **hand-written list** of fields, so a
stored policy older than the new field passed validation, `undefined` flowed into
the gate's limit, and the CLI printed *"sell-through 94% vs a **NaN%** minimum"*
— refusing a purchase that should have passed.

It failed **closed by luck**. `94 >= NaN` is false; the comparison could as
easily have been written the other way and failed open, approving everything.

`validatePolicy` is now **exhaustive by construction**: it iterates
`Object.keys(DEFAULT_BOOTSTRAP_POLICY)` and requires every one to be present and
finite, so adding a field to `ModePolicy` makes it required automatically and the
validator cannot fall behind the type again. A test drops **each** field in turn
and asserts every one throws.

⚠️ **This is the fourth variant of "stored config drifts from code" in two days**
— after `policy adopt-defaults`, `tax profile set`, and the tax-tables year. The
first three were repair paths depending on the broken thing; this one was a check
that silently did not check. Same root: **a stored value and a code definition
that can disagree, with nothing forcing them to be compared.**

### D-25. The local rate, and why it has to say where it came from

Jason named his county; the rate went into `data/resale.db` and nowhere else.

It is one of the cheaper ones — not the 3.20% top rate
assumed on 2026-09-08. Combined with the 4.75% state marginal the rate is
**740 bps**, down from 795. The earlier assumption was over-reserving by 55 bps,
which is $5.11 per $1,000 of profit.

⚠️ **Both rates were recalled, not looked up.** There is no source to check
against from here. They need verifying against the Maryland Comptroller's
published local rate table before they are trusted — the same standing as the
federal tables, and said in the same place.

**Which is why a bare rate is no longer allowed.** `TaxProfile.stateRateBasis`
is now **required whenever `stateIncomeTaxBps > 0`**, and `validateTaxProfile`
throws without it. `740` in a config row is unexplainable in six months and a
wrong one is invisible; the number now carries its own derivation and its own
confidence. Zero needs no basis, because zero explains itself.

Recorded, in the database: the state marginal, the county rate, and *"rates
recalled 2026-09-08, NOT checked against the Comptroller's table"*.

**Where the reserve lands now** (an illustrative filer and county):

| | |
|---|---|
| $13.08 flip (year under $400) | **$3.27** — federal $2.30 + state $0.97 |
| $1,000 of profit | **$373.63** — 37.36%: SE $141.29 + federal $163.57 + state $68.77 |

**The stale-profile guard fired for the third time**, and worked: adding the
required field made the stored profile unreadable, `taxProfileOrDefault()`
degraded it to unconfigured, and `tax profile set` replaced it without needing
to read it first. The class stayed fixed. **B24 closed.**

### D-24. Owner acceptance of the tax tables, kept separate from verification

Jason: *"Accept defaults as adequate."*

The temptation was to flip `verified: true` and stop the nagging. That would
have destroyed the only fact worth keeping: **nobody has checked these numbers
against an IRS release.**

So there are now two records instead of one. `verified` still means *checked*,
and is still false. A `TaxTablesAcceptance` — stored in `config`, not in the code
tables — means *the owner judged them adequate for a reserve*. Accepting quiets
the two warnings down to one informational line, and that line still ends
**"Not IRS-verified."**

**The acceptance expires.** It is scoped to a `(tablesYear, transactionYear)`
pair, so accepting 2025 tables for 2026 does nothing for 2027; the warnings come
back at the year boundary, which is exactly when someone should look again. Two
tests cover that, and one asserts acceptance changes no number the reserve
depends on — it is bookkeeping about trust, not an input to the maths.

A malformed acceptance record degrades to *no acceptance*, restoring the
warnings rather than silencing them. Failing loud is the safe direction for
anything whose job is to tell you something is unchecked.

Recorded: **2025 tables, adequate for 2026, the owner, 2026-09-08** — "revisit
with 2026 figures". **D8 closed** on those terms.

New command: `tax tables [show|accept]`.

### D-23. The cliff owes more than the sale that crosses it, and the reserve was dropping the difference

Found by a test that would not go green, and it was the test that was right.

The reserve was `annualTax(after) - annualTax(before)`, capped at the sale's own
profit. At the $400 self-employment cliff that cap bites: crossing on **$18.43**
of profit makes **$61.20** of SE tax owed at once, so $42.84 was capped away and
never reserved. The fund would have been permanently short by that amount, and
nothing would have said so.

The reserve is now a **catch-up against the year**:

```
owedSoFar = businessTaxForYear(ytdIncome + thisProfit)
reserve   = clamp(owedSoFar - alreadyReservedThisYear, 0, thisProfit)
```

The shortfall is carried rather than dropped, and `carriedForwardCents` reports
what is still outstanding — the CLI prints it on the sale.

**Measured, not asserted.** Across 30 flips: the gap opens at $40.80 on the
crossing flip, shrinks monotonically, and reaches exactly **$0.00** four flips
later. The test checks all three properties, not just the endpoint.

### D-22b. `tax show` was reporting the owner's whole tax bill

Caught by running it. It printed `annualTax(ytdIncome)`, which includes tax on
the operator's salary — so an empty fund reported a five-figure shortfall. It now
reports `businessTaxForYear()`, the tax attributable to the business alone. On
three real flips: $39.24 of income, $10.03 owed, $10.03 reserved, no shortfall.

### D-21. Maryland, and a state base that was quietly wrong

Jason: *"MD and everything else seems fine."*

Maryland is **4.75% state plus a county tax of 2.25–3.20%**, so the rate went in
at **795 bps** (4.75 + 3.20, the top county rate — over-reserving is the safe
direction, and **B24** tracks pinning down the actual county).

⚠️ **Setting it surfaced a real under-reserve.** The state rate was being applied
to *federal taxable income*, which has the Section 199A QBI deduction subtracted.
Most states — Maryland included — start from federal **adjusted gross** income
and do not allow QBI. So the state base is now `taxable + qbiDeduction` unless
`stateAllowsQbiDeduction` says otherwise.

Worth **$14.77 per $1,000** of profit at Maryland's rate. Small per flip, and it
compounds across a year of them. A test asserts the exact difference.

`stateIncomeTaxBps` is documented as a **combined state + local marginal** rate,
because in Maryland, Ohio, Pennsylvania, Indiana and New York City the income is
exposed to both. The full state bracket walk is not modelled (**B25**) — at this
size the marginal rate does not move.

**Where the reserve now lands, on an illustrative profile:**

| | |
|---|---|
| $13.08 flip (year under $400) | **$3.34** — 25.54%: federal $2.30 + state $1.04, no SE tax |
| $1,000 of profit | **$378.74** — 37.87%: SE $141.29 + federal $163.57 + state $73.88 |

### D-22. The repair path broke the same way twice

`tax profile set` threw before it could set anything, because adding the required
`stateAllowsQbiDeduction` field made the stored profile invalid — and the command
read-and-validated it first.

**This is the identical bug I fixed for `policy adopt-defaults` three commits
ago.** I fixed the instance and not the class, and it recurred within the hour.

Now: `taxProfileOrDefault()` degrades a broken stored profile to *unconfigured*
(which makes income tax abstain — the safe direction) instead of throwing;
`state()` uses it, so a stale profile cannot take the whole fund down; and a
`TaxProfileError` at the top level prints the fix rather than a stack.

Three tests gate the class, not the instance. The rule is in `CLAUDE.md`: **a
repair path must not depend on the broken thing**, and adding a required field to
any stored config makes every existing row invalid, including for the repair.

### D-20. The tax reserve is now incremental annual tax, not a rate

Jason: *"I want the tax reserve to be correct."*

**The structural problem with everything before this:** tax is annual and
non-linear, and the reserve was a percentage of a single sale. The $400
self-employment threshold is a cliff, the Social Security wage base is a
ceiling, and income-tax brackets are steps. A flat rate is wrong on both sides
of every one of them.

So the reserve became the difference a sale makes to the year:

```
reserve = annualTax(ytdBusinessIncome + thisProfit) - annualTax(ytdBusinessIncome)
```

Correct across every cliff, ceiling and step by construction, self-correcting as
the year fills in, and needing no special cases. `src/core/tax/annual.ts` is the
model; `src/core/capital/tax.ts` became a thin adapter.

**What is now modelled** that was not: the $400 SE threshold · the Social
Security wage base, net of W-2 wages · Medicare and the 0.9% surtax ·
progressive federal brackets by filing status · the standard/itemised deduction ·
the Section 199A QBI deduction · a flat state rate · the half-SE deduction, in
the right place.

**Two things this made visible, both correct and both surprising:**

1. **Below $400 of net SE earnings the reserve is zero.** The old model reserved
   14.13% on tax that is not owed. The sale that crosses the line then carries
   the whole cliff: at $400 of prior income a $100 profit reserves **$70.65**.
   That is left visible rather than smoothed, because smoothing under-reserves.
2. ⚡ **A high W-2 earner reserves LESS, not more.** At $200k of wages the Social
   Security base is already consumed, so the 12.4% half does not apply to
   business income at all — while the income-tax bracket is far higher. The two
   move in opposite directions and the net is lower. **I asserted the opposite
   in a test, and the model was right.** The test now asserts the mechanism.

**Income tax abstains rather than guesses.** It needs filing status, other
household income and a state rate — facts about the owner that no ledger can
derive. Until a `TaxProfile` is set, `incomeTaxEstimated` is false and every
consumer surfaces that. A confident wrong number is worse than an honest gap.

**Year-to-date is derived twice, never cached.** `FundState` gained `taxYear`,
`ytdNetBusinessIncomeCents` and `ytdTaxReservedCents`, which reset when a command
lands in a new calendar year. The store derives them in one ordered pass over the
ledger; `replay()` derives them by re-running the engine; `reconcile()` now
compares all three. The reserve is built on that number, so it gets the same
two-derivation control as the balances.

⚠️ **The tax tables are unverified.** `src/core/tax/tables.ts` carries 2025
federal figures with `verified: false`, and `taxTableWarnings()` reports both
that and any year mismatch on every `tax show`. They are data in one file
specifically so they are checkable and correctable.

⚠️ **A charge-off is not deducted from business income** — for a cash-basis
reseller the cost of unsold goods is not deductible until disposal, and
over-reserving is the safe direction.

**B21 is closed by this** (the reserve no longer over-reserves below $400) and
**B15 is closed** (the wage base is modelled).

New commands: `tax show` (the year, the reserve, and any shortfall between them),
`tax profile show|set`, and `tax pay` (was `tax --amount=`).

### D-18. Below $100 of bankroll, no profit is set aside

Jason: *"Let's not have a profit floor below 100. It's not enough to be
meaningful."* — clarified to: *"I meant to not set aside profit when the
bankroll is below 100."*

⚠️ **I read that wrong the first time** and raised `minExpectedProfitCents` — the
per-flip profit minimum — to $100, which is a different number entirely and
collided head-on with the $50 bankroll. That change is reverted; the floor is
back to $8 / $15. The lesson is in `CLAUDE.md`: "profit floor" was ambiguous
between *per-flip profit* and *bankroll below which profit is retained*, and I
should have asked rather than picked the reading that produced a bigger change.

The actual decision: `allocation.setAsideMinNavCents = 10000`. Below $100 of NAV
the owner distribution and the operating reserve are both **skipped**, and the
entire after-tax profit compounds. A 20% cut of a $25 profit is $5, and at a $50
bankroll taking it out is the difference between compounding and crawling.

**The tax reserve still accrues below the threshold**, because tax is an
obligation rather than a distribution. That is a judgement call, not an
instruction — arguably it should be suspended too, since below $400 of annual net
SE earnings no SE tax is owed. Under-reserving is the dangerous direction and an
unneeded reserve is simply released later, so it accrues. Flagged as **B21**.

**The threshold is tested against NAV *after* the sale is recognised**, so the
flip that crosses $100 is the first one to pay out. Tested at $99.99 and $101.00.

⚠️ **This revises the original brief**, which said the owner receives profit from
every profitable transaction from the beginning. What survives is the part that
mattered — *"do not design an early phase where 100% of profit is
**permanently** retained"* — and `validatePolicy` now enforces it: the threshold
must sit below the GROWTH line, so the warm-up cannot become a phase. A test
asserts a $500 threshold is rejected.

**Planted:** setting the threshold to 0 turns 5 tests red; restoring it returns
all 154 to green. One test runs four flips under both settings and asserts the
warm-up fund ends larger — the claim is measured, not asserted.

### D-18b. The reachability module survived the misreading, and is worth keeping

Built to diagnose the collision my misreading created, it earns its place
anyway: a profit floor and a per-item cap multiply into a constraint neither one
states, and nothing else in the system would notice. Its tests now pass floors
explicitly rather than depending on a default, so they do not move when policy
does.
`src/core/capital/reachability.ts` reports the required multiple and answers the
inverse — the bankroll a floor implies:

```
landed   = (floor + fixedCosts) / (multiple * (1 - feeRate) - 1)
bankroll = landed / maxCapitalPerItemBps
```

**A $100 floor implies ~$165 of bankroll at a 3x flip, or ~$359.70 at 2x.** It
returns `null` when `multiple * (1 - feeRate) <= 1`, because below the fee rate
every item loses ground on its own and no amount of scale rescues it — a
reassuring large number there would have been a lie.

At the shipped $8 floor a $50 fund needs a 1.95x, which is reachable — so
nothing is blocked. `status` prints the warning only when a floor has stopped
fitting its bankroll. The tests **check** the claim instead of asserting it: they
buy at the implied landed cost, sell at the multiple, and confirm the profit
really clears the floor, at four different multiples.

### D-19. Policy lives in the database, and the live fund did not get the change

Caught by looking at the artifact instead of trusting the code: after setting the
floor to $100 and seeing 139 tests pass, `status` on the real fund still said
**$8**. `store.policy()` reads the `config` table, and `ensureSeeded()` only
writes defaults when the row is absent — so every policy edit in code is inert
for a fund that already exists.

This would have been a silent, expensive divergence: the tests and the running
business disagreeing about the rules, with nothing pointing at it.

Added `policy show` (which warns when the stored version differs from the code's
version), `policy adopt-defaults`, and `policy set --min-profit= / --income-tax-bps=`
which routes through `validatePolicy` so a bad edit throws rather than lands.
The live fund was migrated `2026-09-08.2` -> `2026-09-08.3`.

The version string on `Policy` stopped being decoration the moment it was the
only thing that could detect this.

### D-17. Gross is not net, and the CLI was treating them as the same thing

Found by probing a realistic first purchase against the live $50 fund before
handing it over. `buy --price=15 --resale=32` **passed every gate**. It should
not have: `--resale` was being read as net proceeds, so the assessment saw
$17.00 of profit where the real figure is $7.01 — below the $8 floor.

At bootstrap prices the gap between gross and net is about a third of the sale,
so this was not a rounding concern; it was the difference between a gate that
works and a gate that waves purchases through.

`src/core/fees.ts` now models it: 13.25% of the total sale (buyer-paid shipping
included, because eBay charges on that too) plus $0.40 per order, plus postage
and packaging. `estimateNetProceeds()` runs before any gate sees a profit
figure, and the CLI prints the derivation so the number is never a black box.
`grossNeededForNet()` is the inverse, and it answers the question the operator
actually has standing in a shop.

Unknown marketplaces default to the **eBay** model rather than to zero fees —
defaulting to "free" is the dangerous direction.

The same purchase now fails with `PROFIT_BELOW_MIN` and `DOWNSIDE_TOO_LARGE`,
and `headroom` reports the actionable number: *a $20 item has to sell for
$38.91 gross to clear the $8 minimum.* That is a **95% markup on every flip**,
which is the honest shape of a $50 bankroll on eBay and is exactly the pressure
risk R2 describes.

This was Gate 2's sub-step 2.1 arriving early. It was folded in rather than
deferred because the fund went live the same sitting, and a tool that approves
unprofitable purchases is worse than no tool.

### The control that would catch a lossy writer

`FundStore.state()` sums the postings table and reads the items table.
`replay()` ignores both and re-runs every stored command through the engine from
an empty fund. `reconcile()` compares them. These are two genuinely different
code paths, not a round trip through one encoder — a writer that silently
dropped a field would show up as a balance difference.

**It was planted, not assumed.** `tests/persistence.test.ts` corrupts a stored
sale payload (zeroing `marketplaceFeeCents`) and asserts `reconcile()` reports
the mismatch. The hash chain is planted twice more: an edited event row, and a
tampered posting amount. All three are caught, and the clean case verifies OK
first so the plants are not passing vacuously.

### Verified by hand as well as by suite

A real $75 run through the CLI: contribute $75 → the $45/45-day bag rejected with
three named reasons → a $12 pin bought (6-day hold) → sold at $32 gross less
$9.57 of fees and postage → profit $10.43, split $2.61 tax / $1.57 owner / $0.78
operating / $5.47 reinvested → NAV $80.47, `verify` reports hash chain OK and
replay OK.

The owner was paid on the first flip. That is the requirement, demonstrated
rather than asserted.

### Surfaced during implementation, filed rather than built

Went to the backlog in the same edit: the override-flag gap (**B9**), the ledger
verifier script (**B1**), the import-direction lint (**B2**), the rejection-code
histogram (**B3**), and the `node:sqlite` experimental-warning noise (**B12**).
None of them met the queue-admission bar; all of them would have been lost.

---

## Gate exit criteria

| Gate | Exit |
|---|---|
| **1** ✅ | A $75 fund records every event type; balances explainable to the cent; identity holds after every event; two independent derivations agree; suite green. |
| **2** | A hand-entered opportunity yields Buy Score, Risk Score, confidence, max price and a recommendation with reasons — and the suite proves a slow item cannot score high in Bootstrap. |
| **3** | Full inventory lifecycle including markdown, capital recovery, charge-off and passive recovery; business + transaction expenses; reserves and distributions; item profit vs operating profit vs owner-distributable profit all reconcile. |
| **4** | The dashboard runs on a phone, shows every Phase-1 metric, and the config UI can change policy without a deploy. Rejection-code histogram included. |
| **5** | Manual/CSV ingestion works end to end; eBay adapter behind a credential check; the ranked feed shows only what deserves attention, with filters. |
| **6** | Scarcity / demand / momentum / market-opportunity scores with confidence; radar buckets; watch-only markets surface an unlock readiness figure without the operator enabling anything by hand. |

---

## 2026-09-08 (Gate 4 opens) — 4.1: B33, and a control that could not fail

### Switch-in: the plan was a hypothesis, and three premises had moved

Gate 4 was decomposed before any of it existed. Verified against the code first:

- **B33 was a hard blocker, and `reporting.ts` said so in its own comment** —
  *"Do not report either number on the dashboard until that is resolved."* Both
  the metrics screen and the profit screen render numbers that come through
  `profitReport()`. B33 was promoted from the backlog to sub-step **4.1**, ahead
  of the scaffold.
- **D4 is mis-marked "needed before Gate 4."** Nothing in 4.1–4.10 touches a
  constraint override; it is something you do when *acting* on a recommendation,
  which is Gate 5. Flagged, not edited — it is Jason's row.
- **The decomposition had no screen with a user standing anywhere.** 4.3–4.7 all
  render the past. The reason to want this on a phone is standing in a thrift
  aisle holding something, and `evaluate` + `max-price` + `constraints` already
  answer that as pure functions. Jason agreed to fold it in as **4.4**.

`A4` in 4.9 checked out — it means `ASSUMPTIONS_AND_RISKS.md`'s A4 (one operator,
local gate), not `ARCHITECTURE.md`'s A4 (postings balance). Two docs, same label;
the plan now says which.

### D-30. B33: the reversal has to declare what it reverses

Business expenses are recorded twice — in the ledger, and in the analytic
`expenses` table that operating profit and the category breakdown read from. An
`ADJUSTMENT` moved only the ledger. Found by hand at button-up: the ledger came
back to $50.00 while `profit --expenses` still reported $1.50 of SUPPLIES.

Two options were on the table. **Deriving operating profit from postings** would
have fixed the top line and left the breakdown wrong, because an adjustment
carries no category. **Linking the reversal to what it reverses** fixes both, and
the `expenses` table already had an `event_id` column to build on. Jason picked
the link.

- `AdjustmentCommand.reversesEventId` — optional. It requires `account: 'LIQUID'`
  and a positive amount, because undoing an expense has exactly one shape: cash
  comes back. Any other account or sign is a different correction wearing a
  reversal's label.
- Migration `004` adds `expenses.reverses_event_id`. Nothing is deleted or
  edited: the reversal is a **negative row**, so both the mistake and the
  correction stay visible, exactly like the ledger it mirrors.
- The store refuses to reverse more than is outstanding, and outstanding is
  `SUM(amount_cents)` over the original row plus every compensating one — so
  partial reversals compose and over-reversal cannot invent income.
- Existence and type checks live in the **store**, not the engine. `FundState`
  carries balances and items, not an event registry, so a pure reducer has no
  way to know whether an event id is real. They run before `applyCommand`, so a
  bad reversal never reaches a write.
- **The reversal restores the year's net business income.** The expense deducted
  it; leaving it deducted means the tax reserve keeps reserving against money
  that was never spent. This had to be mirrored in both the engine and the
  store's independent derivation.

`expenseReversalDrift()` is the control, and `verify` now prints a third line
alongside the hash chain and the replay. Its two sides are genuinely different:
the ledger side reads `LIQUID` postings and ADJUSTMENT payloads, the table side
reads `expenses`, and neither is computed from the other.

⚠️ **It cannot see a reversal that does not declare itself** — an undeclared
adjustment is indistinguishable from an ordinary cash correction, which is the
whole reason the declaration exists. That is why the live residue is a decision
(**D9**) and not a bug.

### D-31. `reconcile` was comparing the engine to itself

Planting found this, and nothing else would have.

`commit()` caches the **engine's** next state — a sound optimisation, since
re-deriving from the whole ledger after every write is O(events) per command.
`reconcile()` read `state()`. So after any commit, the "postings scan" side of
the comparison *was the engine's own output*, and the control that exists to
catch a lossy write path could not catch one.

**Measured, not argued:** a $123.45 corruption planted in `#deriveTemporal`
passed all 48 tests that touch it — `reconcile`'s own dropped-field plant
included. That plant only ever worked because it corrupts the *replay* side,
where a warm cache does not hide it.

Fix: `FundStore.derivedState()` is the cache-bypassing load, and `reconcile()`
reads it and never `state()`. Every other `state()` caller is an ordinary read
or a fresh process, so nothing else was affected.

This is the fifth instance of the failure class this project keeps meeting: **a
check whose two sides come from one source cannot fail, and reading it never
reveals that — only planting does.**

### On the plant that was wrong

The first version of the new test inserted a single unbalanced posting, and the
test failed with `INV_IDENTITY` instead of a reconciliation difference. The
*plant* was wrong, not the check — an unbalanced pair is caught by a different
control before the comparison is ever reached. The plant is now balanced
(`LIQUID +12345`, `RETAINED_EARNINGS -12345`), which is the corruption shape that
actually survives to the thing under test.

### Verification

Every new control was planted against, verified red, restored, verified green:

| plant | what went red |
|---|---|
| drop the compensating expense row | 6 tests |
| engine skips the business-income restore | the tax-base test |
| `reconcile` back on the write cache | the cold-derivation test |
| balanced corruption in the postings table | the drift + reconcile controls |
| corrupt the expenses table directly | the drift control, both directions |

`npm run check`: four gates, **308 tests** (was 294).

### What did not get fixed, and why

The live book still reports -$1.50 of operating profit. `evt_000004` returned
the cash before the mechanism existed, so it declares nothing, and a second cash
adjustment would double-count the $1.50. Clearing the analytic record alone needs
a correction with no cash effect — a real capability the system does not have.
It is **D9**, because it is Jason's ledger.

---

## 2026-09-08 (D9) — a correction that moves no money

### D-32. The books and the money can be wrong independently

D9 asked how to clear $1.50 of smoke-test SUPPLIES from the live book. The cash
had already come back through `evt_000004`, recorded before `reversesEventId`
existed, so it declares nothing. A second cash adjustment would double-count it,
and hand-editing the `expenses` table is the thing the hash chain exists to make
impossible.

The gap was real and general, not a one-off: **there was no way to correct the
analytic record when the ledger was already right.** A miscategorised expense
(SUPPLIES that was really POSTAGE) has exactly the same shape and will recur.

`EXPENSE_CORRECTION` is that event. It writes **no postings** — nothing happened
to the money — and comes in exactly two shapes:

- **reclassify** (`reclassifyTo`) — one negative row in the old category, one
  positive in the new. The total is untouched; only the breakdown moves.
- **settle** (`settledByEventId`) — one negative row, naming the event that
  already returned the cash. The expense leaves the record and the year's net
  business income is restored.

Requiring *exactly one* of them is the load-bearing rule. A correction with
neither would silently drop an expense the ledger still says was paid — which is
B33's drift, walked straight back in through its own repair path.

**Settling is checked hardest, because nothing in the ledger will contradict it
afterwards.** The named event must actually have returned cash; it cannot be the
expense itself; and `#claimedAgainst` refuses to let two settlements spend the
same returned dollar. Without that last one, $6.00 of expense could vanish
against $3.00 of returned cash.

### D-33. Widening a CHECK constraint, on a live ledger

A new event type meant `ledger_events.type`'s CHECK had to change, and SQLite
cannot alter one in place — the table must be rebuilt. Rebuilding a table that
`ledger_postings` and `expenses` both reference needs foreign keys off, and
`PRAGMA foreign_keys` is ignored inside a transaction.

**Probed on a throwaway copy of the live database before writing anything.**
`PRAGMA defer_foreign_keys` — the option that would have needed no runner change
— does **not** survive the `DROP TABLE`; it fails with a foreign key violation.
Only `foreign_keys = OFF` outside the transaction works.

So `migrate()` gained a `-- self-managed` marker: such a file runs outside the
runner's transaction and owns its own. It is recorded only after its transaction
commits, which is why it is written to be **safe to re-run** — a crash in that
gap is recovered by running it again, and a test asserts exactly that.

⚠️ **The reuse of ADJUSTMENT was considered and rejected.** Mapping
`EXPENSE_CORRECTION` onto the existing type (as `SET_ITEM_STATE` maps to
`ITEM_STATE_CHANGE`) needed no migration at all. But the CHECK exists precisely
to stop an unknown type landing, and routing around it would leave the control
guarding a list that no longer describes reality — while `ledger` printed
"ADJUSTMENT" for something that adjusts nothing. Gates 5–7 add more event types;
better to build the capability once, now, against a four-event book with a
verified backup.

### The control from 4.1 caught the very next bug

The engine restored business income on a settlement and the store's independent
derivation did not. `reconcile()` failed with
`ytd business income: stored -150 vs replayed 0` — which it could only do
because 4.1 had just stopped it reading the write cache. One item earlier, that
same mistake would have passed silently.

### Verification

Planted, red, restored, green — 324 tests:

| plant | what went red |
|---|---|
| drop the settlement double-claim guard | the same-dollar-twice test |
| store derivation forgets corrections | the settle test, via `reconcile` |
| drift control forgets settlements | 2 settle tests |
| migration loses its `-- self-managed` marker | all 3 migration tests |

⚠️ **The marker plant did not apply on the first attempt** — the string appears
twice in the file (the marker and a mention in its own comment), and the guard
caught it. The three passes that run reported were meaningless. Diagnosing the
plant before trusting the result is the rule that saved it.

Migration 005 has its own test that runs 001–004, writes real events, *then*
migrates — because every other test migrates a fresh database all at once, so
the only scenario that matters had no coverage. It asserts the hash chain is
byte-identical afterwards, the foreign keys are clean, and reconcile still passes.

### The live book

Backed up, migrated, corrected, verified. `evt_000005` and `evt_000006` settle
$1.00 and $0.50 against `evt_000004`.

```
business expenses  $0.00      (was -$1.50)
operating profit   $0.00      (was -$1.50)
YTD business income $0.00     (was -$1.50)
hash chain OK · replay OK · expenses OK
```

Three wrong numbers, not one — the tax base was drifting too, and only checking
`tax show` during the before-scan surfaced it.

### After-scan

Folded in, because both are operator-facing and Gate 4 is about exactly that:

- **A refused command printed a raw stack trace.** Pre-existing and not specific
  to corrections — every `EngineError` did it, including a payout exceeding
  payable. A refusal is a normal outcome and now reads as one; an
  `InvariantViolation` is separated out, because that one *is* a bug and says so.
- **A no-posting event printed as a bare line** in `ledger`, with no way to see
  what it did. It now renders its payload.

Filed, not built: **B36** (the CLI has no tests at all — the stack-trace bug
shipped because nothing opens it, and Gate 4 adds a second interface over the
same functions) and **B37** (`#claimedAgainst` is a linear scan).

---

## 2026-09-08 (4.2) — the dashboard scaffold, and one seam

### D-34. The "read-only API" is function calls, not HTTP

4.2 was written as "the read-only API over the existing pure functions." Built
as an HTTP API that would have meant serialising view objects, re-parsing them
in the browser, and standing up an unauthenticated surface over a live financial
ledger *before* the auth gate (4.9) exists.

App Router server components call `src/server/views.ts` **directly**. No fetch
hop, no second representation, nothing listening that should not be. HTTP routes
go in only where a client component genuinely needs one, which is 4.4's sourcing
screen and nothing before it.

### D-35. The seam, and the lint that makes it real

`src/server/views.ts` assembles plain objects out of what `src/core` already
computed. It does no arithmetic on money — even formatting goes through
`formatCents`, because a hand-rolled formatter is how `-$0.00` appears on a
dashboard and nowhere else.

Saying "no new financial logic" in a comment is worth very little. `npm run
lint:imports` now enforces it: **`src/app` may not import `src/db`, `src/cli`,
or `node:sqlite`.** A screen that wants a number gets it from the view layer or
it does not get it.

It caught its author within a minute — I put the store-opening helper in
`src/app/store.ts`, and the lint refused it. It belongs in `src/server`, where
the database is allowed. Planted both directions afterwards (a `src/db` import
and a `node:sqlite` import in a `.tsx`), and both fail.

⚠️ The walker only looked at `.ts`. The app is `.tsx`, so the whole new layer
would have been invisible to every rule in the file — a lint that passes because
it read nothing.

### D-36. Two tsconfigs, because one would have to lie

The root config is node-only on purpose: no DOM, no JSX, because `src/core` and
`src/db` must never compile against a browser lib. Next needs both.

`tsconfig.web.json` is the web half, and **`npm run typecheck` runs both** — a
half that is not typechecked reports green while it rots. Verified by planting a
type error in `page.tsx` and watching the web pass go red; an empty `include`
would have printed exactly the same silence as a clean run.

⛔ **Next rewrote the root tsconfig on the first build** — adding `jsx`,
`allowJs` and its own plugin, undoing the split. `typescript.tsconfigPath` points
it at the web config instead. It also appends a block to `CLAUDE.md` on every
`next dev`; `agentRules: false` stops it. A build tool does not get to write to
this project's start-here document.

### D-37. Turbopack cannot resolve this repo

Measured, after the build failed: Turbopack does **not** honour
`extensionAlias`, so it cannot resolve the repo's `./x.js`-for-`x.ts` imports
and 500s on every page. webpack does. Both `dev` and `build` pass `--webpack`.

The alternative was rewriting the extension off every import across the
financial core to suit a dashboard — a lot of churn in files that have nothing
to do with the dashboard, in exchange for a faster bundler. Backlog **B38**.

### D-38. B36: the CLI had never been opened by a test

Twelve hundred lines routing every command, zero coverage. That is *why* the
raw-stack-trace bug shipped in the previous item.

`tests/cli.test.ts` spawns the real process against a throwaway ledger, because
exit codes and what reaches stderr only exist at the process boundary. Eight
cases, including the regression: a refused command must say `refused:`, exit 1,
and print no stack. Planted by removing the `EngineError` handler — two tests go
red.

⚠️ **The per-test timeout was applied wrong at first.** A regex put it *outside*
the call — `}), CLI_TIMEOUT)` parses as a comma expression, so `it()` still ran
with the 5-second default and the change did nothing. Caught by setting the
constant to `1` and confirming the tests actually time out. A mechanical edit
that looks applied and is not is the recurring shape of this class.

### The environment cost an hour

This machine cannot download a large npm tarball in one shot: anything over
~20 MB dies partway, and **npm retries by restarting rather than resuming**.
`next` (41 MB) and `@next/swc-win32-x64-msvc` (34 MB) both failed repeatedly.

The payload does arrive — it is the TLS teardown that breaks. Measured that
`--http1.1` and `--tlsv1.2` truncate too, at different offsets each time, so it
is not a protocol setting. The workaround, written up in CLAUDE.md: resume-loop
with `curl -C -` until `gzip -t` passes, then `npm cache add` the file so the
content-addressed cache satisfies the integrity check. Same class as the
rolldown binding that pins Vitest to 3.x — **two independent native packages
now**, so assume the next big dependency needs it.

### Verified

`npm run check`: four gates, both halves, **341 tests** (was 324). The page was
fetched from a real dev server and cross-checked against `status`: NAV $50.00,
deployable $42.50, BOOTSTRAP, set-aside off until $100 — identical. Dev server
identified by PID and terminated; port 3737 confirmed clear.

---

## 2026-09-08 (4.3) — the primary screen, and the thing I cannot check

### D-39. The dashboard was on the LAN with no auth

`next dev` binds `0.0.0.0`. The startup banner had been printing
`Network: http://192.168.4.49:3737` since 4.2 and I read past it twice.

So the fund's complete financial position — NAV, reserves, tax base, every
category exposure — was served to anything on the network, and the auth gate is
**4.9**, six items away. `dev` and `start` now pass `--hostname 127.0.0.1`.

⚠️ This has a consequence for sequencing. The reason to build a phone dashboard
is to read it *on a phone*, which needs LAN access, which needs auth. **4.9 may
need to move ahead of 4.4**, because the sourcing screen is the one that is
useless on a laptop. Not moved yet — that is Jason's call on the queue.

### D-40. The screen's decisions are data, because the screen is not testable

There is no browser here, and the thing that actually matters about this screen
— whether it is legible one-handed at arm's length in a shop — is a human
judgement regardless.

So the *decisions* moved out of the component into `src/server/screens.ts`:
which rows, in what order, which warnings fire, and how loud. Those are ordinary
functions with ordinary tests. `page.tsx` is now typography and nothing else; it
makes no judgement a test could be wrong about.

What that buys, concretely, is the ability to assert things like *an
unverifiable ledger is the only thing allowed to be an alarm* and *the exposure
table is omitted entirely when empty, because an empty table is noise on a
phone*. Planted three ways — swapping the lead section, demoting the integrity
alarm, forcing the exposure table on — and each fails.

⛔ **What it does not buy: styling.** If a row is unreadable, nothing here would
know. That is **B39**, and it is honest rather than solved.

### D-41. Deployable leads, not NAV

The operator is standing in a shop holding an object. The question is *what can
I spend on this*, not *what is the fund worth*. NAV first would be accurate and
useless, so the first section is "Can spend now" — deployable, max per item, max
hold, min profit — and the bankroll breakdown sits beneath it as context.

The rows 4.2's proof page had dropped are back: liquid floor, the earmark
breakdown (tax reserve, operating reserve, owner payable, labelled *Spoken for*
because "inside NAV but not yours" is the thing that needs saying), active-item
count, and category exposure against its cap.

### Two fixtures that were wrong before the code was

Both surfaced by tests failing, and in both cases the test was wrong:

- A $500 fixture is **GROWTH**, not BOOTSTRAP. The assertion hardcoded a mode
  the fixture did not have.
- **A $50 fund with an $8 floor is reachable** — 1.4x a flip. The first version
  of that test asserted a warning that correctly is not there. Constructing a
  genuinely unreachable fund needs a $100 floor, which is the collision this
  fund actually hit on 2026-09-08. Both cases are now tested: quiet at the live
  configuration, notice when the floor really is out of reach.

⚠️ And the fixture that built the unreachable policy **type-checked while doing
nothing**: `Policy` nests mode settings under `modes`, and `{...DEFAULT_POLICY,
bootstrap: {...}}` adds a bogus top-level key. Spread syntax suppresses
excess-property checking, so `tsc` was silent. Only the test still failing
revealed it.

### Verified

`npm run check`: **356 tests** (was 341), four gates, both halves. Fetched from
a real dev server: the order is right, the numbers match `status`, the middot
separators are clean UTF-8 rather than mojibake, and the banners are correctly
absent on a healthy fund. Server terminated by PID; port confirmed clear.

⏳ **Not verified: how it looks.** Jason has the phone.

---

## 2026-09-08 (4.4) — the gate, and 47 cents I put in the ledger by accident

### The incident, first, because it is the most useful thing here

I planted `store.commit()` in `page.tsx` to prove the new `LedgerReader` type
rejected it. `tsc` rejected it, loudly, exactly as designed.

**A forgotten dev server on port 3000 was watching the filesystem.** It
recompiled the page and ran the commit **47 times against the live ledger in
eighteen seconds** — 47 × $0.01 `CONTRIBUTION` events with `occurredAt: 'x'`.
It surfaced because a positive control showed NAV as $50.47 instead of $50.00,
and an unexplained $0.47 in a real ledger is not something to move past.

Reversed with two `ADJUSTMENT`s — a `CONTRIBUTION` touches `LIQUID` and
`CONTRIBUTED_CAPITAL`, and an adjustment only ever pairs against retained
earnings, so one could not do it. Back to NAV $50.00, `LIQUID` $50.00,
`CONTRIBUTED_CAPITAL` −$50.00, `RETAINED_EARNINGS` $0.00, chain and replay OK.
**The 47 events and their reversal are in the ledger permanently**, which is
what append-only means and is the correct outcome.

Three things came out of it, and the third is a real control:

1. ⚠️ **Check every dev port, not the one you started.** I killed 3737 and
   never looked at 3000. That server had been alive since an earlier item.
2. ⚠️ **Never plant a side effect in a file a running server can execute.**
   Plant type errors, verify with `tsc`, restore — and start nothing until
   after.
3. ⛔ **A type is a compile-time promise only.** `withStore` now hands screens
   an object that *physically has no* `commit`, `setPolicy` or `db.run` on it.
   The same mistake now gets a `TypeError` rather than 47 events in a real
   financial record. Planted (handing back the full store) and it reds.

### D-42. The gate is on the data, not on the routes

The first version put auth in `middleware.ts`. Two things killed that.

`node:crypto` does not exist in the Edge runtime, so the module would not
build — and more importantly, **Next's own documentation says proxy "should not
be used as a full session management or authorization solution"** and
recommends the real check in the data layer.

That is the better design here anyway. A routing check is default-open in the
worst way: it protects the paths someone remembered to match, so every new
screen is a chance to forget. `withStore()` is the *only* door to the ledger, so
putting `requireSession()` there means a new screen is gated the moment it reads
anything, without its author knowing the gate exists. `src/proxy.ts` survives
only to redirect an expired session to a login form — appearance, not trust, and
it does no crypto at all.

⛔ **No loopback exemption, anywhere.** A tunnel terminates on this machine and
forwards to 127.0.0.1, so "skip auth for localhost" is in fact "skip auth for
everyone who came through the tunnel". Every request is checked whatever it
claims about its origin.

### D-43. No password means unreachable, not open

`scripts/check-binding.mjs` runs before `dev`/`start`/`serve` and refuses to
bind anything but loopback when `RESALE_PASSWORD` is unset, and refuses a
password under 12 characters. The failure being prevented is the ordinary one:
start a server to look at something, forget, leave a financial position on the
network. Exercised in all four states.

### D-44. A4 answered: Tailscale

Presented three transports. Jason chose the private mesh over a public
Cloudflare URL: the phone and PC join a tailnet, **no public endpoint exists at
all**, and the password becomes defence in depth rather than the only thing
between the internet and the fund. Works on cellular, which LAN-only does not —
and the aisle is the entire point.

⚠️ **Decided, not deployed.** Tailscale is not installed on either device;
that is **B42** and it needs a human. Until then the dashboard is
localhost-only. The session cookie sets `secure: false` because Tailscale serves
plain HTTP inside the mesh (**B43** if that ever changes).

### Verified

`npm run check`: **376 tests** (was 356), four gates, both halves. End to end
against a running server: unauthenticated `/` → 307 to `/login` with **zero**
money figures in the response; a forged cookie → 307 (the proxy passes it
through on presence alone, so this is the data-layer gate catching it, which is
the whole design); `/login` → 200; and a **valid minted session → 200 with the
real dashboard**, because a gate that blocks everything is indistinguishable
from a broken app.

One test was wrong before the code was: it used the reader after `withStore`
closed the ledger. Fixing it moved the assertions inside the callback, which
incidentally proves the store really does close.

---

## 2026-09-08 (4.5) — the aisle screen, and haggle vs walk away

### The before-scan found the work was already done

Every number this screen needs already existed. `evaluateOpportunity` returns
economics, confidence, buy and risk scores, the gate results, the recommendation
— and `price.boundBy`, whose own comment reads *"which limit actually binds — the
one to argue with."* So 4.5 was a presentation and input problem, exactly as the
plan claimed, and `src/server/sourcing.ts` computes nothing.

⛔ **No hold-time field on the form.** `expectedDaysToSale` is derived from comps
(`90 * (active + 1) / sold90`) and a typed estimate is capped at 30% confidence,
below every mode floor. A field for it would be a field that quietly cannot
clear a gate.

### D-45. Looking at it found what testing it could not

Nineteen tests passed and the model was right. Then I opened the running screen
and scored a real candidate: a $12 Lego, $60 resale, 40 sold against 10 listed —
**$34.30 expected profit at 286% ROI** — and it said *Walk away · Ceiling set by
the per-item cap.*

The verdict was correct. A 25-day hold exceeds BOOTSTRAP's 21-day ceiling, which
cascades into the long-hold allocation and drags the buy score to 30. But **the
explanation was about the wrong thing entirely.** The price ceiling is only the
right explanation when price is the problem, and here price was fine.

No model test would have caught it, because the model was not wrong.

### D-46. So ask the evaluator instead of guessing

The fix needed a real answer to "would this be a buy if it were cheap enough?",
and inferring that from which gates failed is a heuristic that breaks the first
time a gate cares about price indirectly.

`priceFixable` **re-runs the evaluator with the asking price set to the
ceiling.** If that comes back BUY, price is the whole problem and the screen
says *Too expensive — pay no more than $X*. If it still fails, the item is bad
at any price and the screen says *Walk away* and leads with the failing gate.

That distinction is most of the screen's value. One answer sends you to haggle;
the other sends you to put the thing down. Getting them confused wastes a
conversation with a seller over an item that was never going to work.

Verified on the live fund, three candidates:

| candidate | verdict | reason shown |
|---|---|---|
| $12 Lego, 25d hold | Walk away | expected 25d hold vs 21d ceiling in BOOTSTRAP |
| $30 fast-moving pin | Too expensive — pay no more than $20.00 | the per-item cap |
| nothing sold in 90 days | Walk away | expected 3650d hold vs 21d ceiling |

### The gate came for free

`/sourcing` returned `307 → /login?next=%2Fsourcing` without a line of auth in
it. That is 4.4's design paying off immediately: the check is on `withStore`,
the only door to the ledger, so a new screen is gated the moment it reads
anything and its author never has to know the gate exists.

### A plant that was wrong before the code was

The first float-cents plant — `Math.round(Number(x) * 100)` — passed all
seventeen tests, and **the plant was not a defect**: `Number('12.99') * 100` is
exactly 1299, so rounding is correct for well-formed input. The assertion was
the weak part. I enumerated the values where truncation actually diverges
(`0.29`, `0.57`, `1.13`, `2.01`, and 187 others under $200), put four of them in
the test, and re-planted `Math.floor` — which now reds with `expected 28 to be
29`.

⚠️ Worth keeping: an assertion built on a value that does not distinguish the
implementations is decoration. Diagnosing the plant before the check is what
found it.

### Verified

`npm run check`: **395 tests** (was 376), four gates, both halves. Three plants —
first-error-only validation, `overPriced` forced false, and `priceFixable`
inferred instead of measured — each red. All dev ports confirmed clear
afterwards, and the live ledger still verifies at $50.00.

---

## 2026-09-08 (4.6) — the tax tables were already done, in another app

### Jason: *"2026 tax work was already completed extensively by the set aside app"*

He was right, and resale-os was the one behind. The set-aside app is
**GigWorkTracker**, and `services/tax-engine` carries `taxYears/2026.ts` and
`stateTaxConfigs/mdLocalTax2026.ts` — sourced, not recalled:

- **IRS Rev. Proc. 2025-32** — 2026 brackets and standard deduction, including
  the One Big Beautiful Bill Act amendments
- **SSA 2026 COLA fact sheet** — Social Security wage base
- **Maryland statute** — 10 state brackets, 2%–6.5%
- **DLS / Comptroller "Local Tax Rates" + "Withholding Tax Facts, January 2026"**
  — the county piggyback rates

Measured against what resale-os was running:

| | resale-os (2025, unverified) | GigWorkTracker (2026, sourced) |
|---|---|---|
| SS wage base | $176,100 | **$184,500** |
| Standard deduction, single | $15,000 | **$16,100** |
| 10% bracket top | $11,925 | **$12,400** |
| 12% bracket top | $48,475 | **$50,400** |
| The operator's county | recalled | **confirmed** |

⚡ **The county rate agrees.** The number recalled from memory on 2026-09-08 was right,
and it is now confirmed against the official table — half of **B26** closed.
The other half, the flat 4.75% state rate, is better answered by **B25**
(Maryland's real brackets, which GigWorkTracker also has) than by a lookup.

### D-47. Copy the figures, not the engine

Three options went to Jason; he took the middle one. Depending on
`@gig-tax-tracker/tax-engine` would give one source of truth, but the two apps
model tax **differently** — GigWorkTracker estimates a full annual liability,
resale-os computes an *incremental* reserve per sale — and coupling them means
one release cadence, a publish step that does not exist, and a `core/` that
stops being dependency-free. Leaving it alone was the third option and the
weakest: over-reserving is safe, but `verified: false` would have stood.

### D-48. The literal was GENERATED, and then machine-verified

⛔ **Transcribing tax brackets by hand is how a typo becomes wrong money**, and a
mistyped bracket reads exactly like a correct one. So a script read
GigWorkTracker's config and emitted the resale-os literal — statuses renamed,
dollars to integer cents, rates to basis points, `max` to `upToCents`.

Then a second script compared the committed literal back against the source:
**65 figures, exact.** And the verifier was itself planted — a one-cent change
to the single standard deduction — and caught it. A checker that has never
failed is not a checker.

⚠️ **Second-hand verification is still verification, but only if it says so.**
`verifiedBy` names the IRS and SSA sources *and* the fact that the figures came
via GigWorkTracker's checked copy. Somebody read the Rev. Proc.; it was not this
project, and a reader deserves to know which.

### The impact is provenance, not money — measured, not assumed

`incrementalReserve` on the live profile
returns **identical figures under both tables up to $32,000 of annual business
profit**. At $40,000 they differ by $69. Below that his marginal bracket is 22%
either way, his W-2 is far under both wage bases, and the standard-deduction
change does not move him.

So this bought correctness and provenance, and changes no number the fund will
see for a long time. Worth saying plainly rather than implying the reserve was
wrong.

### Six tests failed, and all six were tests encoding 2025

Not regressions — assertions that had quietly become about the wrong thing:

- Two hardcoded 2025 figures as *fixtures*: W-2 wages of $17,600,000 chosen to
  leave "$100 of base" (true only while the base was $176,100), and a bracket
  edge of $1,192,500. Both now **derived from the table**, so they stay true in
  January.
- Four asserted behaviour about *unverified* tables using the default. Pointed
  at `TAX_TABLES_2025` explicitly, which is still unverified and is kept for
  replaying older events — because leaving them on the default would have meant
  they still passed while testing nothing.
- One of mine, from 4.2: `expect(v.warnings.length).toBeGreaterThan(0)`, true
  only because the tables were unverified. It now asserts the silence.

⚠️ **D8's acceptance and its warning fell away on their own.** Nothing had to be
un-done: the acceptance is scoped to `(tablesYear 2025, transactionYear 2026)`
and simply stopped matching. `tax show` no longer prints "Not IRS-verified".

### Verified

`npm run check`: **399 tests** (was 395), four gates, both halves. Live ledger
verifies, backed up, still $50.00.

---

## 2026-09-08 (4.7) — the feed, and not recomputing the past

### The before-scan found two things

**The ranking already existed.** `OpportunityRepository.list()` orders by buy
score down, risk up, days-to-sale up, and supports every filter `opp list` does.
The feed needed none of that written again.

⚠️ **But `LedgerReader` could not reach opportunities at all.** 4.4 deliberately
left `opportunities()` off the reader, because the repository can `save()` and
`setStatus()`. So the read-only guarantee, working exactly as intended, blocked
a legitimate read.

The fix keeps the guarantee: an `OpportunityReader` taking `ReadOnlyDb`, with
the queries themselves extracted to module-level functions that **both** classes
delegate to — one implementation of "which opportunities, in what order",
reachable two ways with different powers.

⚡ Also noticed: **`rejectionHistogram()` is already written**, which makes
**4.9** mostly a screen. Filed as **B49**.

### D-49. A stored verdict belongs to the policy that produced it

The tempting shortcut is to re-run today's scoring over the stored rows so the
feed is always "current". That would be wrong, and quietly: it would show a
score that was never the reason for any decision, and the operator would have no
way to tell.

So `feedView` **reports what was stored and never recomputes it.** When a row's
`policy_version` no longer matches the code's, it is marked **stale**, keeps its
original numbers, and says which policy produced them. Re-scoring stays a CLI
action, because it is a decision.

⚠️ **An unscored row is not stale.** `policy_version === null` means nobody ever
scored it — a different fact with a different fix, and conflating them would
send someone to re-score nothing. One of the three plants targets exactly that.

### D-50. Two kinds of empty

"Nothing has been scored yet" and "your filter matched nothing" are different
problems: one is fixed by going and scoring something, the other by changing the
filter. A single "no results" hides which, so the view reports `empty` and
`filteredToNothing` separately and the screen says the right sentence.

### Verified

`npm run check`: **408 tests** (was 399), four gates. Three plants — collapsing
the two empties, forcing `stale: false`, and counting an unscored row as stale —
each red.

Exercised against a running server on a throwaway ledger with three real
candidates: ranked pin 69 / lego 66 / vase 27, `?rec=BUY` filtered to two, and
`?min=200` produced the *filtered-to-nothing* sentence rather than the
*nothing-scored* one. `/feed` was gated by 4.4 without a line of auth in it.

Dev ports confirmed clear; the demo ledger deleted; the live fund untouched
at $50.00.

### Placement, at Jason's request

**B25** joined the queue as **4.8** — Maryland's 10 statutory brackets instead
of the flat 4.75%, now the same generate-and-machine-verify job 4.6 proved.
Placed there because that machinery is fresh, not because it is urgent.

**B47 and B48 are the same obligation** and became a new **Recurring** section
rather than queue items. ⚠️ A recurring duty with a checkbox gets ticked once
and then never fires again — the January tax-table review has to survive being
"done". Three stale cross-references elsewhere in the plan were repaired at the
same time, since renumbering is exactly what rots them.

---

## 2026-09-08 (4.8) — Maryland's real brackets

### D-51. The flat rate was not wrong, it was incomplete

Worth stating precisely, because "we were using a flat rate" sounds worse than
it was. resale-os reserves **incrementally**: `annualTax(ytd + profit) -
annualTax(ytd)`. An increment is taxed at the *marginal* rate, and
`stateIncomeTaxBps` was set to exactly that — the state marginal plus the county.
Inside one bracket the two answers are identical, and a test asserts it.

It only goes wrong when the increment **crosses a bracket edge**. Maryland steps
4.75% → 5% at $100,000 for a single filer, and a flat rate cannot know that.

### D-52. Additive, so nothing stored breaks

`TaxProfile` gained an **optional** `stateJurisdiction`. Present → that state's
brackets plus its county rate. Absent → exactly the old flat path.

⚠️ This project has already shipped the opposite twice: a new required field on
a stored config makes every existing row invalid, *including for the command
that would repair it*. Optional avoids that entirely.

⛔ **An unmodelled jurisdiction falls back to the flat rate, never to zero.**
Anne Arundel and Frederick are graduated rather than flat and are deliberately
absent from the table — a flat approximation of a graduated rate is the exact
error this item removed, so they are missing rather than wrong (**B51**). A
plant that returned `0` for them reds.

The bracket walk itself is now shared: `bracketTax()` is one implementation that
federal and state both call, because two copies of "walk the steps" would drift.

### Live

Measured before changing anything: **identical up to $20,000** of annual
business profit, diverging by **$40.18 at $40,000**. Switched the live profile to
the bracket-walk method, and corrected `stateRateBasis`, which still said the rates
were "recalled, NOT checked" — they are now confirmed. `tax profile show` gained
a **method** line, because the flat rate otherwise reads as the answer when it
is only the fallback.

414 tests, four gates. Ledger verifies; backed up.

---

## 2026-09-08 (4.9) — which gate is binding, and what to do about it

### D-53. The code is not the answer; the cause is

First version put the histogram on the feed and led with the top code. Rendered
against a $50-shaped fund with five rejected candidates, it said:

> **Mostly the buy score — 12% of 41 rejections**

Two things wrong, and only visible by looking at it. **12% is not "mostly"** —
one rejected item trips several gates at once, so codes fragment and no single
one dominates. And `BUY_SCORE_TOO_LOW` is a **composite**: it is downstream of
the others and tops the list while telling the operator nothing they can act on.

So the view groups rejections by **cause**, and there are exactly three because
there are exactly three responses:

| cause | what to do |
|---|---|
| the fund is too small | nothing — capital limits loosen as it compounds |
| the rules are tight for this bankroll | a deliberate policy change, after checking reachability |
| the items are not good enough | source differently |

The same demo now reads **"Mostly the fund is too small — 39% of 41
rejections"**, which is exactly what risk **R2** predicts and the honest answer
for a $50 fund. The top single gate is still shown, demoted to a footnote.

### Exhaustive by comparison, not by a list

⛔ The explanation map is asserted against the engine's own `CONSTRAINT_CODES`
rather than a hand-kept tally, so a new constraint shows up as a failing test
instead of as "an unrecognised gate" on screen. Planted by deleting one entry;
it reds. This project has already been bitten once by a hand-written field list
(`minSellThroughBps` reaching a gate as `NaN`).

### Twice now: kill the dev server BEFORE starting one

The re-check came back empty because the previous server still held the port —
`EADDRINUSE`, and by the time I looked, its timeout had expired so nothing was
listening at all. The 47-cent incident was the same lesson from the other side.
**Kill before starting, not only after.**

421 tests, four gates. Demo ledger deleted; ports confirmed clear.

---

## 2026-09-08 (4.10) — how good the guesses were

### D-54. A screen must not be more confident than its engine

`accuracyVerdict()` already refuses to read a trend below five scored sales —
it returns *"only 3 scored sales — too few to read a trend"*. A screen that
drew a confident curve beside that sentence would be a **second, more
optimistic answer to the same question**, and the optimistic one is the one a
person acts on.

So `AccuracyView` carries `readable`, set from the engine's own threshold, and
the screen renders the figures only when it is true. Below five it says what is
missing instead: how many sold with no prediction to compare against, which is
a gap rather than a failure. Planted by making it readable at any `n`; the
four-sale test reds.

On the live fund it reads *"no sales yet — nothing has sold with a prediction
against it yet"*, which is the truth and is more useful than a page of zeroes.

### The three profit figures, kept apart

Item profit, operating profit and owner-distributable are shown with the
subtraction between them spelled out, because conflating them is how a business
spends its tax money on boxes. The expense breakdown marks capitalised costs and
says they are already inside an item's book value — the live fund shows
`SUPPLIES $0.00 · 4`, which is D9's corrections netting out exactly as intended.

424 tests, four gates. Ports clear.

---

## 2026-09-08 (4.11) — rules editable without a shell, money still not

### D-55. A second narrow door, not a wider one

Gate 4's exit line said *"policy can be changed without a shell"* — written
before 4.4 made the web surface read-only by type. Building 4.11 meant opening
something back up, and the before-scan found the distinction that made it a
clean decision rather than a compromise: **there are three tiers of write, and
they are not equally dangerous.**

| tier | writes | blast radius |
|---|---|---|
| 1 — the ledger | `commit()` | real money, hash-chained |
| 2 — config | policy, tax profile | the *rules*, validated and versioned |
| 3 — the deal book | `opp save`, `setStatus` | scored candidates, no money |

Jason took **tier 2 only**. So `ConfigWriter` is a *separate* interface with
five methods, reached through its own `withConfigStore()` — deliberately not
"`LedgerReader` plus writes", because that shape invites one more capability
each time something needs it.

⛔ Narrowed at runtime as well as in the types, the same way `readerFor` is, and
for the same reason: **a dev server executes code that does not typecheck**, and
that lesson cost 47 events in a real ledger. A test asserts the config door has
no `commit`, no `db`, no `events` — and plants the leak by handing back the full
store.

The worst a bad edit can now do is set wrong rules going forward. That is
validated on the way in, versioned so divergence is detectable, and repairable
with `policy adopt-defaults`.

### D-56. B30, and why a longer list would not have fixed it

Four variants of one bug in two days: a stored config predating a field the code
requires, arriving as `undefined`, leaving a calculation as `NaN`.
`minSellThroughBps` printed *"vs a NaN% minimum"* and failed closed by luck.

`validatePolicy` had already been fixed the right way — its loop runs over
`Object.keys(DEFAULT_BOOTSTRAP_POLICY)`, so a new field is required
automatically. **`validateTaxProfile` had not**: it was a hand-written sequence
of checks, correct until the next field is added and then silently wrong.

`src/core/config-shape.ts` is now the one completeness check, and both configs
use it. ⚠️ Optionality falls out for free — a key absent from the defaults is
not required, which is exactly right for `stateJurisdiction`. And `null` counts
as present, because `stateRateBasis` and `itemizedDeductionCents` both use it to
mean "deliberately not set"; rejecting null would have broken every valid
profile.

The error names the repair command, because a message that states the problem
without the fix just sends someone hunting.

### Verified

435 tests, four gates. `/settings` renders and edits against a throwaway ledger;
a refused edit leaves the stored rules untouched, asserted directly. Ports clear;
live fund verifies, policy version unchanged at `2026-09-08.5`.

---

## 2026-09-08 — GATE 4 CLOSED, and the phase after-scan

### Exit criteria, checked rather than assumed

> *every number the CLI reports is readable on a phone, a candidate can be
> scored from the aisle, and policy can be changed without a shell.*

Enumerated the CLI's twenty commands against the six screens. Everything is
covered except three, and the gap was real:

- **`items` had no screen at all** — and inventory is the most operationally
  useful of the three, because the question is not "what do I own" but "what is
  going stale". Built `/inventory` as part of this scan rather than filing it,
  since the exit line claimed it.
- **`ledger` and `headroom`** were judged out deliberately: the event log is an
  audit view that belongs on a laptop, and headroom is the sourcing screen's
  ceiling under another name. Recorded as **B52** so the judgement is visible
  rather than looking like an omission.

Then ran all five screens against a seeded fund, authenticated and not: every
one renders real data at 200 and returns **307 to /login** unauthenticated.

### The cross-item defect a per-item scan could not have caught

⛔ **`views.ts` says "the screens never divide by 100". 4.11 did it three times.**

The rule was stated in 4.2 and broken in 4.11 — nine days of items apart, by the
same author, with no mechanism in between. That is what a rule with no
enforcement is worth, and no per-item scan would have found it, because within
4.11 the code looked reasonable.

Two fixes, one for the instance and one for the class:

- `toDollarsInput()` in core — the inverse of `parseDollars`, giving the plain
  `1234.56` a form field needs. `formatCents` produces `$1,234.56`, which cannot
  be typed back, and *that* is why the workaround was reached for.
- **`npm run lint:imports` now fails on cents arithmetic in `src/app` or
  `src/server`.** Planted and verified.

### A gate that would have caught its own author, if it had run

Building that lint, a Python `\b` (backspace, not a word boundary) put **four
literal 0x08 bytes into the regex**, which then matched nothing. The plant did
not fire, and diagnosing the plant before the check is what found it.

⚡ **`npm run lint:bytes` caught it the moment it ran** — `check-import-direction.mjs:58
contains control byte 0x08`. The gate written after the NUL-in-`hash.ts`
incident did exactly its job on a completely different invisible byte. It had
simply not run yet, because I had been running `lint:imports` alone.

⚠️ The lesson is the small one: **run the whole `check`, not the one gate you are
working on.** A gate you skip is a gate you do not have.

### Patterns that held across the phase

- **Decisions as data.** `screens.ts`, `sourcing.ts`, `feed.ts`, `binding.ts`,
  `inventory.ts` — every screen's judgements live in a tested module and the
  `.tsx` is typography. It is what made "which gate is binding" and "haggle vs
  walk away" assertable without a browser.
- **Looking at the artifact found what tests could not**, twice: the sourcing
  screen explaining a hold-time rejection with a price ceiling (4.5), and the
  histogram announcing "mostly the buy score — 12%" (4.9). Both times the model
  was right and the *presentation* was wrong, which no model test can see.
- **Every new door was narrowed at runtime, not just in the types** — after a
  dev server executed a plant that should not have compiled and wrote 47 events
  to the live ledger.

### Gate 4, in numbers

Six screens, one auth gate, **445 tests** (from 294 at the start of the gate),
four check gates, and every new control planted. The live fund verifies, is
backed up, and stands at $50.00 — unchanged by any of it except the 47 cents I
put in and took back out.

### Replenishing: Gate 5

The queue never goes idle, so Gate 5 is promoted and decomposed. ⚠️ Its first
sub-step is a **decision** rather than a build — how opportunities arrive
(official eBay API, saved-search export, or faster-manual) depends on API terms
and key acquisition, which are Jason's calls. **B42** (install Tailscale) is
still the other thing only a human can do, and until it happens none of Gate 4
is reachable from an actual aisle.

---

## 2026-09-09 (5.2) — the engine runs on a phone, unchanged

### The claim, and the strongest test available for it

Gate 1 asserted `src/core/**` is pure — no I/O, no clock, no framework — and the
whole phone port is a bet on that being true rather than aspirational. 5.2
existed to settle it at step two instead of step ten.

`mobile/` is Expo 56 / React Native 0.85, matching GigWorkTracker. `app/index.tsx`
imports the engine **straight from `../src`** — not copied, not adapted, not
shimmed — and runs a real evaluation: fund a state with $50, score a candidate,
show max price, bound-by, expected profit, verdict.

`expo export --platform ios` produced **1,213 modules in a 3.2 MB Hermes
bundle**, and:

```
git status --short src/core src/scoring src/domain
(nothing)
```

⚠️ **"It bundled" is not the claim.** A bundle that quietly excluded the engine
would also bundle. So the compiled bytecode was searched for markers that exist
nowhere else — `INV_IDENTITY` (ledger invariants), `PAYOUT_EXCEEDS_PAYABLE`
(the engine), `SELL_THROUGH_TOO_LOW` (constraints), `socialSecurityWageBaseCents`
(the tax tables). All present.

**4,878 lines and 445 tests of financial logic now run on a phone with no
changes.** That is the Gate 1 purity discipline paying for itself in one step.

### Metro needed exactly what Turbopack needed

The repo writes `import ... from './x.js'` for TypeScript sources. Metro does
not resolve that, the same way Turbopack did not (**B38**). A ten-line
`resolveRequest` in `metro.config.js` teaches it — the same trade taken at Gate
4: teach the bundler rather than rewrite the extension off every import in a
financial core.

### The install was most of the work

⛔ **Three separate failures, none of them the code:**

1. **`npm error Cannot read properties of null (reading 'edgesOut')`** — an npm
   arborist bug that masked a real error. `--legacy-peer-deps` gets past it, and
   the real error underneath was a version I had guessed (`expo-sqlite@~56.0.8`
   does not exist; `56.0.6` does).
2. **The large-tarball problem, three more times** — `react-native`,
   `expo-modules-core` (28 MB) and `expo-sqlite` (33 MB), each needing two
   resume passes. It is now a committed script,
   **`scripts/seed-npm-cache.sh`**, because retyping the recipe a fourth time
   was silly.
3. **`--legacy-peer-deps` silently skipped expo-router's peers**, so the first
   bundle failed on `expo-linking`. That is the cost of the workaround for (1),
   and worth knowing: peers are not installed, they are just not *checked*.

⚠️ **Vitest was dropped from `mobile/`.** Version 4 pulls `@rolldown/binding`,
which this machine is documented as unable to install (log D-02). The engine's
tests run from the repo root on Vitest 3, which is where they already live.

### Verified

Root `npm run check` still exits 0 — 463 tests, four gates, nothing in `src/`
disturbed. The bundle is gitignored; `mobile/` is committed.

---

## 2026-09-09 (5.3) — the driver is written; proving it needs hardware

### D-57. expo-sqlite has a synchronous API, and that decides the whole port

The single most consequential thing found here. `Db` is synchronous, and so is
`FundStore`, `applyCommand`, and every caller. If `expo-sqlite` were async-only,
the port would have meant making the entire engine async — a rewrite of the
thing the port exists to preserve.

It is not. `openDatabaseSync`, `execSync`, `runSync`, `getAllSync`,
`getFirstSync`, `closeSync` all exist and map one-to-one onto the interface. The
port stays **one file**, exactly as `ASSUMPTIONS_AND_RISKS` A1 predicted in
Gate 1.

Two deliberate choices inside it:

- **`getFirstSync` returns `null` for "no row"; the contract requires
  `undefined`.** Those must not blur, because `null` is a legitimate stored
  VALUE elsewhere in this codebase — `stateRateBasis` uses it to mean
  "deliberately not set".
- **Transactions do NOT use `withTransactionSync`.** That would be a second
  implementation of the re-entrancy rules. The same BEGIN/SAVEPOINT ladder as
  the Node driver is used instead, so both behave identically under nesting —
  which the contract asserts.

### D-58. The contract had to become data before it could be a control

The suite written at 5.1 imported `describe/it/expect` from Vitest, which does
not exist on a device. A copy for the phone would have produced two suites that
agree with themselves and prove nothing about each other — the exact failure
this project has hit four times.

So the cases moved to `src/db/driver-contract.ts` as **data**: an array of
`{name, run(db)}` with a tiny assertion helper and no test-framework import.
Two thin runners execute them — `tests/driver-node.test.ts` under Vitest, and
`mobile/app/contract.tsx` on a device. One contract, two implementations.

⚠️ **A design flaw surfaced while doing it**: `Db` and `SqlParam` lived in
`driver.ts`, next to the `node:sqlite` implementation, so a React Native
typecheck could not compile the interface without pulling in Node. An interface
only one platform can compile is not an interface. They moved to
`src/db/db-types.ts`; `driver.ts` re-exports them so nothing else changed.

### ⛔ What is NOT proven, and why

The driver typechecks and bundles for iOS with its runner. **It has not been
executed against expo-sqlite**, and both available paths are closed:

- **Web is a dead end, and measured rather than assumed.** The web build works
  after registering `.wasm` as an asset and serving with COOP/COEP so
  `SharedArrayBuffer` exists — and then dies with **"Sync operation timeout"**.
  expo-sqlite's web backend is wa-sqlite, whose synchronous API goes through a
  worker and `Atomics.wait`. Native sync is a direct JSI call with no worker, so
  this is specific to web, which is not a target anyway.
- **The Android emulator wants 4 GB of free RAM; 1.9 GB is available.** Checked
  first that this was not my own mess — zero stray node processes — so it is
  ordinary application memory, not something to go killing.

**5.3 stays open.** It needs a run on Jason's device, or an emulator run when
the machine is quiet. Everything is in place for either: boot, open the app,
tap *run the driver contract*, and the screen reports pass/fail per case —
which is also logged as `DRIVER_CONTRACT_RESULT ...` so `adb logcat` can read it
without a screenshot.

⚠️ **Not claiming the port works until that runs.** Sixteen cases passing under
`node:sqlite` say the contract is sound; they say nothing about expo-sqlite.

---

## 2026-09-09 (5.3 proven) — 16/16 on Apple's SQLite

### The port's only real gamble is retired

`expo-sqlite` passes the **same sixteen cases** `node:sqlite` passes, executed on
a real iOS simulator. Not a copy of the cases — the same array, imported from
`src/db/driver-contract.ts` by both runners.

That means re-entrant SAVEPOINTs, rollback leaving no partial write, integer
cents that do not drift at 0.29 or 1.13, NULL staying distinct from the empty
string, CHECK and foreign-key enforcement, and accurate `changes` counts all
behave identically on the phone. Everything after this is work rather than risk.

### D-59. The lane was planted, because a green CI job proves nothing on its own

Reverted immediately afterwards, but the run is in the history: `get()` was made
to leak `expo-sqlite`'s `null` instead of normalising it to `undefined` — the
**exact platform divergence the driver exists to remove**. CI went red:

```
CAUGHT: returns undefined rather than throwing when nothing matches
        :: missing get: expected undefined, got null
```

15/16, `allPass=false`, job failed. The lane catches a real difference between
the two SQLites, which is the only thing it was built to do.

### Three rounds, and none of the failures were the code

1. **The workflow did not register.** Pushed with the repo, and Actions listed
   zero workflows; a subsequent touch commit registered it. The YAML was valid
   the whole time.
2. **Exit 65 inside a Pods script phase.** `tail -40` had already discarded the
   script's own output, so the log named the phase and not the reason — a wasted
   round trip, and exactly what debt-app-v1's action avoids by `tee`ing the full
   log. Now kept and uploaded.
3. ⛔ **`macos-15` cannot build Expo 56.** With the full log:
   *"package 'apple' is using Swift tools version 6.2.0 but the installed
   version is 6.1.0"*. Swift 6.2 ships with Xcode 26. `runs-on: macos-26` fixed
   it, and the lane now prints its Xcode and Swift versions first — the mismatch
   cost a round trip precisely because nothing said which toolchain was in play.

### The repository went public, and what that took

Jason asked for CI, then for the repo to be public. ⛔ **It carried his real tax
situation** — filing status, income and county, beside his name, in four docs and
a test. None of it is needed: the engine takes a `TaxProfile` as input.

Scrubbed to an illustrative profile, and two tests recomputed rather than
re-baselined. Then the harder half: **history**. `filter-branch` rewrote all 35
commits, verified clean.

⚠️ **A force-push was not enough, and this was measured rather than assumed.**
After force-pushing, the pre-scrub commit was still fetchable:

```
gh api repos/.../contents/tests/tax.test.ts?ref=ebbdc47  → 2 occurrences
```

A force-push removes the ref, not the objects, and pushed SHAs appear in the
public events API. Deleting the repo needed a `delete_repo` scope the token did
not have — so the old repo was **renamed** (which only needs `repo`), and a
fresh one created for the clean history. The pre-scrub SHA returns *"No commit
found"* in the public repo, and the tree has zero occurrences.

⚠️ **`jsnyde03/resale-os-prescrub-private` still exists, private, and still
contains the data.** Deleting it is Jason's, and it is not urgent.

---

## 2026-09-09 (5.4) — the store runs on a phone

**24/24 on a real iOS simulator**: the 16 driver cases plus 8 engine scenarios —
migrations applying and being idempotent, a full buy-and-sell, a rejected
command leaving the database untouched, `reconcile()` agreeing, the hash chain
catching a hand edit, an expense reversal keeping ledger and analytic table
together, and the YTD tax base surviving storage.

### D-60. Four couplings, all the same shape

Importing `FundStore` dragged the desktop in behind it. Each was the same flaw
and took the same cut — **separate what a phone can compile from an
implementation only a desktop can**:

| module | pure half | why it was coupled |
|---|---|---|
| `backup.ts` | `backup-types.ts` | settings and staleness are arithmetic; copying files is not |
| `migrate.ts` | `migrate-core.ts` | APPLYING a list is platform-free; reading a DIRECTORY is not |
| `driver.ts` | `db-types.ts` | `toParam` is normalisation, not SQLite |
| `FundStore.open` | `open-store.ts` | opening a database was the one genuinely platform-specific thing the store did |

⛔ **Migrations are now bundled as source**, because a phone has no filesystem to
read `.sql` from. A generated file rots, so `tests/migrations-bundle.test.ts`
compares it to the directory byte for byte — the failure mode it guards is
silent and expensive: desktop runs a new migration, phone does not, the schemas
diverge, every test stays green.

### D-61. The hash chain used `node:crypto`

The one that could have sunk the port. React Native has no `node:crypto`, and
the alternatives were a hand-rolled SHA-256 or an async digest — the latter
would make `commit()` async all the way up, because the chain is computed inside
the write transaction.

`@noble/hashes` is audited, pure JavaScript and **synchronous**, so one
implementation serves both platforms and there is no divergence to cross-check.

⚠️ **It had to be byte-identical.** The live ledger's stored hashes were computed
by OpenSSL; anything different and the fund would report its own ledger as
tampered with. `tests/hash.test.ts` compares the two across a thousand
deterministic inputs plus the shapes actually hashed, and pins a golden value —
because the first comparison shares `canonicalize` with the implementation and
so cannot catch a change to *what* is hashed, only to *how*. The live chain
still verifies.

### ⚠️ Scope corrected: not "445 tests on device"

Fourteen of the twenty-seven test files never open a database. They exercise
byte-identical pure code with no platform surface, and running them on a phone
would be theatre. What a different SQLite can break is the store — so the
scenario exercises the store, and says so.

### Three CI rounds, and what each cost

1. **CRLF vs LF.** The bundle is generated on Windows (git checks out CRLF); the
   runner checks out LF. The gate could never pass on both. Both sides normalise
   now — SQLite does not care about line endings, but a gate that only passes on
   one platform is worse than none. **Third CRLF bite of the day.**
2. ⛔ **Backslash escapes do not survive being written through a shell heredoc
   into source.** It mangled the same regex twice here, exactly as it turned a
   `\b` into a literal backspace earlier. Both normalisers now use
   `String.fromCharCode`, which has nothing to escape. **Use the Edit tool for
   anything containing an escape.**
3. **A stale run watched as if it were new.** The workflow's `paths` filter
   listed only the driver and the contract, so the migration fix never triggered
   a run — and I polled the previous result believing it was current. The filter
   now covers everything the device run depends on.

## 2026-09-09 (5.5.1) — D4: an override is allowed, and may never be silent

Jason's answer: **allowed, but it must say so.**

### The decision was already shipping, wrongly

`cli buy --force` existed before the decision did. It printed *"recording it as
it happened"* and then committed an **ordinary PURCHASE** — no marker, no
reason, nothing. The moment the terminal scrolled, an overruled buy and a clean
one were the same row. That was live on the real fund.

So D4 was not "should this exist"; it was "the thing that exists is wrong in
exactly one way." One line under either answer, as predicted.

### What it is

A `PURCHASE` may carry `overrodeGates: string[]` and `overrideReason: string`.
The engine refuses the purchase if gates were overridden with no reason
(`OVERRIDE_NEEDS_REASON`), and does **not** judge whether the override was
right — `constraints.ts` assesses a *decision*, the engine records what
*happened*. `--force` now requires `--reason`.

⚠️ **Absent ≠ empty.** No override and "overrode an empty set of gates" are
different facts, and an empty array must not be made to owe a reason. NULL in
the column, absent on the record, asserted both ways.

⛔ **Not a separate event type (B9's original shape).** An override is a
property OF the purchase. A second event could be written, deleted or replayed
independently of the buy it describes, and the two would eventually disagree.

**Recorded is not enough — it has to be visible.** `items` prints the gates and
the reason under the item. An override nobody can see later is a silent
override with extra steps.

### The item table gained a column, so the phone had to prove it too

Migration `006_purchase_override.sql`, and a case in `src/db/engine-scenario.ts`
— a column is exactly the kind of thing a different SQLite reads back
differently, and that contract is what runs on the simulator.

### ⚡ What planting found, and it was not the feature

Five plants: the engine's reason check, the engine's write to the item record,
the store's INSERT, the store's read, and the CLI's `--reason` requirement.
Four reded immediately. **The INSERT plant passed the entire suite.**

Two separate faults behind that:

1. **The test read `store.state()`, which is the cache.** After a commit the
   cache holds the engine's own answer, so the "round-trips through the items
   table" test never touched the table. A round trip through one encoder,
   wearing the costume of a persistence test. → **B54**, and it wants a lint.
2. **`reconcile()` compared three hand-picked item fields** — book value, state,
   realized profit. Every other field, including the new column, was
   unreconciled. `store.ts` carries a comment about being bitten by exactly this
   (a hand-written field list let `minSellThroughBps` through) and the same
   shape was sitting in `replay.ts`. It now takes the **union of both records'
   keys**, which is correct by construction and covers every field added later.

With both fixed, the INSERT plant reds three tests.

### And the suite hid its own failure

Migration 006 broke `migration-rebuild.test.ts`, which asserted stage 2 runs
exactly `[REBUILD]`. But the failed assertion skipped `store.close()`, so the
temp-directory cleanup threw `EBUSY` — and **the EBUSY was the only error
reported.** The stale assertion was invisible behind a filesystem error. The
handle now closes in its own `finally`, and the expectation is derived from the
migrations directory rather than listed. Planted: a deliberate failure now
reports as the assertion it is. → **B55**.

**494 tests green**, `npm run check` clean.

## 2026-09-09 — the scrub missed the planning docs, and the repo was public

Found while opening `MASTER_PLAN.md` to record D4. The pre-publish scrub took a
**directory list** — `src/`, `data/`, `.env.local` — and the operator's tax
profile does not live only in code.

Public on `origin/master` for a day:

| file | what |
|---|---|
| `MASTER_PLAN.md` | D7 in full: filing status, other income, W-2 wages, county, combined rate |
| `MASTER_PLAN_LOG.md` | the same, plus `C:/Users/<name>/OneDrive/...` and the county named in five entries |
| `CLAUDE.md` | the profile in the status block, and the backup path |
| `docs/FINANCIAL_SPEC.md` | the live combined rate with its county derivation |

Name (from git authorship, unavoidable and fine) **plus** county **plus**
filing status **plus** income, in one place. Individually dull; together a
record.

### What was changed

Every statement that the profile belongs to a real person is gone. What
survives is the *reasoning* — that a bare rate needs a derivation, that recalled
rates are not looked-up rates — with the figures described rather than printed.

⛔ **The test fixtures were the subtle half.** `tests/tax.test.ts` built `FLAT`
and `BRACKETED` on the operator's actual county and combined rate, with a
`stateRateBasis` string that read exactly like his stored config. Moved to a
different county (Talbot, 2.40%, combined 7.15%).

⚠️ **This entry does not name the old county either.** Writing down what was
removed, in the file that was scrubbed, un-removes it.

⚡ **And that swap was itself a control.** Every expectation in that block is a
derived expression — `applyBps(100_000, 200) + applyBps(100_000, 300) + …` —
so changing the county changed the inputs and **61 tests still passed**. Had
those numbers been copied from output, the swap would have reded the file. The
illustrative `MARYLAND` block was left alone precisely because its expectations
*are* opaque cents, and rewriting them to match new output would have replaced
a test with a tautology.

`src/core/tax/state.ts` keeps every county including that one. It is the
published statute table, it is correct, and it names nobody.

### The rule, in `CLAUDE.md` where a session will hit it

The operator's profile is an **input**. `TaxProfile` is a parameter for this
exact reason, and it lives in a gitignored database. A doc that writes the
figures down for convenience publishes them. ⚠️ **And force-pushing does not
take it back — GitHub keeps the objects, fetchable by SHA.** Measured twice on
this project, which is why the fix is a fresh repo rather than a rewrite.

→ **B56.** Next publish gets a whole-tree sweep, not a directory list.

### The republish, and how it was verified

Squashed rather than rewritten. There is no `git filter-repo` on this machine,
and a `--replace-text` list only catches the phrasings you think of — the docs
said the same fact four different ways across forty-eight commits. A single
orphan commit is *checkable*, which a rewrite is not.

- old repo renamed to `resale-os-prescrub-2` and set **private**
- fresh public `jsnyde03/resale-os`, one commit, pushed
- the forty-eight-commit history is retained **locally** on `pre-scrub-history`
  and is not published

⚡ **Verified from an independent clone, not from this working copy** — every
object in the published history walked with `cat-file`, grepping for the county,
the income and the user path. One hit: `src/core/tax/state.ts`, which is the
published county rate table and names nobody. A sweep of the tree you just wrote
proves what you meant to write; a sweep of a fresh clone proves what is actually
on the internet.

⏳ **Needs Jason:** delete `resale-os-prescrub-2` and `resale-os-prescrub-private`.
Both are private and both still hold the data; the CLI token has no `delete_repo`
scope, so it is a click in Settings.

## 2026-09-09 (5.6.0) — the shell, and a lane that built two different apps

### The switch-in audit found 5.6 standing on nothing

The plan said "the write screens the desktop CLI owned." `mobile/app/` held
three files: a layout, a proof harness that builds a fund in memory, and the
contract runner. **No device database, no `FundStore`, no navigation.** A buy
screen had nowhere to write. → **5.6.0** inserted.

Second finding, same scan: **5.5 has been waiting on "get the JSON onto the
phone" and there is no way to.** Without an import the phone can never hold the
real fund and every write screen below would be operating on an empty one. That
is Category 1, so it folded into the shell rather than the backlog.

### What the shell is

`FundProvider` holds **exactly one** `FundStore`. Not a style preference: the
store caches `state()` and invalidates on its own writes, so a second instance
over the same file would hold a cache nothing invalidates and a screen would
show a balance that was true before the other instance spent it. The desktop
never had this problem because every CLI command was a process.

⚡ **A refusal is a value, not an exception.** `commit()` returns
`{ok:false, refusal}` for the five errors the engine deliberately raises and
**rethrows everything else** — a bug dressed up as "the fund said no" is a bug
nobody reports. The CLI learned the same lesson when an unhandled `EngineError`
printed a stack trace at the operator; the phone's version of that mistake is a
red screen, which reads as "the app broke" rather than "the rules refused".

⛔ **The provider is skipped under `EXPO_PUBLIC_RUN_CONTRACT=1`.** Otherwise the
app shell — migrations, seeding, a store — sits upstream of the thing the
contract lane tests, and a shell bug would surface as "no result file", which is
that lane's phrase for "the app never ran". Those are different failures.

### `FundStore.invalidate()`, found by writing the import

`importLedger` replays through a store of **its own**, so the app's store is
left holding the cache it had before — an empty fund. The import would have
reported success onto a screen still showing $0.00. Added `invalidate()`, and a
case in the cross-platform scenario: a second store commits, the first still
answers with the stale number, then agrees after being told. Planted by making
`invalidate()` a no-op — red.

### ⚡ The iOS lane was building two different applications

The lane went red, and the useful part is *why*. Two runs, forty minutes apart,
**the same commit**:

| | |
|---|---|
| run 1 | `[Hermes] Using release tarball from URL: …/250829098.0.10/…` → built, then the app died at runtime |
| run 2 | `[Hermes] Using the latest commit from 250829098.0.0-stable` → 4,000 lines of C++ ending in `no type named 'TypedArray' in namespace 'facebook::jsi'` |

`hermes_source_type()` asks whether a prebuilt tarball **exists** on Maven
Central and, if that request fails, falls through to `BUILD_FROM_GITHUB_MAIN` —
the tip of a branch, which by then was ahead of RN 0.85.3's jsi. Verified by
hand: the artifact is still **listed** in the Maven directory while a direct GET
returns 404. A CDN hiccup silently changed what the app was compiled from.

⛔ **This is the fallback-that-hides-an-input-change pattern, and it is the
third time this project has been bitten by a control whose failure looks like a
result.** It did not error. It produced a different app.

Fixed by fetching the tarball in its own step, with retries, and handing the
podspec a local file — `LOCAL_PREBUILT_TARBALL` outranks every other source
type. A download that genuinely fails now **stops the job** instead of quietly
compiling something else. And a control on the pin: after `pod install`, assert
`destroot/…/hermesvm.framework` exists, which a prebuilt tarball has
immediately and a source build only has after six minutes of compiling.

⚠️ **Run 1's runtime death is still unexplained** and predates every line of the
shell. The lane now captures the app's console, any crash report written to the
host, and the process's own lines from the simulator log — none of which existed
when it happened.

## 2026-09-09 (5.6.1) — the buy screen, and one arithmetic for two surfaces

The screen the whole gate is for. A category and a price are enough to see what
the rules say; the quote updates as you type; a failing purchase lists the gates
it failed and offers the D4 override, which will not submit without a reason.

### ⛔ None of the arithmetic is in the screen

`cli buy` had it inline — landed cost, velocity, fees, the fire-sale downside,
the candidate. The phone needs the identical numbers, and **two implementations
of "what will this net" is how a fund starts disagreeing with itself about what
it was allowed to buy.** Extracted to `core/capital/quote.ts`; the CLI calls it.

Then the same argument one level up: `purchaseCommandFrom` builds the PURCHASE
command, because **the fields the engine hashes must not depend on which surface
recorded the buy.** A phone writing `expectedDaysToSale` from the operator's raw
guess while the CLI writes it from the velocity model would produce two
different events, and two different hashes, for the same purchase.

### The tests are the point of the extraction

The CLI's own tests exercise all of this end to end and assert only **which gate
refused** — so they would sit green through a wrong fee, a wrong fire-sale rate
or a wrong multiple. `tests/quote.test.ts` asserts the figures, every one
derived by hand from the published fee model rather than copied from output.

Planted five ways — the fire-sale rate, the default multiple, the sell-through
that must stay **absent** for an operator estimate so the gate abstains rather
than failing an unknown, the days coming from the model rather than the input,
and the empty-gate-list case that must not become an override. All red.

⚠️ **`itemIdFrom` moved to `src/core/ids.ts` and got its own tests.** It was a
helper at the bottom of a screen, and an item id is **hashed into the ledger and
permanent** — it cannot be renamed later without breaking the chain. The tests
pin the fallback for a name with nothing Latin in it, the trailing hyphen that
survives truncation, and the point at which four digits of padding stops sorting
in ledger order (9,999 events) rather than assuming it never will.

### What the after-scan found and did not fix

⛔ **Nothing can see a screen.** `mobile/` has no test setup, so the wiring is
covered by nothing. The logic was pushed into `src/` where it is tested, but
that is a mitigation, not a test. → **B60**, to be decided before 5.6.5.

**B59** is a decision for Jason: `purchaseCommandFrom` *can* record what a
purchase expected to net, and deliberately does not by default, because
`accuracyReport` measures the items that have a prediction and that population
currently means "came from a scored opportunity".

## 2026-09-09 (5.6.2) — sell, and a number that should never have been typed

An item picker over everything holding capital, the gross, and the three costs.

**The fees are suggested, never assumed.** The marketplace model knows what eBay
usually charges, and what eBay usually charges is not what *this* sale charged —
so it fills the boxes on request and the operator corrects them against the
payout. The recorded numbers are always the ones they saw.

### ⛔ `daysToSale` was a flag, and it should have been a subtraction

`cli sell` took `--days`. So a real hold was recorded as whatever the operator
remembered, or — far more often — as nothing at all. Both timestamps were
already on the record.

⚡ **And the consequence was not cosmetic.** `accuracy`'s `hasOutcome` requires
`daysToSale !== undefined`, so **a sale recorded without `--days` was invisible
to the instrument that measures whether the estimates are any good.** Planting
the derivation away turned the whole report into "no sales yet".

`daysBetween` is in `src/core/ids.ts`, floored at whole days and at zero: a
same-day flip is 0, not 1, because rounding it up to look better would be a lie
in a median. A back-dated sale cannot produce a negative hold.

⚠️ **A tested helper is not a used helper.** `daysBetween` has unit tests; the
CLI test asserts the CLI *calls* it — the item appears in `accuracy --items`
with an actual-days column, without anyone typing a flag. That test found its
own premise wrong twice: the purchase needed comps rather than an operator
guess, because a guess carries 30% confidence against a 45% gate. The rule
working, not an obstacle.

⚠️ **And the restore after that plant silently failed** — the replacement string
was no longer unique, `typecheck` passed because the plant is valid TypeScript,
and only re-running the suite caught that the fix was still missing. Restoring
is an edit like any other and needs verifying like one.

## 2026-09-09 (5.6.3, 5.6.4) — money out, and the escape hatch

**One screen for expenses and payouts, because they answer the same question —
"where is this going?" — and they are emphatically not the same event.** An
expense reduces profit and the tax reserve with it. A payout draws down a
liability the fund already recognised when the profit was split, and changes NAV
not at all. Conflating them is how a sole trader ends up paying tax on money
they spent on postage, so the screen keeps them visibly apart.

An expense can be attached to an item, and only when the operator says so:
attaching it moves the cost from operating profit to that item's profit, and
**both reports stay plausible either way**, which is what makes a wrong
attachment expensive to find later.

### Adjust is deliberately awkward

Every other screen records something that happened. This one records that the
ledger was wrong, and an append-only ledger has no undo — a correction to a
correction is another adjustment and both stay on the record. So: an
eight-character reason, the balance shown before and after, and **two taps**.
The first is a decision, the second is a confirmation, and the gap between them
is where a mis-tap dies.

⛔ **It does not offer expense reversal, on purpose.** A business expense lives
in two places — the ledger and the analytic `expenses` table — and a bare
adjustment moves only the first, after which operating profit and the category
breakdown quietly disagree (the defect B33 was filed for). The correct path
needs `reversesEventId`, which needs the event id, which needs the ledger view
in 5.7. A half-version here would corrupt a report, so the screen says where to
do it instead.

### The refusal surface was built at 5.6.0 and is the same everywhere

`FundProvider.commit` returns `{ok:false, refusal}` for the five errors the
engine deliberately raises and **rethrows everything else**. Every screen
renders the same card and the same sentence: *nothing was recorded*. A bug
dressed up as "the fund said no" is a bug nobody reports.

## 2026-09-09 (5.6.6) — screen coverage, and a lint that had never seen the phone

Jason chose **both**: the contract now, a rendering library only if a wiring bug
actually reaches the device.

### What the before-scan found, before any of it was built

⛔ **`check-import-direction.mjs` sweeps an enumerated list of directories for
money arithmetic, and `mobile/` had never been in it.** Adding it turned the
gate red immediately: `sell.tsx` divided cents by 100 three times in one
function, which is the exact thing `toDollarsInput` exists to prevent and which
`views.ts` says screens must never do.

⚡ **No plant was needed. The violations were already there** — the gate's first
run was its own proof it can fail.

**This is the third time on this project a hand-written list of places to look
has been short**, and the second in two days. A new corpus does not announce
itself to an enumerated scope. `src/ui/**` was then missing from the iOS lane's
`paths:` filter for as long as it existed, which is the same defect in a
different file.

### The two halves

**`src/ui/forms.ts`** — the write screens minus the pixels. Pure: strings in, a
command or a refusal out. Twenty Vitest cases assert what a half-typed number
is, that blank costs are zero rather than unknown, that a fee *suggestion* never
reaches the command, that an expense with no category is not ready (the engine
would take `OTHER`, and a year of `OTHER` is a Schedule C nobody can file), and
that switching to a payout drops the category and the item rather than smuggling
them along.

**`src/db/screen-scenario.ts`** — the third contract, alongside the driver and
the store. A day's work driven through those same models against a real ledger:
buy, refused override, accepted override, sell, expense, refused payout, adjust,
then reconcile. Eight cases, run by Vitest on `node:sqlite` and by the app on
Apple's SQLite in the same lane the other two use. The runner was generalised
out of `runEngineScenario` rather than copied.

⚠️ **Neither is a rendering test, and the log should say so.** They cannot see
whether the price box is wired to `price`. Everything after that point is
covered; the binding is not. → **B60**, half closed.

### Planted, and the plants crossed the boundary

Making `sellModel` record the *expected* hold instead of the derived one reds a
Vitest case **and** a screen-scenario case. Making every spend a payout reds
three and two. That is the property worth having: one defect, both runners.

## 2026-09-09 (5.6.7) — B59: measure the prediction the decision was made from

Jason agreed with the recommendation, which had reversed on a second look.

### The risk pointed the other way

`accuracyReport` measured only purchases that came through `buy --from-opp`.
The worry filed as B59 was that recording an expectation on every purchase
would **mix two populations into one median**.

⚡ **True, and much less important than what the exclusion was already doing.**
After 5.10 retires the CLI, the scorer is the *rare* path: the phone's buy
screen shows an expected profit and that is the number the operator decides
from. An instrument that ignores it is not conservative, it is blind.

So the answer is not a binary — **record it, and keep the provenance so the
report can split.** `ItemAccuracy` gains a `source`: `SCORED` when an
`opportunityId` is behind it, `QUOTED` when the operator priced it, `null` when
there was no expectation at all. `accuracyReport(state, only?)` narrows the
statistics and **still reports the size of the population it left out**, so a
filtered number can never read as the whole picture.

### ⛔ What is deliberately NOT recorded

When the operator gives no expected sale price the quote assumes a 3x flip.
That is `DEFAULT_MULTIPLE`, not a prediction, and scoring accuracy against it
would measure a constant while looking like it measured judgement. So the
prediction is recorded **only when the operator said what they expect to sell
for** — which also makes the instrument something the operator can opt into by
typing one number.

Three honest groups, and the third cannot be retrofitted: every purchase before
today that did not go through the scorer has no expectation, and inventing one
now would be fabricating a record.

### Language

`accuracyVerdict` said *"no scored predictions yet"* and *"N scored sales"*.
Since a prediction can now come from the operator, "scored" would misdescribe
most of them — it says "predictions" unless the report was narrowed, in which
case it names which kind. The `--from-opp` advice in the excluded-items line is
replaced by the thing that actually helps: *say what you expect to sell for and
the buy is measurable.*

Planted both halves — everything counted as `SCORED`, and an assumed 3x
recorded as a prediction. Both red. **562 tests.**

## 2026-09-09 (5.7) — a backup that proves itself by being restored

Promoted ahead of the read screens because the phone becomes the **only current
ledger** at the first event recorded on it, on a device that spends its day in a
car. Read screens are convenience.

### ⛔ Not a copy of the database file

The desktop copies `resale.db` and verifies the copy opens and its chain
verifies. Good — and it still only proves the bytes moved. `makeVerifiedBackup`
exports the ledger's **commands** and *replays them into a scratch database*,
comparing every regenerated hash, before any file exists.

⚡ **That is the stronger guarantee, and it is the one that matters: the failure
a backup exists to survive is not "the file went missing", it is "the file is
there and will not come back".** Only a restore sees that coming, and this does
the restore at write time rather than at panic time.

It is also platform-free — JSON, no `node:*` — so the phone and the desktop make
the same artefact and either restores the other.

### Two obligations, and only one of them is automatic

1. **A verified copy exists** — after every write, in the app's Documents. Cheap
   and automatic.
2. **A copy exists somewhere else** — the operator's, because nothing on the
   device can put a file on another machine without a network service this phone
   may not carry.

⚠️ A backup in the app's own folder survives a crash, a bad restore and a
fat-fingered adjustment. It does **not** survive deleting the app, losing the
phone, or replacing it — the failures that end a fund. `UIFileSharingEnabled`
puts the folder in Files so a copy can be dragged to iCloud, and the home screen
says plainly that until that happens *the fund exists on exactly one device*.
The one-tap version needs `expo-sharing` and is **B61**, deferred rather than
guessed at while no iOS build can start.

### What implementation found

⛔ **`openScratch()` was outside the try block**, so a device that could not
open a scratch database threw past the caller — which on a phone is a red screen
saying the app broke, rather than a refusal saying the backup was not written.
Both mean no backup; only one tells the operator what to do. Caught by the test
for it, not by reading.

⛔ **`eventsBehind` was a duplicate of `backupStaleness`,** which has been the
rule since the desktop backup existed and is already platform-free. Written,
noticed, deleted on sight — a second answer to "is this fund backed up" that
only one surface uses is exactly the drift this project keeps paying for.

**`writeDeviceBackup` never throws.** A backup failure must not make a
successful sale look lost, so the outcome is a value the screens read off
`fund.backup`, and a failed copy shows as a card rather than as a crash.

### The control

Every other case in the module would still pass if the restore never ran — the
"restores to the same fund" case does its own import and would prove the export
good while the verification was skipped. **Handing it a scratch database the
replay must reject is the only assertion that fails when the replay is not
attempted**, and it is marked as such in the file. Planted by deleting the
`importLedger` call: that one, and only that one, reds. Planted again on the
empty-ledger refusal: red in Vitest and in the on-device contract.

**573 tests.**

## 2026-09-09 — the contract earned its keep: expo-sqlite caches connections

The iOS lane reached the app for the first time since the Hermes outage and
reported **38/40**. The silent death was gone; two cases failed, both with
`destination already has events; import needs an empty ledger`.

### ⛔ Not a test failure — a live bug on the device holding the only ledger

`openDatabaseSync(name)` **caches connections by name**: *"whether to create a
new connection even if a connection with the same database name exists in
cache, default false."* So two `openExpoDb(':memory:')` calls returned the SAME
database, where `node:sqlite` returns a fresh one each time.

⚡ **`writeDeviceBackup` opens a scratch `:memory:` database to replay the
ledger into before writing a backup.** With a shared connection the first backup
of an app session succeeds and **every one after it is refused** — on the phone
that holds the only copy of the fund, silently, with the home screen reporting
the backup as stale and no obvious reason why.

Caught before it ever ran on a real ledger, by the contract, on the platform
where it happens. That is the entire argument for the contract in one incident.

### The contract could not have caught it, and now can

`ContractCase.run` took only `(db)`, so there was no way to express "two opens
are two databases" — the suite **assumed** it from the day it was written and
never said it. An assumption a contract relies on and does not assert is not
part of the contract.

`run` now takes `(db, open)` and a case asserts the property directly: a fresh
database sees none of the first one's rows, a write to it does not appear in the
first, and closing it does not take the first down.

⚠️ **Planted by giving `node:sqlite` the same caching bug** — a `Map` keyed by
path in `openDb`. Run whole, it reds most of the suite (the first case's
`close()` kills the shared handle for everything after), which is loud but
crude; run in isolation the independence case reds on its own. Both were
checked, because a plant that reds early hides the assertion you meant to test.

**574 tests.**

## 2026-09-09 (5.6 CLOSED) — 41/41 on a real simulator

The lane is green: driver, store, screens and the backup's restore, all against
Apple's SQLite, in Hermes, on hardware this machine does not have.

Getting there cost four separate diagnoses, and only one of them was our code:

| what looked broken | what was actually broken |
|---|---|
| the app "did not run" | it ran; the lane could not say anything about it — RN strips `console.log` from Release, so a JS error left no trace and "no result file" read identically to "never started" |
| a compile error in the app | `repo.reactnative.dev` served the Hermes listing while every GET 404'd, and the podspec's silent fallback compiled the tip of a branch instead |
| the Hermes pin not holding | the pin held; the CONTROL guessed an extraction path. `Podfile.lock` said `Pre-built` all along |
| two contract cases failing | **a live bug** — expo-sqlite caches connections by name, so every backup after the first would have been refused |

⚡ **Three of the four were checks, not the thing under test.** That is now the
recurring shape on this project, and the rule earned again: when something is
"not caught", diagnose the check before the code.

### The one that mattered

The connection cache would have broken backups on the device holding the only
copy of the fund — silently, first-one-works, with the home screen showing
"stale" and no reason. It was caught on the platform where it happens, by a
contract, before it ever ran on a real ledger.

And it was catchable only because the contract was widened to say something it
had always assumed: **two opens are two databases.**

### 5.6 as a whole

Six write screens, a shell that holds exactly one store, an import, a backup
verified by restore, and a form layer pure enough that Vitest and the device
run the same code. The arithmetic is shared with the CLI — a fund must not
disagree with itself about what it was allowed to buy depending on which
surface recorded it.

**574 tests on the desktop, 41 on the device.**

## 2026-09-09 (5.8) — the read screens, and a gate that walks the graph

### The switch-in audit corrected the item before it started

The plan said *"ported from Gate 4's six"*. Verified against the code: there
are seven `page.tsx` files (six content screens plus login), and more
importantly **`src/server/views.ts` is 338 lines of tested read model the phone
can REUSE rather than port.** `FundStore` already satisfies `LedgerReader`
structurally, so 5.8.0 turned out to be nothing to build — recorded as nothing
rather than invented into work.

### ⛔ It was one import from dragging the desktop SQLite driver into the app

`views.ts` imports no node builtin. It imports `db/backup.js`, which imports
`node:fs` — and reaches `node:sqlite` two hops later through `driver.ts`.

⚡ **The existing import lint checks DIRECT imports, one level deep, which is
not the property that matters for a bundle.** So `scripts/check-phone-bundle.mjs`
walks the graph: it starts from every `src/` module the phone actually imports
and fails if anything on that closure reaches a builtin, naming the chain.

⚠️ **The roots are DISCOVERED, not listed** — by scanning `mobile/` for what it
imports. Every hand-written list of places to look on this project has turned
out short, three times in two days, and this one would have been written before
the read screens existed.

Planted by importing `views.ts` from a screen: it printed
`views.ts -> backup.ts -> driver.ts -> node:sqlite`. One import redirected to
`backup-types.js` and the same plant is clean. Now in `npm run check` and both
CI lanes — and it is no longer hypothetical: the app imports `views.ts` today
and the gate reports 24 roots, 46 modules, no builtins reached.

→ **B62**: 5.10 plans to retire `src/server`, and `views.ts` must MOVE rather
than go with it. Filed before the retirement could get it wrong.

### The screens

**Items** is the shelf and the history as one filtered list — an item's whole
point is that it moves between those states, and splitting them makes "what
happened to that thing I bought" a navigation problem. D4's override shows on
the item for life.

**Ledger** shows every event, its postings, its hash and the chain's verdict.
⚡ **The event ids are the point**: 5.6.4 withheld expense reversal because it
needs `reversesEventId`, and this is what makes the id reachable.

**Reports** is three tabs, not three screens — profit, accuracy, tax. Accuracy
keeps B59's split apart on screen, and refuses to draw a trend below five sales
because the view carries `readable` for exactly that.

⚠️ **The tax tab says loudly when income tax is abstaining.** A reserve that
silently omits it looks like a small reserve rather than an incomplete one.

**575 tests, and the read model now runs on-device in the contract.**

## 2026-09-09 (5.8.7) — the half that needed a ledger view

5.6.4 built the adjust screen and **deliberately refused to offer expense
reversal**, because a bare `ADJUSTMENT` moves the ledger and not the analytic
`expenses` table that operating profit and the category breakdown are read
from — after which the two disagree forever while each goes on looking
plausible. The correct command carries `reversesEventId`; that needs the event
id; the id needed somewhere to come from. 5.8 built it.

⚡ **A deferral that names its own unblocking condition is worth more than a
half-built feature**, and this one collected: the screen it was waiting for
arrived and the work was an hour, not a rewrite.

### What it needed from the store

`outstandingExpense(eventId)` is public now. A screen offering to reverse an
expense has to show how much is still standing — without it the operator
guesses and learns they were wrong from a refusal, and the honest default
(*reverse all of it*, pre-filled) is unavailable to the UI that needs it most.

⚠️ **`src/server/store.ts`'s positive allowlist caught the addition immediately**
— `LedgerReader` gained a method and the reader would not compile until it was
added on purpose. That is the allowlist doing exactly the job its comment
claims: *"anything new on `FundStore` is invisible here until it is added on
purpose."* An `Omit<>` would have passed it through silently.

### Both guards, because only one of them is in the app

`reverseModel` mirrors `#assertReversalIsPossible`: positive amounts only, never
more than is outstanding, and a reason like every other adjustment. The store
remains the authority — the model exists so the screen can **agree in advance
rather than argue afterwards**.

The on-device case checks both: the form refuses to build an over-reversal, and
the store refuses one submitted without the form. A rule enforced in one place
and asserted in the other is a rule with a bypass.

Planted by dropping `reversesEventId` — the field the whole feature is about.
Red in Vitest and red in the on-device contract.

**583 tests.**

## 2026-09-09 — "no purchases until the system is ready"

Jason, on being told the most valuable thing left was to buy something:
*"No purchases until the system is ready. It doesn't make sense to arbitrarily
buy something."*

⛔ **He is right, and the suggestion was wrong on the system's own terms.** The
entire apparatus — gates, scores, a walk-away price, a profit floor — exists to
stop unjustified purchases. "Buy one to exercise the machinery" is a purchase
justified by nothing except wanting to see the machinery run, which is the case
the machinery is built to refuse. Recorded as **D11**.

### And it exposed a real gap

Asking what "ready" means turned out to be productive. The phone has twelve
screens and **not one of them answers the question you actually have standing in
a shop**: *should I buy this, and at what price?*

`buy.tsx` assesses a price already chosen — it says whether a purchase you have
decided on is permitted. `evaluateOpportunity` does the harder thing and it is
already built, tested, and unreachable from the device:

| | |
|---|---|
| `maxPriceCents` | the walk-away number |
| `boundBy` | **which** limit binds — the one to argue with |
| `recommendation` + `reasons` | ordered, headline first |
| buy / risk scores, confidence | how much to trust it |

That is the difference between recording and deciding, and Gate 5's premise is
*the phone is the system*. → **5.9c**, admitted as Category 1: the gate would be
incomplete-for-its-job without it.

⚠️ **It also fixes a second thing.** A purchase made through the scorer carries
an `opportunityId`, so B59's accuracy report counts it as SCORED rather than
QUOTED. Without a sourcing screen the phone can only ever produce QUOTED buys,
and the scored population would stay permanently empty — a split with one side
that can never fill is not a split.

## 2026-09-09 (D12) — how the app values what it finds

Jason: *"I want the app to be smart enough to find and recommend items for me to
purchase."* Then, on the pricing: *"Starter plan would even be okay if we needed
to. 9 bucks is nothing."*

### The crux was never finding — it was valuing

| | |
|---|---|
| **Active listings** | eBay Browse API. Free, open, easy. This is the *finding* half. |
| **Sold listings** | Marketplace Insights — **Limited Release, application-only, individual developers routinely denied.** |
| **Scraping instead** | Closed: since late August 2026 a logged-out sold-items search redirects to sign-in. |

⚡ **And the consequence is sharper than "it would be nice to have".** The scorer's
strongest input is sell-through from sold comps. Without them the fallback is
`estimateFromOperator`, which carries **30% confidence against a 45% gate** — a
refusal we hit for real earlier the same day (`CONFIDENCE_TOO_LOW`). So sold data
is a **precondition for the fund to transact at all**, not an enhancement to
sourcing. That is the system working correctly, and it is also the wall.

### The correction

⛔ **I dismissed the paid route on cost without checking it, and Jason asked for
the number.** Free tier is 100 requests/month at $0 with no card; Starter is
2,000/month at $9. Against a $50 bankroll $9 is 18% of NAV and I had treated
that as decisive — but the free tier is ~3 lookups a day and plausibly enough
for months, and Jason's answer was that the spend is not a constraint anyway.

**A cost objection nobody priced is an assumption, not an argument.**

⚡ **90 days of history is exactly the window `estimateFromComps(soldLast90Days,
activeListings)` takes** — the data drops into the existing input with no
adaptation, which is a real point in this vendor's favour and not a coincidence
worth ignoring.

### What was kept despite the budget

⚠️ These resellers work around eBay's own restrictions and eBay put the login
wall up in August 2026 — the direction of travel is tightening. So: the manual
comps path stays wired, and the fund keeps accumulating **its own** price
history from every sale it records. A dependency that can vanish must not be the
only way the fund can value anything.

## 2026-09-09 — the watchlist that unlocks, and the line on drop bots

### Gate 6.5: an out-of-reach opportunity is not a rejected one

Jason, on the Xbox 25th anniversary drop: *"It's out of my bankroll now but these
types of opps should be known about too."* Then, correcting my first reading:
*"Not even to get 500 by then. I mean that when I DO get 500 as a bankroll it
should be picked up."*

⛔ **I had proposed a savings goal. He wanted a re-evaluation trigger**, which is
a much better idea and a far cheaper one.

Two things found by checking rather than assuming:

- **`WATCHING` is already an opportunity status.** The domain has always had a
  place for "tracked but not acted on"; nothing re-evaluates them as the
  bankroll moves.
- **The per-item cap is a PERCENTAGE of NAV** — `maxCapitalPerItemBps` is 40% in
  BOOTSTRAP, 20% in GROWTH — so the ceiling rises on its own, and *"when does
  this become buyable"* is **computable, not a guess**. `maxAffordableLandedCost`
  already inverts exactly that, folding in deployable capital, the liquid floor,
  category exposure and total deployment.

⚡ **Which corrects the example itself:** a $500 console does not need a $500
bankroll. At 20% per item in GROWTH it needs roughly **$2,500 of NAV** — the
kind of number the operator should never have to work out by hand.

**The shape:** a refused opportunity goes to `WATCHING` with the gate that
stopped it and its unlock NAV; a NAV change resurfaces anything newly cleared.

⚡ **The side effect may matter more than the feature.** It makes growth legible.
"$50 to $100" is an abstraction; *"at $250 these four things become buyable"* is
a reason to compound, stated in the fund's own terms.

⚠️ **And the thing not to smooth over:** a future drop has no comps, so its
expected resale is a forecast, not a measurement. Held as exactly that — a
watchlist of optimistic guesses would quietly become a list of reasons to
overspend. The accuracy report is what eventually says whether the instinct is
calibrated.

### D13: the line on drop bots

Jason: *"bots is a real issue... I'd like for this app to eventually be able to
be competitive in online drops."*

Split in two, because the halves have different answers:

| | |
|---|---|
| **Knowing first** | IN. Stock state, restocks, drop timing, plus a readiness layer — saved profiles, the unlock NAV already computed, one tap to the page with the decision already made. Fights nobody's defences and is most of the edge. |
| **Buying automatically** | OUT. It violates retailer terms, and the penalty is order cancellations, account bans and flagged payment methods. **For a fund that is a capital event** — the accounts and payment rails the whole operation runs on, risked to win one console. |

⛔ Explicitly excluded: CAPTCHA solving, fingerprint spoofing, proxy rotation,
multiple accounts. Written down so it is not quietly relitigated later.

⚡ **The strategy agrees with the boundary**, which is the part worth
remembering: online drops are where the competition is scripts. **In-store
allocation is where it is people — and Jason is in and out of stores all day for
Spark.** That edge cannot be out-automated, and it is the one the drop watchlist
should serve.

## 2026-09-09 (5.9b) — off the phone, and saying only what is observable

`expo-sharing`, added now because the deferral's stated condition had expired:
*"a native module cannot be added blind while no iOS build will start."* The
lane is green, so a green lane is what validates it.

### ⛔ The screen refuses to claim the thing it cannot see

`shareAsync` resolves when the SHEET CLOSES — not when the file arrives
anywhere, and identically if the operator cancelled. The app cannot see which
destination was picked or whether it went through.

So the wording is *"handed to the share sheet"*, never *"sent"*, and the home
screen still says the fund exists on exactly one device. ⚡ **A backup screen
that reported "backed up" on a cancelled share would be the most dangerous lie
this app could tell** — it is the one claim an operator would act on by not
checking.

⚠️ Caught in review: the first version formatted a byte count with
`formatCents`, which would have rendered a file size as `$4.50`. Bytes are not
money, and the money-arithmetic lint only watches for `Cents / 100` — it would
never have seen this one.

---

## 2026-09-10 — 5.9c's before-scan: B58 was true, and the fund had two answers

### The item shrank, then grew somewhere else

5.9c was written as "build a sourcing screen", decomposed into five sub-steps
that collect inputs, compute a ceiling and show reasons. Verifying it against
the code first — the rule for a pre-authored item — found that
`src/server/sourcing.ts` **already is that model**: 248 lines built for the
desktop's `/sourcing` page, with `evaluateForm` producing `maxPrice`, `boundBy`,
`priceFixable`, the ordered reasons and `headline()`, and `tests/sourcing.test.ts`
holding it to "compute nothing of your own". Three of the five sub-steps were
already built. The phone work is rendering it, exactly the shape 5.8 took with
`views.ts`. → **B65**: it MOVES at 5.10 rather than going, like `views.ts`.

Two smaller drifts: the item named **condition** and **hassle** as inputs and
neither is one — `sourcing.ts` pins `hassleBps: 2_000` and `compMedianAgeDays:
45`, and an absent condition takes a pessimistic 40% default. Both move
confidence, so they are real dials rather than omissions, but they are new
financial input surface. → **B64**, Gate 6.

### B58, measured

**B58** had been filed as a suspicion: *"check the two agree before 5.10 retires
the CLI, or the disagreement becomes invisible."* Measuring it rather than
reading it: a 96-case sweep over sell-through, active listings, comps and NAV
produced **64 divergences, in both directions**.

```
sourcing BUY    → buy screen REFUSES   CONFIDENCE_TOO_LOW      (4 cases)
sourcing REJECT → buy screen ALLOWS    BUY_SCORE_TOO_LOW       (60 cases)
                                       never runs at all
```

⚡ **The mechanism is that `assessPurchase` skips any gate whose field is
`undefined`** (`constraints.ts` 214–247). It is the same assessor on both paths —
what differs is the evidence handed to it. `assessQuote`'s candidate carries
**velocity** confidence and **no** buy score; `evaluateOpportunity`'s carries
**composite** confidence — comps, demand, condition and source, weighted — and a
buy score. On identical items the two confidence numbers differed by as much as
**47.5 points** (65.8% vs 100.0%): velocity confidence saturates on sold count
alone, while the composite is still holding a pessimistic default for every
signal nobody supplied.

⚠️ **An optional gate is a gate that fails open, and nothing said so.** The
optionality reads as careful — `sellThroughBps` is deliberately absent for an
operator estimate so the gate abstains rather than failing an unknown, and that
is right. But the same mechanism silently drops the buy-score gate for a whole
surface, and the code cannot tell the two cases apart.

### D14 — one evaluator everywhere

Jason, presented with three reconciliations and the measured cost of each: **one
evaluator.** Both screens gate through `evaluateOpportunity`, and `assessQuote`'s
weaker candidate stops being a decision path.

The two arguments that decided it are the project's own. 5.6 built `quote.ts`
precisely so *"a fund cannot disagree with itself about what it was allowed to
buy"* — and it turned out to be disagreeing anyway, one layer up. **D11** says
the fund does not buy until the system is ready, and *ready means the phone can
decide*; two answers to "may I buy this" is not a decision, it is a coin flip
that depends on which screen you opened.

⚠️ **This is deliberately stricter on a live fund, and the strictness arrives
before the first real purchase rather than after.** A buy typed with no comps and
middling sell-through — 10 sold, 3 active — scores 40% composite confidence
against BOOTSTRAP's 45% floor, and will now be **refused** where today it records
silently. The escape is D4's override, which is allowed and may never be silent.
That is the intended behaviour: the answer to thin evidence is better evidence or
a written reason, not a quieter gate.

The alternatives, and why they lost: adopting **composite confidence only** would
have closed the 47.5-point gap and left the buy-score gate off the typed path,
defensible on the grounds that a buy score ranks candidates and a purchase
already decided on needs no ranking — but it leaves B58 half-true and undocumented
in the code. **Carrying the verdict across** — gating only purchases that came
from the sourcing screen — changes no live behaviour, and keeps two strengths of
the same gate in one app until 5.10 makes the difference invisible.

### 5.9c.0 — built, and what it cost to prove

`src/scoring/purchase.ts` is the bridge, and the layer is forced rather than
chosen: `core` may not import `domain`, so the only place that can see both the
quote and the evaluator is `scoring`. `evaluatePurchase(state, input, identity)`
quotes the purchase and puts it through the full evaluation. Three callers moved
onto it — the phone's buy screen, `cli buy`, and `src/db/screen-scenario.ts`,
which is the on-device control for that screen and would otherwise have proven
the phone works using rules the phone does not use.

⛔ **`assessQuote` was deleted rather than deprecated.** It had three tests, and
a tested export reads as a blessed one — leaving it there is how a future screen
picks it up again. Its tests were migrated to `evaluatePurchase` rather than
dropped: they asserted that the shared path gates a purchase, which is still
true and still worth asserting. `quote.ts` no longer imports `assessPurchase` at
all, so it cannot gate even by accident.

⚡ **Two things the build surfaced that the plan could not have.**

The first: `cli buy` printed the velocity confidence and nothing else, so once
the composite decided, the command could print *"confidence 100%"* and refuse in
the same breath. It now prints the demand term and the overall figure against
its floor, and says when no `--comps=` is why the number is low.

The second: neither screen had anywhere to *put* comps, so under the stricter
gate the only route past a confidence floor would have been D4's override —
which turns the escape hatch into the normal path and empties it of meaning. The
buy screen and `cli buy` both take sold prices now. ⚠️ A bad entry is dropped
rather than defaulted to zero: a $0.00 comp would drag the median and read as
evidence.

### The tests, and the plants

`tests/purchase-parity.test.ts`. The control compares two genuinely different
entry points — the sourcing form a person fills in, and the fields they type into
the buy screen — over a 140-row grid deliberately dense at the edges where the
two confidence numbers straddle a mode floor. ⚠️ **A grid of comfortable items
would have been all green against the broken code.**

⚠️ **One assertion was written vacuous and caught in review.** It compared
`result.confidenceBps` at both doors, which after the fix is true by
construction — a round trip through one encoder. It now compares the number the
GATE used, `results.find(CONFIDENCE_TOO_LOW).actual`, and asserts the loop
actually compared something, because a loop over an empty grid passes silently.

⛔ **Planted three times, once per claim.** Restoring the pre-D14 rule set inside
`evaluatePurchase` reproduced the original symptoms exactly — 8 "recommended BUY,
then refused", 69 "rejected, then recorded clean", 309 gate-name mismatches, and
the confidence gate comparing 1,500 against 3,125. A second plant moved
`FIRE_SALE_BPS` by 100 bps and reddened the economics comparison in 96 places. A
third made the synthetic opportunity id move condition confidence, reddening the
claim that the marker cannot change a verdict. Each restore was verified back to
green by reverse edit, never by `git checkout`.

⚠️ **The economics were never wrong**, and that is now pinned: `quotePurchase`
and `deriveEconomics` agree to the cent across 144 cases. They remain two
implementations — neither can delegate to the other across the layer boundary —
so the test is the only thing keeping them together.

### What it leaves open

**B66.** `assessPurchase` fails **open** by construction: every gate field on
`PurchaseCandidate` is optional and a missing one skips its gate in silence.
That is correct for `sellThroughBps` under an operator estimate — abstain rather
than fail an unknown — and it was wrong for the buy score across an entire
surface. **The code cannot tell the two cases apart, and neither can a reader.**
`validatePolicy` already solved this class on this project by being exhaustive
off a defaults object's keys rather than off a hand-written list; the same
treatment, or a lint, is the fix. Filed to Gate 6 rather than taken here: it is
a change to how every capital gate is declared, and D14 did not need it.

### 5.9c.1 and 5.9c.2 — the screen, and the handoff

The screen is `mobile/app/sourcing.tsx` and it computes nothing: `evaluateForm`
is the model the desktop already rendered, and it goes through the same
`evaluateOpportunity` the buy screen now gates with. It is the first button on
the home screen, above Buy, because that is the order of the decision — work out
whether to buy it, then record that you did.

⚠️ **Nothing evaluates until it is asked for.** A verdict recomputed on every
keystroke would flash "Walk away" at somebody halfway through typing the resale
price, and that is the one phrase this screen must not say by accident.

The handoff carries every field the sourcing screen already asked for, so nobody
retypes seven boxes in a shop, plus two things that are not fields. The first is
`opportunityIdFrom(name, eventCount)` — a new sibling of `itemIdFrom`, minted at
the handoff rather than at the evaluation. ⚡ **The old `aisle-<name>` form could
collide**: it was the name alone, so two "Lego set" scores were one id. Minting
at the handoff cannot, because evaluating changes nothing while every purchase
increments the event count, so at most one scored item can occupy a position.

The second is the ceiling, carried as **already-formatted text**. A screen does
no arithmetic on money, and re-deriving the ceiling on the buy screen would be a
second implementation of the one number the handoff exists to respect.

⚠️ **The asking price travels, not the ceiling.** What gets recorded has to be
what was actually paid; the ceiling is what to negotiate against and nothing
more. Prefilling the box with the ceiling would quietly record a haggle that
never happened.

### The class that was only half asserted

`screen-scenario.ts` had a case pinning that an operator-priced sale reports as
QUOTED, and **no case for SCORED** — a two-class fixture with one class covered.
It would have passed just as happily before a scored purchase could exist at all.
The mirror case now buys through the handoff path, reads the marker back **off
disk rather than off the engine's cache**, sells, and asserts the accuracy view
reports `scoredN: 1, quotedN: 0`.

⛔ **Planted twice, because the first plant reddened too early.** Dropping the
marker from the command failed on the first assertion — "the marker survives the
write" — which left the accuracy assertions unexercised and therefore unproven.
The second plant let the marker through and flipped `accuracy.ts` to classify
everything QUOTED; that reddened `scoredN: expected 1, got 0`. One plant per
claim, not one per test.

### The path filter, wrong for the third time

⚠️ **`driver-contract-ios.yml`'s `paths:` list did not include `src/scoring/**`,
`src/domain/**` or `src/server/**`** — all three are executed by the on-device
screen contract as of 5.8 and 5.9c, and a change to any of them would have
produced no run while looking like a green one. The file's own comment warns
about exactly this, having been written when `src/ui/**` was found missing.

⛔ **It has now been wrong three times, and the reason is structural: the list is
written by hand while the closure is computed.** `npm run lint:phone` discovers
its roots by scanning `mobile/` precisely because every hand-written list of
places to look on this project has come up short. A YAML path filter cannot run
a script, so the fix is to generate it or to trigger broadly and gate inside the
job. Filed as **B67** rather than solved here.

**B68** is the other thing the build surfaced: a score made in the aisle is not
saved anywhere. That is correct for 5.9c — writing opportunities is tier 3 and
still closed — but **6.5's watchlist has nothing to watch until it exists**, so
the two are the same piece of work seen from different ends.

### The gate that was not local — and cost a 15-minute cycle to find

The first device run of 5.9c failed. ⚠️ **"Failed" is a step, not a phase**: the
step was *Typecheck*, not the build, and the error was mine — a dropped
`</View>` in `mobile/app/index.tsx` while moving the Buy button down to make room
for the sourcing button.

⛔ **The point is not the typo. It is that `npm run check` could not see it.**
`npm run typecheck` ran the root config and `tsconfig.web.json` and **never
`mobile/tsconfig.json`**, so every phone screen was typechecked only in CI, on a
macOS runner, fifteen minutes away. CI had the step all along (`cd mobile && npx
tsc --noEmit`); the local command did not, and the local command is what gets run
between edits. A gate that only exists downstream is a gate you do not have while
you are working.

`npm run typecheck` now runs all three configs. ⚡ **Planted**: restoring the
exact dropped tag reddens it locally with the identical `TS17008` CI produced,
and the restore returns to green. The CI step is renamed from "Typecheck both
halves" to "every half (node, web, phone)", and its own `cd mobile` check is
deliberately KEPT — it runs mobile's own `tsc` from mobile's own directory, which
is a genuinely different invocation rather than a duplicate of the root one.

⚠️ **Both of this item's two CI-visible failures were the same shape**: a check
whose scope was written by hand — a `paths:` filter and a `typecheck` script —
while the thing it was meant to cover kept growing. B67 is the filter; this was
the script.

### 5.9c closed — 44/44 on device, and the whole-item after-scan

The re-run passed: **44/44 against expo-sqlite on a real iOS simulator**, up from
43, the extra case being the SCORED class that had never been asserted.

⛔ **B60's trigger did NOT fire, and it matters that the distinction is kept.**
Its condition is *"add `@testing-library/react-native` only if a wiring bug
actually reaches the device"*. 5.9c's failure was a **dropped closing tag** —
structural JSX, caught by `tsc` before any device saw it — not a binding pointed
at the wrong state, which is the class a typechecker cannot see. Reading a syntax
error as the trigger would spend a dependency on evidence that does not support
it. The gap stays named.

**What only the item-level view showed.** Both of this item's CI-visible failures
were the same shape, and so was **B67**: a check whose scope is a hand-written
list, kept next to a thing that keeps growing. Three instances now — the `paths:`
filter, the `typecheck` script, and `lint:imports`' directory list before them.
This project already answered the question once, in `lint:phone`, which discovers
its roots by scanning `mobile/` rather than being told them. The answer just has
not been applied to the other three.

**B68** grew two consequences worth carrying: nothing records a decision to WALK
AWAY, so the system can only ever learn from what was bought — the passes, which
are most of the decisions, leave no trace. And there are now two id conventions
for one concept, `sourcing.ts`'s internal `aisle-<slug>` and the recorded
`opp-<slug>-NNNN`. Both settle when an opportunity record actually exists, which
is 6.5.

### Replenishment — 5.11 is the active build

⚠️ **It is the only unblocked item in Gate 5.** 5.5 needs Jason to move the fund
and 5.9 needs him to add the repo in Codemagic; **5.10 must not start until the
fund has actually moved**, because `cli export` is how it gets onto the phone and
5.10 deletes the CLI. That leaves the phase after-scan, which is mandatory at a
phase boundary anyway and has real content: two repeating patterns to sweep for,
and 5.9c's lessons to apply backwards to screens that shipped before them.

### 5.11.1 — the stale-scope-list sweep, and the distinction it turned up

Three instances of one shape, all closed.

**The money-arithmetic sweep** iterated a hand-written list of the places screens
live — while the comment directly above it told the next reader to *"search the
tree, or at minimum re-read the list every time a directory is born."* The code
did not do what its own comment said. ⚠️ **Measured before changing anything:
the list was not actually short today** — every `.tsx` directory sits under a
swept root — so this was structural risk, not a live defect, and it is now
inverted: sweep everything under `src/` and `mobile/`, exempt `src/core/` where
money arithmetic belongs. Sweeping the whole tree produced **zero** new
violations, so behaviour is identical today and different the day a directory is
born. Planted in `src/scoring/`, a directory the old list never looked at: the
new sweep flags it, and the old list is **blind to it**.

**An undeclared layer was silent.** `src/adapters` has existed for the whole life
of this gate with no `FORBIDDEN` entry — named in other layers' forbidden lists,
carrying no rules of its own, so it could have imported `node:sqlite` or
`src/cli` freely. It happened to be **empty**, so nothing was violated; the gate
simply had no opinion and would not have gained one when a file appeared. Any
`src/` directory containing source must now be declared, restricted or
deliberately unrestricted. Planted by dropping one file into `src/adapters`.

**B67 is closed, and not the way it was filed.** The filing assumed the fix was
to generate the YAML. The better answer was to make the hand-written filter
**answer to** the discovered closure: `check-phone-bundle.mjs --print-layers`
emits the `src/` layers the phone transitively reaches, and
`tests/ci-scope.test.ts` fails if the `paths:` filter misses one. ⚠️ Printed
from the whole closure, not from the roots — `src/domain` is reached only
*through* `src/scoring`, so a filter built from direct imports would miss it for
exactly the reason the one-level import lint missed `views.ts`. ⚠️ And the test
parses the `paths:` **block**, not the file: every one of those directories is
also named in a comment there, so a grep would have passed while asserting
nothing. Planted by removing `src/scoring/**` and leaving the comments.

### ⚡ The distinction worth keeping

Not every hand-written list is a defect, and a later pass should not "fix" the
one that is correct. **A list of WHERE TO LOOK goes stale in silence** — a new
directory is simply not checked and nothing says so. **A list of WHAT IS SAFE TO
READ fails safe** — `check-source-bytes.mjs` enumerates source extensions
precisely so it does not read a PNG and report its bytes as control characters;
inverting that one would break it. The test is which way the omission falls:
toward *not checking* something, or toward *not trusting* something.

## 2026-09-10 — 5.9 shipped, and the export was a leak waiting for one `git add -A`

**Codemagic built and published on the first run**, which is what 5.9 said that
run would be: the validation pass. Hermes pin, `expo prebuild`, signing, IPA,
TestFlight upload — the whole lane, adapted from `debt-app-v1`, correct first
time. The one thing verified from here beforehand was the generated project name:
`codemagic.yaml` hardcodes `ios/ResaleOS.xcodeproj`, and rather than trusting the
comment that said so, the GitHub Actions log was checked for what `prebuild`
actually emits — `ResaleOS.app`, `.xcodeproj`, `.xcworkspace`. It matched.

⚠️ **The 80-day rebuild is NOT a scheduled workflow.** The plan assumed a second
Codemagic workflow with a `triggering:` cron. Jason deploys manually, so it is a
**date obligation**, and this repo already has the right home for those — the
Recurring table, built precisely because "a recurring obligation with a checkbox
gets ticked once and then never fires again". ⚠️ I could not verify whether
Codemagic even schedules from `codemagic.yaml` (web search was unavailable), and
**declined to write a recurring job on an unverified premise** — which is the
same reasoning that held the cron back in the first place.

### ⛔ The export carried the tax profile into an untracked-by-nothing path

About to generate the export to make 5.5 one step, I checked where it lands
first. **`cli export` defaulted to `resale-export.json` in the repo ROOT**, and
`.gitignore` covered `data/*.db` and `data/backups/` — **not** `*.json`, and not
the root at all.

The payload is the commands **plus `config`**, and `config` carries
`tax_profile`. Verified by running an export to a temp path outside the repo and
printing the **keys only**: `policy, tax_profile, tax_tables_acceptance,
backup_settings, backup_state`.

⛔ **So the documented way to move the fund onto the phone was one `git add -A`
from publishing a real person's filing status, income and county on a public
repo — permanently, because GitHub keeps objects fetchable by SHA.** That is
**B56's exact class**, and B56 already cost this project a whole fresh repository.
It had not recurred; it had simply never been closed on this path.

Fixed in two layers, because one is a rule somebody has to remember: the default
now writes into `data/` (already the home of the non-committable things), and
`.gitignore` gained `data/*.json` and `*-export.json` so a `--to=` pointed
anywhere else is still caught. Both verified with `git check-ignore`. The rule is
recorded in `CLAUDE.md` next to the tax-profile rule it belongs to: **an export
is not a document — it is the ledger plus the profile.**

⚠️ **Worth noting how it was nearly missed.** The plan called generating the
export a convenience step to unblock Jason. Checking where a file lands before
writing it is not a step that appears in any plan; it appeared because the
payload's contents were checked first rather than after.

## 2026-09-10 — the fund reached the phone, and the desktop became a second head

**5.5 is done.** 55 events exported, carried across and imported on device, every
regenerated hash compared against the exported one. That is the whole design of
`portable.ts`: a fund travels as its COMMANDS because everything else is derived,
and the destination replays rather than copies, so a single byte of divergent
engine behaviour refuses the import instead of accepting something unverifiable.

⛔ **And the moment it landed, this project had two live ledgers.** Same 55-event
history, both writable, and `cli status` on the desktop still answers cheerfully
with $50.00. Checked: **nothing guards the desktop CLI's write path.**

The append-only design is what makes this sharp rather than annoying. One
recorded event on either side and the chains diverge at that point forever;
there is no merge, and `importLedger` refuses a mismatch **by design** — so the
one tool built to move a fund between machines is precisely the tool that cannot
repair a fork. The safety property and the hazard are the same property.

⚠️ **The window is not short, which is why it needs a guard rather than haste.**
The natural fix is 5.10, which retires the desktop entirely — but 5.10's deletion
is gated on a backup actually leaving the phone, and that needs Jason. So the
fork window stays open for as long as that takes, across session boundaries,
while `cli` remains the interface documented in several places. That is exactly
the shape of thing that gets used by accident.

### Re-sequencing

5.11 was promoted to the active slot only because 5.10 was blocked; that is no
longer true, and a phase after-scan running before the phase's last item is out
of order. **5.10 takes the slot**, 5.11 returns to being the closing item, and
its remaining sub-steps live here rather than on the plan:

- **5.11.2** Apply 5.9c's lessons backwards to already-shipped screens — every
  surface that gates, classifies or reports, checked for the fails-open shape
  (**B66**) and for a class asserted in only one direction (the SCORED/QUOTED
  miss was exactly that).
- **5.11.3** Reconcile the accumulated-deferral ledger: B62–B68 and everything
  filed earlier in the phase, each confirmed still true, still needed, and
  pointed at a real gate.
- **5.11.4** Gate 5's exit criteria to the log, and the start-here docs made to
  match the code. ⚠️ Known stale already: `CLAUDE.md` still says "463 tests",
  "four gates", "43/43" and "Gate 5 nearly done".
- **5.11.5** ⛔ **NOT RNTL.** B60's trigger is *"only if a wiring bug actually
  reaches the device"* and it has not fired.

### 5.10.1 — the fork is shut

`data/resale.db` now refuses to record anything. Writes exit 1, reads still run,
and the live ledger sits at the 55 events it had when the fund left.

**Three decisions inside a small guard.**

⚠️ **The marker is a FILE beside the database, not a `config` row.** A row was
the obvious place — until `exportLedger` is read: it carries the **whole**
config table, and `importLedger` writes **every** key. A `retired` row would have
travelled with the next export and **retired the live fund on arrival**. The
trap is that this would have looked correct in every test on this machine.

⚠️ **Reads stay open, deliberately.** Until a backup has actually left the phone,
this database is the fund's only other copy; `verify` and `export` are the
recovery path. Retiring it is about stopping a *fork*, not about destroying the
last thing that could restore the fund. Locking reads too would trade a fork
risk for a loss risk, which is a worse trade.

⛔ **The allowlist names what may RUN.** A banned-command list admits every
command nobody thought of; this refuses them. Same lesson as 5.11.1 — what
matters is which way the omission falls — and it is asserted directly: `policy
adopt-defaults` is refused without ever being named.

**Planted twice, because the four claims are not one claim.** Removing the guard
reddened three, *including* "leaves the ledger untouched", which is the one that
proves the guard runs **before** the write rather than printing a refusal after
it. That left "reads still work" green — correctly, since with no guard reads
obviously work — so it got its own plant: ignoring the allowlist reddened exactly
that claim and no other.

⚠️ **The suite gets its own ledger and its own temp directory.** The existing CLI
suite shares one database across cases; a retirement marker dropped on it would
have leaked into whatever ran next in file order.

⛔ **And I broke the project's own rule getting here.** The test was written
through a Python heredoc and `\n` inside a string literal became a **real
newline**, producing an unterminated string. `CLAUDE.md` already says it, from
three prior incidents: *writing about escape sequences through a Python script
puts control bytes in the file — use a raw string, or the Edit tool.* The
transform error caught it instantly, which is the cheap end of that failure; the
`\b`-in-a-regex version cost a build.

### 5.10.3 — the two files that outlive the desktop

`src/server/views.ts` and `src/server/sourcing.ts` are now `src/screens/`.
B62 and B65 closed. The name carries the principle this project already had and
had only ever applied to one file: **the screen's decisions live outside the
`.tsx`**, because that is where they can be tested when there is no browser and
no device. Both survive because the phone renders them; the other six files in
`src/server` — auth, binding, feed, inventory, screens, store — are web-only and
die at 5.10.4.

They moved to the same directory depth, so their own relative imports were
untouched. `sourcing.ts` needed only `money` from `views.ts`, so the pair is
self-contained and reaches nothing else in `src/server`.

### ⚡ Both new gates fired on cue, and one of them earned its keep in an hour

**The undeclared-layer check** — written earlier the same day in 5.11.1, after
finding `src/adapters` had existed with no rules — demanded that `src/screens`
declare what it may import before the build could go green. That is the check
working exactly as designed: a new layer red-gates while it has two files rather
than forty.

**And `tests/ci-scope.test.ts` caught B67's failure mode by itself.** The moment
the files landed in a new directory, `src/screens` was on the phone's transitive
closure and absent from the lane's `paths:` filter — meaning a change to the
sourcing screen's model would not have triggered a device run, while showing
green. **That filter has now gone stale three times; this is the first time
something other than a person noticed**, and it was one hour after the control
was written.

⚠️ **My own site list undercounted, again.** Grepping for who imported the moved
files matched the path shape `server/views` and missed the **sibling** imports —
`feed.ts`, `inventory.ts` and `screens.ts` each import `'./views.js'`, four
references in three files, invisible to that pattern. Typecheck named all four
immediately. Same lesson as the `truncated-search-hides-a-class` and
`audit-site-lists-undercount` cases: **the enumeration is the thing that fails,
not the fix** — search for the symbol, not for the path you expect.

### 5.10.4–.6 — the desktop is gone

**3,295 lines deleted**: `src/cli`, `src/app`, the six remaining `src/server`
files, and the six test files that only covered them. 597 → 522 tests, all
green. Nothing outside those directories imported them — checked before
deleting, not after.

⚠️ **Two things were checked rather than assumed, and one of them mattered.**
`tests/screens.test.ts` imports `dashboardView`, which SURVIVES — but only as
*input* to `primaryScreen`, so `views.test.ts` still covers the survivor and
deleting it lost no coverage. And `feed.ts` encodes a genuinely subtle rule —
*an unscored row is not stale; that is a different fact* — which would have gone
with it. It survives because `CLAUDE.md` already states it: **the knowledge
outlives the code**, which is the whole reason that section exists.

⛔ **`git rm` is all-or-nothing, and it aborted.** One of the six prune paths
(`next-env.d.ts`) was gitignored, so the command failed and deleted **none** of
them — and `npm run check` went green anyway, because `package.json` no longer
referenced any of them. **A green that meant "nothing happened".** Caught by
listing the files afterwards instead of trusting the exit. The same shape as the
plant-verification rule: confirm the change landed, not just that the suite is
happy.

Runtime dependencies are now **`@noble/hashes` and `zod`**. Next, React,
react-dom and Tailwind are gone.

### The docs were telling a new session to run a deleted CLI

`CLAUDE.md` carried **15** references to deleted code — a Commands block
pointing at `npx tsx src/cli/index.ts`, an auth-gate rule about `withStore`, a
dev-server binding rule, a Turbopack pin, `tsconfig.web.json`. In a start-here
file that is worse than stale: it is instructions to do impossible things.

Swept in the same item that caused it, and the dead bullets were **cut rather
than annotated** — narrating a deletion is how a lean document regrows. What
survived is the part that outlives the surface: the dev-server incident keeps
*never plant a side effect in a file anything might execute* and *a type is a
compile-time promise only*, without the `withStore` specifics.

⚠️ **`README.md` still carries ~14 and it is a PUBLIC repo.** Left to 5.11.4
deliberately rather than done badly at the end of a long item.

⚠️ **A python `print()` of a `⛔` killed a script mid-run** — cp1252 console
encoding — and it threw *before* the `write()`, so that pass changed nothing
while looking like it had failed halfway. The stale-reference count appeared to
drop only because the next grep used a narrower pattern. **Two near-misses in
one item from trusting a command's appearance over its effect.**

### 5.10 closed — 44/44 on device with the desktop deleted

The device run over the deletion commit passed **44/44**. That is the assertion
that matters: not that the desktop code was removable, but that **removing it
changed nothing the phone does.** The same 44 cases that passed before the
deletion passed after it, against Apple's SQLite, in Hermes.

**Gate 5's exit is met on all three clauses.** The fund lives on the phone; it
knows its exact position offline, derived from the ledger on the device with no
network and nothing carried from a desktop; and the desktop is gone.

⚠️ **What Gate 5 actually turned out to be.** It was planned as a port — move
`core + scoring + domain` unchanged and wrap them in screens. That part held
exactly as predicted: 4,878 lines of pure TypeScript moved with **zero edits**,
and `node:sqlite` really was confined to one file, as `ASSUMPTIONS_AND_RISKS` A1
said it would be. **The work that was not planned was all of the other kind** —
a hash chain quietly importing `node:crypto`, four platform couplings inside the
store, a save format that had to be proven against a second driver, two screens
that gated a purchase differently, an export that carried a tax profile into a
public repo, and a CLI that could fork the ledger the moment the fund left. None
of those were portability problems. **They were things the port made visible.**

### 5.11.2 — 5.9c's lessons, applied backwards

The SCORED/QUOTED miss was *a class asserted in only one of its directions*.
Rather than re-read screens looking for more of those by eye, the shape was
turned into a sweep: extract every string-literal union in `src/`, and check
which members never appear anywhere in the test corpus. **11 unions scanned, 3
with partially-untested members.**

Two were small. `MARKETPLACES` never tests `MERCARI` — currently unreachable
config, since no screen offers a marketplace choice. `BuyScoreCap` never tested
`NONE`, which is the **ordinary** case: both caps were asserted and "not capped"
was not, so a change that always applied a cap would have passed. `recommend()`
branches on `boundBy === 'NONE'` to decide whether to tell the operator what held
the score down, so a wrong NONE is a wrong sentence in front of someone holding
the object. Now asserted.

### ⛔ The third was not small: two of four verdicts cannot happen

`recommend()` returns BUY, WATCH, PASS or REJECT. **15,360 evaluations across
NAV, price, gross, sold, active, hassle and comps produced BUY and REJECT only.**

⚡ **The mechanism was proven rather than argued.** Every score threshold the
recommender checks — buy score, risk, confidence — is *also* a capital gate in
`assessPurchase`, reading the identical field from the identical `ModePolicy`,
and `recommend()` short-circuits to REJECT the moment any gate fails. Reaching
WATCH/PASS therefore needs every gate to pass *while* a score falls short, which
is a contradiction. **Planted: disabling the buy-score gate made the verdict set
become `['BUY', 'PASS', 'REJECT', 'WATCH']` immediately.**

⚠️ **What that means for the product, which is the real finding.** The Buy Score
and the Risk Score are computed, displayed, stored — and **never decide
anything**. Anything they would have rejected, a gate rejected first. They are
instruments, not judges. `SCORING_SPEC` does not say that.

**The alternative was considered and NOT recommended.** Removing buy score and
risk from the hard gates would make WATCH real — *"close, but not yet, and it
would qualify at $X"* is exactly the aisle answer, and it is the natural verdict
for **6.5**'s watchlist. ⛔ But those same gates are what `evaluatePurchase` uses
to decide whether a purchase may be RECORDED (D14). Loosening them would let the
buy screen accept a low-scoring purchase with no override — **partially undoing
D14 a day after it was settled.** And 6.5 does not need WATCH: its own wording is
*"carries the NAV at which it clears every gate"*, which is computed from gate
failures directly.

So the gates stay, the verdict set stays two, and the four members stay declared
because stored rows carry them. `tests/verdict-reachability.test.ts` pins the
**invariant** — if a threshold ever leaves the gates and stays in the
recommender, it fails, and the branch gets reviewed instead of quietly coming
alive with a reason string nobody has read.

### 5.11.3 — the deferral ledger, checked against the code rather than re-read

54 open items. **19 were wrong**, and the errors fell into three kinds.

**Three were stale duplicates sitting beside their own closures.** B1, B2 and
B15 each appeared twice: once struck through and closed, once still open in its
original wording. Nobody deletes the row that was waiting — the closure gets
added and the original survives. That is the decay mode of every list like this.

**Eight were moot**, describing surfaces deleted hours earlier: the CLI's
experimental-SQLite warning, the dashboard's missing browser render, the
dashboard being stale after a CLI command, an insecure session cookie, an
unrate-limited password gate, a web sourcing page recomputing from a URL, and
`assessQuote` disagreeing with the evaluator — that last one settled by D14.

**Eight had premises that MOVED rather than died**, and re-pointing them is the
part a re-read would have got wrong. The rejection histogram is still worth
having, but on the phone and behind B68. `B52` was half stale — the `ledger`
screen it says is missing has existed since 5.8. `B38`'s Turbopack half died with
Next.js while its Metro half is load-bearing. `B17` — *back up `data/resale.db`,
the one unregenerable file* — is answered, because that file stopped being the
fund; but its real half survives as **B32**, now about the phone.

### ⛔ And it found a live regression: the fund's rules cannot be changed

`FundStore` still exposes `setPolicy` and `setTaxProfile`, and **nothing outside
the test scenarios calls either.** `policy set`, `policy adopt-defaults` and `tax
profile set` went with the CLI at 5.10; the settings page went with the web; no
screen replaced them. The engine kept the capability and the product lost the
door.

⚡ **It compounds with two rules this project had already learned and written
down.** *Policy lives in the DATABASE, and `ensureSeeded()` only writes when the
row is absent* — so editing a default in `policy.ts` now cannot reach the live
fund by any route at all. And *a repair path must not depend on the broken
thing* — except the repair path is now the missing thing, which is the same
lesson one turn further out.

⚠️ **Nothing breaks today**, which is exactly why it needed finding rather than
waiting: mode is derived by replaying the NAV series, and the $100 set-aside
threshold is already stored. It bites the first time a number has to change —
and **B26 is already open and needs the state marginal corrected.**

Filed as **5.12** with numbered sub-steps rather than as a backlog row, because
it is version-blocking: a fund whose rules are frozen is not a fund the operator
controls. ⚠️ It also means **Gate 5's exit criteria were incomplete** — "the
desktop is gone" was met while a thing only the desktop could do went with it.
The phase after-scan is the only pass that could have caught that, which is the
argument for the rule.

### 5.11.4 — Gate 5's exit criteria, and the docs made to match the code

**Gate 5's exit, clause by clause.**

1. **The fund lives on the phone.** 55 events exported, transferred and imported
   on device on 2026-09-10, every regenerated hash compared against the exported
   one. `data/resale.db` is a retired snapshot and refuses to write.
2. **It knows its exact position offline.** Every figure on every screen is
   derived from the ledger on the device at that instant — no snapshot, no sync,
   no network. That was Jason's constraint on the whole gate: *"the app should
   be smart enough to exactly know my current bankroll."*
3. **The desktop is gone.** `src/cli`, `src/app`, `src/server` — 3,295 lines —
   plus the Next.js surface. Runtime dependencies are `@noble/hashes` and `zod`.

Proven by **44/44 against Apple's SQLite** in CI on the commit that deleted the
desktop: the same cases passed before and after, which is the assertion that
matters. Shipped to TestFlight on Codemagic's first run.

⚠️ **The exit criteria were incomplete, and the phase after-scan is what showed
it.** "The desktop is gone" was satisfied while a capability only the desktop
had went with it — nothing can change the fund's policy or tax profile. That is
**5.12**, and it is the honest reason Gate 5 is *built* rather than *closed*.

**`README.md` is rewritten.** It was a CLI tutorial for software that no longer
exists: fourteen command examples, a ranked-feed walkthrough, a backup-config
recipe, and a factual error — it claimed the tax tables were 2025 figures marked
`verified: false` when `DEFAULT_TAX_TABLES` has been the **verified 2026** set
since 4.6. On a public repository that is the file people read first.

The conceptual content survived almost entirely, because it was never about the
CLI: derived hold time, gross-versus-net, verify-then-promote, three profit
numbers kept apart, the seven rules, the account model. What changed is the
surface those ideas are demonstrated on. ⚡ And the hold-time formula gained the
inversion that makes it usable in a shop — **sold >= 4.3 x (active + 1)** to
clear BOOTSTRAP's 21-day ceiling.

### 5.11.5 — not RNTL, and why that is a decision rather than a deferral

⛔ **`@testing-library/react-native` is NOT being added.** B60's condition is
Jason's and it is precise: *add it only if a wiring bug actually reaches the
device.* It has not fired.

The temptation to call it fired came from 5.9c, where the first device build
failed on `mobile/app/index.tsx` — but that was a **dropped closing tag**, which
`tsc` caught before any device saw it, not a binding pointed at the wrong state.
A typechecker cannot see the second kind and that is exactly what RNTL would be
for. **Reading a syntax error as the trigger would spend a dependency on
evidence that does not support it**, and the gap stays named instead.

⚠️ What actually covers the screens is worth restating, because "no RNTL" reads
like "untested": the form models are pure and tested in Node, the screen models
live in `src/screens/` and are tested where there is no browser and no device,
and `screen-scenario.ts` executes the whole sequence a person performs against
Apple's SQLite on a simulator. **What none of them see is whether the price box
is bound to `price`.** That is the gap, it is one file's worth of risk, and it
is named rather than guessed at.

## 2026-09-10 — 5.12: the rules can be changed again

`src/ui/settings.ts` and `mobile/app/settings.tsx`. Per-item cap, minimum profit
and hold ceiling for the active mode; adopt-defaults; and the tax profile.

**Three things it does that a plain form would not.**

⚡ **It shows what the two numbers multiply into, before saving.** A profit floor
and a per-item cap imply a required multiple that neither one states — a $100
floor against 40% of a $50 NAV demands 7.2x on every flip. That combination is
how a fund silently stops being able to buy anything, and it already cost this
project a day. `assessProfitFloor` was written for it; now it runs against the
*edited* policy while the operator is still typing.

⚡ **It warns when the stored version has drifted from the code's**, because that
is the only thing that can detect it. Policy lives in the database and
`ensureSeeded()` only writes when the row is absent, so a stored policy older
than the code keeps running old numbers in silence — a $100 floor once passed 139
tests while the live fund still ran $8. Every edit bumps the version for the same
reason.

⛔ **The repair path opens against a broken value.** `taxFieldsFrom` reads
tolerantly and is asserted against an unconfigured profile, a malformed one and
no profile at all — because the screen that fixes a bad profile must not refuse
to open against one. That exact failure shipped **twice** here: `policy
adopt-defaults` and `tax profile set` both validated the stored value before
replacing it, so the one command that could fix a stale config could not run
against one.

**The door is narrow on purpose.** `setPolicy` and `setTaxProfile` are two
methods on the provider, not two more capabilities on the ledger's door — the
shape the Gate 4 decision warned about, where `withConfigStore` was kept separate
from `LedgerReader` precisely because widening invites one more each time. They
refresh like `commit` does, and they trigger a backup: config is not an event and
does not move the hash chain, but the backup carries `config`, and **a rule
change nobody backed up is a rule change that dies with the phone.**

⚠️ **Proven by a SECOND store reading the database.** `store.state()` answers
from a cache, so re-reading through the writer would be the engine agreeing with
itself — B54's exact failure. The scenario opens a fresh `FundStore` over the
same `db`, and asserts the new ceiling is there, the *other* mode was not quietly
rewritten, the version moved, and **no money moved and no event was recorded.**
Planted: making `setPolicy` persist the old value reddened it with *"the new
ceiling is on disk: expected 30, got 21"*.

### 5.12's after-scan, and what Gate 6 opens with

⚠️ **A defect I introduced, found by probing rather than reading.** The version
bump appended `+edited` unconditionally, so four edits produced
`2026-09-08.5+edited+edited+edited+edited` and it grew without bound. A version
string is what a person reads when deciding whether to adopt defaults; an
unreadable one is a warning nobody acts on. It counts now — `+edited`,
`+edited2`, `+edited3` — and a test asserts the string contains "edited" exactly
once after five edits.

**B73** is the honest limit of 5.12: it edits three fields of the ACTIVE mode.
The other mode cannot be set before the fund reaches it, and the whole
`allocation` block — the owner split and the set-aside threshold — has no screen
at all. ⚡ **That block is what D2 needs**, and D2 is due at $100 NAV, four to six
flips away.

### Gate 6 takes the active slot, and 6.0 is deliberately not the API

The data route is settled (D12) and the interesting half of it is **gated**:
Marketplace Insights is Limited Release, individual developers are denied, and
the logged-out sold search hit a login wall in August. Without sold comps the
45% confidence gate refuses nearly every purchase — so that work is a
precondition the project may or may not win.

⛔ **Which is exactly why it does not go first.** Three already-filed items make
the aisle screen usable with no external dependency, no key and no quota, and
they serve the strategy Jason actually named — Walmart clearance racks:

**B70** is the one with the best ratio in the whole backlog. `soldNeededForHold`
is already in core, already tested, and CLI-only — so the phone says
HOLD_TOO_LONG without saying that ten competing listings need 48 sold in 90 days
to clear it. That number *is* the sourcing rule for retail arbitrage, and it is
one line away from the screen being held at the rack.

**B64/B71** matter because of D14. Sealed retail stock deserves high condition
confidence and currently takes a pessimistic 40% default, dragging the composite
against a gate that just got stricter — the one case where confidence should
legitimately be high is the case being sourced.

**B68** is the precondition for two later things at once: B3's rejection
histogram has nothing to count and 6.5's watchlist has nothing to watch until an
aisle decision is recorded somewhere.

### 6.0.1 — the screen names the fix

`SourcingVerdict` carries `holdFix`, and the screen prints it when
`HOLD_TOO_LONG` bites: *"Against 10 listed, you need 48 sold in 90 days to clear
the 21-day ceiling."* Closes **B70**.

⚡ **It follows the MODE.** The ceiling comes from the bankroll-derived mode, so a
$500 fund is told **17** where a $50 fund is told **48**. The number an operator
needs is not a constant, and printing one would be wrong for most of the fund's
life — which is the argument for deriving it rather than documenting it.

⚠️ **Asserted as EXACT rather than as the formula.** The obvious test — compare
the output to `90 * (active + 1) / ceiling` — is a round trip through one
encoder: it restates the implementation and cannot fail. Instead the test buys at
exactly the number and one below it, across five listing counts, and asserts the
hold gate clears at N and refuses at N-1. **A rounding error either way makes the
screen tell someone to walk away from a buy, or to chase a refusal.** Planted by
turning `ceil` into `floor`: three claims red.

⚠️ **A wrong expectation of mine, corrected by the test rather than shipped.** I
asserted a 21-day ceiling against a fixture that is a **$500** fund — which is
GROWTH, and 60 days. The test failed with *"expected 60 to be 21"*, and the fix
was the expectation, not the code. It became the second case: the number must
follow the mode, and now both are pinned.

### 6.0.2 — condition and hassle, and a vacuous test of my own

`src/screens/condition.ts` turns two judgement calls into words: **Sealed /
Like new / Used, checked / Not sure**, and **Envelope / Normal box / Bulky or
fragile / Heavy or oversize**. Closes **B64** and **B71**.

⚠️ **The scales are anchored, not invented.** Each passes through the value the
system already used, so the default option reproduces today's score exactly and
nothing moves underneath the operator. Everything above and below is a stated
opinion about evidence quality, in one file, changeable in one place. ⛔
Confidence is data quality, never optimism — `SEALED` scores high because you can
see what the thing is, not because it is worth more, and the test asserts the
expected profit and the price ceiling are **unchanged** by it.

### ⛔ "Not sure" is NULL, and my own test could not have told me

The first version mapped `UNKNOWN` to 4,000 — the same number
`CONFIDENCE_DEFAULTS.conditionBps` uses when nothing is supplied — and I wrote a
test asserting that omitting the field and choosing "Not sure" score identically.
**It passed, and it was vacuous**: once both options went through the same line,
the two calls were the same code path and the assertion could not fail.

The **existing** field-for-field test against `evaluateOpportunity` failed
instead, with *"expected 24 to be 23"*. The reason is a real distinction:
`scoreConfidence` treats an explicit 4,000 and an absent value alike, but the
**risk score inverts the field**, where `null` means *no information* and 4,000
means *40% certain*. Those are different facts and the risk score is right to
tell them apart.

So "Not sure" passes `null`, and the vacuous test was replaced with one that
compares against the evaluator **directly**, built from the fields the form used
to send. ⚡ **The lesson is the one this project keeps relearning from a new
angle:** a control whose two sides come from one source cannot fail — and here
the two sides became one source *as a result of the change being tested*, which
is a way for a test to rot that reading it would never reveal.

### 6.0.3 — checking is recording

Pressing **Check it** now saves the scored opportunity. Closes **B68**.

⚡ **The walk-aways are the point.** A REJECT is most of what an operator does in
a day, and until now every one of them vanished the moment the screen was
closed. **B3**'s rejection histogram — *which gate is actually binding* — had
nothing to count, and **6.5**'s watchlist had nothing to watch. The on-device
case deliberately scores a candidate that FAILS and asserts the refusal is what
gets stored, with the policy version that produced it.

⛔ **The score is stored, never recomputed.** That was already the rule for the
feed and it survives the feed: re-running today's policy over an old row would
show a number that was never the reason for any decision.

The screen changed shape to make this honest. The verdict used to recompute from
a `useMemo` on every keystroke; it is now evaluated once, held, and **retracted
the moment any field is edited**. Saving inside a memo would have written a row
per keystroke, and a stale verdict on screen next to edited inputs is a different
kind of lie.

⚠️ **Read back through a SEPARATE reader**, not the object that wrote it, and
asserted to move no money. Planted by making `save` a no-op: *"the score should
be on disk"*.

### ⚠️ 6.0.5 — and the thing this immediately created

**Scored opportunities are not in the backup.** `exportLedger` carries the
COMMANDS and the config, because that is all a fund is — everything else is
derived. But the `opportunities` table is neither, and it is **not derivable**:
it records what was decided, when, under which policy version. So from today the
phone accumulates decision history that no backup preserves, while the money it
holds is fully protected.

That is a genuine fork in the design and it is filed as a **[DECISION]** rather
than answered quietly: either the export grows to carry them — a
`LEDGER_EXPORT_VERSION` bump, with an import that tolerates an older file — or
scores are honestly device-local and the app says so. **The first is more work
and makes the export no longer "just the commands", which is the property that
makes it verifiable by replay.** Worth Jason's call, not mine.
