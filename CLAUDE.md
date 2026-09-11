# Resale OS — start here

Private resale intelligence and capital management system. One operator, real
money, no SaaS, no App Store, no multi-user.

**⚠️ `MASTER_PLAN.md` is the queue and the point of truth for what to build
next.** Exactly one item is decomposed on it — the active one. Detail and
rationale live in `MASTER_PLAN_LOG.md`; read the entry for anything you are
about to change.

**Status (2026-09-11): Gates 1-6 BUILT and 6.5-6.11 closed. The fund LIVES ON
THE PHONE, the desktop is deleted, the app VALUES what it is shown, and it now
SCANS. ⚡ Gate 7.5 — DROP INTEL — is the active build: 7.5.1-7.5.4 closed, so the
app now HOLDS a drop calendar and judges it; next is the release-feed adapter
(D19).**

⛔ **NOTHING BUILT AFTER 2026-09-10 IS ON THE PHONE.** Every gate above shipped
to `origin/master` and **the last TestFlight publish was 2026-09-10**. The
device is running a build with no data route, no scanner and no allocation
screen. **The deploy is deliberately last** (Jason 2026-09-11: *"It'll be more
meaningful once 6.11 and 7.5 are there"*), but nothing decided since is
actionable until it happens.

⚡ **D11's condition reads as met** — it said the fund starts buying when the
phone can *decide*, not just record, and it now decides with data it fetched
itself. **Whether it starts buying is Jason's, and he has not said so.**

🎯 **AND THE STRATEGY IS NOT THE CLEARANCE RACK** (Jason 2026-09-11): *"Most of
my highest returns were not off the clearance rack previously. They were online
drops."* ⛔ A new session must not optimise for racks. Scanning is the tool for
*"I am holding this"*; **drops are where the money was**, and Gate 7.5 is that.

The aisle screen **decides**: a price ceiling and the rule that set it, what would
FIX a refusal (*"against 10 listed you need 48 sold in 90 days"*), whether a
refusal is **not yet, at $150** or **never at any bankroll**, and it records every
decision — the walk-aways most of all. Plus *what is stopping you* over the
record, a watchlist of refusals that expire, and a settings screen for the rules.

⚡ **And it looks the market up.** *Look up the market* fills the sold and active
counts and the comps from SoldComps, says which market it measured, and shows
what is left of the month. ⛔ **The network never gates**: offline is the normal
case in a shop, every failure is a value, and a failed lookup leaves the screen
exactly as usable as it was.

⚡ **And it scans.** Barcode → UPCitemdb → a keyword that is **proposed and
editable** → market → verdict, with the tag price the only typed field.
⛔ **A scan proposes and never decides**, for two measured reasons: two
defensible keywords from one barcode gave sold medians **68% apart** (**B89**),
and `000000000000` resolves — HTTP 200 — to *"ORGANIC BLUE CORN TORTILLA
CHIPS"*, so a mis-scan succeeds *wrongly*. The title on screen beside the object
in hand is the only check on that, and it is the operator's.

Live on a real **$50** bankroll — ⏳ **$75 decided, awaiting a $25 CONTRIBUTION**
(**D3**). **788 tests, 48 files.** `npm run check` runs **six** gates: source
bytes, import direction, phone bundle, **the PLAN**, typecheck, tests.

---

## Where things stand — read this first

⚡ **The fund is live, real, and ON THE PHONE.** $50 of actual money. The app
holds the ledger; it is backed up on-device after every write, and a copy has
been shared off it. `data/resale.db` is a RETIRED snapshot at 55 events — it is
history, not the fund.

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

⛔ **GATE 7 IS PARKED AND RE-PREMISED (D17, 2026-09-11).** Market Radar assumed
a feed; **D16 deleted the finding half**, so its input would be one metered
vendor at 2 requests an item. It is now **radar over the fund's OWN history** —
free, specific to what the operator actually encounters — and parked until there
IS history, because the fund has never bought anything. ⚠️ **Do not build it
against market-wide data**; that premise is gone. Meanwhile the build stream
takes the correctness backlog.

⛔ **A LEDGER EXPORT OR A PHONE BACKUP IS SUCH A FILE.** Its payload is the
commands **plus `config`, and `config` carries `tax_profile`.** The CLI that
wrote them is gone (5.10), but a backup pulled off the phone is the same payload.
⚠️ The old `cli export` defaulted to the **repo root**, which nothing ignored —
the documented way to move the fund onto the phone was one `git add -A` from
publishing a real person's filing status, permanently, on a public repo. It
defaulted into
`data/`, and `.gitignore` covers `data/*.json` and `*-export.json` as well. ⚠️ **An
export is not a document — it is the ledger plus the profile.** Treat it like the
database, never like an artifact.

**The ledger, the engine, every write and read screen, the sourcing screen,
backups, the import, the DATA ROUTE, the SCAN and the DROPS all run on the
device: 56/56 against Apple's SQLite, confirmed by name** (run 34631425815,
2026-09-11 — the scan and drops cases both named in the verdict) in
`.github/workflows/driver-contract-ios.yml`. The app ships via Codemagic to
TestFlight.

⛔ **`data/resale.db` IS A RETIRED SNAPSHOT AT 55 EVENTS, NOT THE FUND.** When the
fund reached the phone, two databases briefly shared one history — and
append-only over a hash chain means **one event on either side forks them
forever**, with `importLedger` refusing a mismatched chain *by design*. The tool
built to move a fund is exactly the tool that cannot repair a fork: **the safety
property and the hazard are the same property.**

⚠️ **The write-guard that made it safe is gone with the CLI** (5.10) — nothing on
the desktop can write to that file any more, because nothing on the desktop can
read it either. `data/resale.db.retired` remains as a note to a human.

⛔ **THE DESKTOP IS GONE (5.10, 2026-09-10).** `src/cli`, `src/app` and
`src/server` — 3,295 lines — deleted, with the Next.js surface and six test
files. ⚡ **`views.ts` and `sourcing.ts` MOVED to `src/screens/`** (B62, B65):
they are screen MODELS and the phone renders them. There is no web app, no dev
server and no CLI. **Anything below describing one is history** — read it in the
log, not as instructions.

See `MASTER_PLAN.md` for the decomposed active item; it is the queue, this is
orientation.

### What needs a human, not a session

⛔ **The first one now BLOCKS everything**, which is new. The rest do not.

| | |
|---|---|
| ⏳ **The $25 CONTRIBUTION** | **D3, decided 2026-09-11: the bankroll goes $50 → $75.** ⛔ **Measured: at $50 the fund can buy NOTHING** — a $40 purchase with excellent evidence is refused by three capital gates, ceiling $20 against a $24.51 modelled downside. **$50 is the only bankroll where that is true**; at $75 the same rules permit a $30 buy returning $26.71. ⛔ **It needed code, and nobody had noticed — B95, 2026-09-11.** No screen could issue a contribution after the CLI was deleted at 5.10: import needs an empty ledger, and an ADJUSTMENT books owner money as a correction rather than as capital. **Money in** now exists — record it there once the next build is installed. Every figure here saying $50 stays true until it lands. |
| ⏳ **The deploy** | Codemagic → TestFlight. **54 commits** since the 2026-09-10 publish: the whole data route, the scanner, the allocation screen, the rules identity, and 7.5's drops. ⛔ **Codemagic has never been given the market key.** The TestFlight workflow references only the `AppleConnect` group, the yaml sets no vendor variable, and `.env.local` is gitignored — so a build ships **without `EXPO_PUBLIC_SOLDCOMPS_KEY`** unless one is added to a Codemagic group **first**. Settings → Data keys on the phone then says whether it landed. ⚠️ **6.11.6 can only close here** — a simulator has no camera, so the scan is the first thing in this project the lane structurally cannot verify. |
| **B26** | The operator's **state marginal rate** is still unverified (the local rate is confirmed). ⚡ Fixable in the app — the settings screen writes the tax profile, and a non-zero rate is refused without a stated basis. Ten minutes, and the tax reserve is computed from it. |
| **Two repos** | Delete `resale-os-prescrub-2` and `resale-os-prescrub-private`. Both private, both still holding the scrubbed tax profile, and the CLI token cannot delete. History is bundled and restore-verified in the OneDrive backups folder. |
| **D2** | The owner split (20/10/70) is still a default. ⚡ **B73 is closed — 6.7 gave it a screen**, so the thing that blocked answering it is gone. Still not live below $100 NAV, so decide it against real sales rather than in the abstract. |

### Two things a new session should not re-litigate

⛔ **eBay's API is UNAVAILABLE, and not because the application was weak**
(D16, 2026-09-11). The developer account was denied outright with a generic
*"mismatched data"* reason, and the reading of the wider picture is that eBay is
issuing **blanket denials to individual developers**. ⚠️ **Do not re-apply. Do not
design around getting in.** D12 predicted this — *"the resellers work around eBay
and the direction of travel is tightening"* — it just arrived early.

⚡ **What follows from it:** **SoldComps is the only automated data route**
(it serves both halves — `sold=true` and `sold=false`). So the manual path is a
second leg rather than a fallback, and `src/adapters/` stops being good practice
and becomes the thing that makes a vendor swap survivable. Alternatives exist if
that vendor fails — Apify actors, CompSniper — unevaluated, and the adapter
boundary is what buys the option.

⛔ **And the boundary is enforced, not described.** What a market LOOKS like is
`src/core/market.ts`; who said so is `src/adapters/`; `lint:imports` forbids
`src/screens` from reaching an adapter at all, and the `.tsx` composes the two.
⚠️ **Gate 6 closed WITHOUT the finding half** (Jason, 2026-09-11) — it was
struck as unavailable rather than deferred, because a gate left open on a
capability that does not exist never closes. The app values, recommends,
explains and records; the operator finds. The surviving thread is **B69**'s
barcode scan, which is identification rather than discovery.

### The other thing a new session should not re-litigate

⛔ **Categories are deliberately deferred** (D5, 2026-09-08). The system gates on
**sell-through**, not on a category list, and the architecture stays
category-neutral. Books were considered and moved to Growth mode — they are a
margin play needing hold tolerance a $50 fund does not have. Backlog **B28**.

### Five gates run on every check

```
npm run check    # source bytes · imports · PHONE BUNDLE · PLAN · typecheck · 788 tests
```

⚡ **`lint:plan` is new, 2026-09-11, and it exists because nothing read the one
document that says what is being built.** In a single session the plan
accumulated **four malformed `## Queue` headings across eight pushed commits**,
and shipped a log entry describing a decomposition the queue did not contain.
It checks STRUCTURE only — duplicate or malformed headings, exactly one
decomposed section, the queue table agreeing with it, unique sub-step ids.
⛔ **It judges no prose**, and it caught a real inconsistency on its first run.

⚡ **`lint:phone` walks the import graph** from every `src/` module the phone
actually imports and fails if anything on that closure reaches a `node:*`
builtin. The one-level import lint could not see it: `views.ts` was two hops
from dragging the desktop SQLite driver into the bundle. Its roots are
DISCOVERED by scanning `mobile/`, never listed — every hand-written list of
places to look on this project has come up short.

Each was **planted against and verified to red**, then the restore verified to
green. A control that has never been planted is not a control.

---

## The two outside vendors, and the seam that survives them

⛔ **The fund depends on two small third parties, and neither was a plan.**

| | |
|---|---|
| **SoldComps** | `src/adapters/soldcomps.ts`. The ONLY automated market data (**D16** killed eBay). `keyword` search, **no barcode support at all**. Metered: **2 requests per scored item**, 100/month free. |
| **UPCitemdb** | `src/adapters/upcitemdb.ts`. Barcode → title, brand, category. Exists *because* SoldComps takes no barcode. Keyless trial, ~100/day. ⚠️ **Never tested against a Walmart clearance SKU** — store brands and seasonal lines may simply not be in it, and `NOT_FOUND` is a normal outcome. |

⚡ **`src/core/market.ts` and `src/core/product.ts` are the seam.** A screen
renders a `MarketReading` or a `ProductIdentity` and never learns who produced
one — **`lint:imports` forbids `src/screens` from reaching `src/adapters` at
all**, and the `.tsx` composes them. Swapping a vendor is a new file in
`src/adapters/`.

⛔ **THE KEYWORD IN THE MIDDLE IS A MONEY DECISION.** Measured on LEGO 75038:
the raw resolver title gave **96 sold, median $47.50**; the set-number keyword
gave **147 sold, median $80.00** — **68% apart**, and that median becomes the
resale price. ⚡ So `keywordFor` PROPOSES both and the operator picks. A scan
that silently chose would be a confident wrong number arriving faster than
typing did.

⛔ **AND COMPS MUST MATCH THE CONDITION.** Unfiltered, the same product's comps
ran **$1.99–$465** — a coefficient of variation of 1.24 against a
`COMP_CV_WORTHLESS` of 0.50, so the dispersion term was **exactly zero** and the
comps contributed **nothing** to the gate that decides everything. The operator's
`SEALED` / `LIKE_NEW` / `USED_CHECKED` drives `itemCondition`. **B90.**

---

## The seven rules

Break any of these and the product stops being what it is.

1. **`src/core/**` is pure.** No I/O, no clock, no randomness, no framework. It
   imports nothing from `db` or `screens`. The clock is passed in.
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

- ⛔ **A SIGNAL THAT APPEARS NEXT TO A FAILURE IS NOT A FAILURE SIGNAL.** The
  device lane prints `Status=4294967295, isTerminal=YES` on **every** run,
  including the ones that pass 52/52. Two separate fixes treated it as a sick
  boot because each looked at a FAILING run and **neither looked at a passing
  one, where the same line is sitting in the log**. The second fix made the lane
  worse: it tore down a simulator that was merely slow. ⚠️ **Planting the parser
  is not planting the premise** — the parser was tested against synthetic
  sick/healthy text and worked perfectly while the claim it encoded was false.
  ⛔ **Before keying on any log line, read a GREEN run.** B87.
- ⚠️ **The expensive check is the one that gets skipped, which is when it
  matters most.** Three mechanisms were stated confidently and wrong in one
  session; the two that were cheap to verify locally were caught before
  shipping, and the one that needed a 15-minute macOS run was not — because
  reasoning felt cheaper than measuring. **Cost is not evidence.**
- ⛔ **`**B77**/**B79**` inside a block comment is `*/`.** Two bolded ids
  separated by a slash produce the comment terminator, the doc comment ends
  thirty lines early, and TypeScript reports eight syntax errors starting at a
  line that looks like prose. Nothing about the source reads as wrong. Same
  class as the NUL in `hash.ts` and the Python `\b`: **a character sequence that
  means something to a parser and nothing to a reader.** Write "and", not "/".
- ⛔ **A VENDOR'S OWN DOCS ARE NOT THE WIRE.** SoldComps documents its usage
  headers as `X-Usage-Current` / `X-Usage-Limit`; it sends `x-usage-limit`,
  `x-usage-remaining`, `x-usage-used` and `x-usage-reset`. The measured note in
  the backlog was right and the published documentation was wrong. ⚠️ Read a
  real response before writing the parser, and **commit the bytes** —
  `tests/fixtures/soldcomps/` exists because `"240,000+"` is not something
  anyone would have hand-written into a fixture.
- ⛔ **TWO COUNTS FROM ONE SOURCE CAN MEASURE TWO POPULATIONS, AND THE ONE THAT
  LOOKS CLEAN IS THE WRONG ONE.** The ACTIVE query silently restricts itself to a
  category it picks; the SOLD query counts everything and reports
  `autoSelectedCategory: null` — which reads as *"nothing was narrowed"* on
  both. Pinning moved the sold total 17%, and `categoryId=0` does not turn
  auto-selection off. `sold/(sold+active)` across two populations is not a ratio
  of anything. **Call ACTIVE first and pin SOLD to what it declares.** B82.
- ⚠️ **A CONTENT-ADDRESSED ID MEANS AN ALWAYS-PRESENT FIELD ORPHANS EVERY ROW.**
  `opportunityId` is a digest of the draft, so adding `activeListingsIsFloor:
  false` unconditionally would have changed every id the sourcing screen has
  ever produced — stored scores orphaned, one item counted twice in the
  rejection histogram. Add such a field **only when true**, and verify by
  running the previous version against the same input rather than reasoning
  about it.
- ⚠️ **The screen MODELS are tested where there is no device, which is the point
  and also the blind spot.** 6.1.2 taught the count fields to read `"240,000+"`,
  649 tests passed, and `keyboardType="number-pad"` **has no `+` and no `,`** —
  a notation only a machine could enter. A test types into a string. **Wiring
  the `.tsx` is the only step that finds this class**, so do not treat it as
  transcription.
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
- ⛔ **Screens never do arithmetic on money**, and `npm run lint:imports`
  enforces it over the WHOLE tree minus `src/core` — an exemption list, so a new
  screen corpus is swept the day it is born. `formatCents` renders it;
  `toDollarsInput` makes it editable in a form. Stated in 4.2, broken three
  times in 4.11 before anything checked.
- ⚠️ **Run the whole `npm run check`, not the one gate you are editing.** A
  Python `\b` put four literal 0x08 bytes into a regex, which then matched
  nothing; `lint:bytes` named the file and byte the moment it ran, but I had
  been running `lint:imports` alone. A gate you skip is a gate you do not have.
- ⛔ **A BACKUP CARRIES THE COMMANDS AND THE CONFIG. Scored opportunities are
  DEVICE-LOCAL, and that is a decision** (6.0.5, 2026-09-10, Jason). The
  `opportunities` table is neither a command nor config, and it is **not
  derivable** — it records what was decided, when, and under which policy
  version, and no replay reconstructs that. Carrying rows a replay cannot check
  would cost the format the one property that makes moving a fund trustworthy:
  **everything in the file is verified by regenerating it.** Scoring history is
  advisory — a rejection histogram and a watchlist; the ledger is not.
  `tests/backup-portable.test.ts` pins the top-level shape **on the serialised
  JSON**, so growing the format has to be deliberate.
- ⚠️ **BATCH the device lane; it triggers on every push.** `driver-contract-ios`
  is a ~15-minute **macOS** job, the runner is serialised, and pushing per
  sub-item queues a run for every commit — each one verifying a tree the next
  commit has already replaced. Measured 2026-09-10: **four redundant runs in
  flight at once**, and the only one that mattered was last in the queue. Push
  when there is enough to justify the cycle, or cancel the superseded ones. The
  same rule as Codemagic, and the same reason.
- ⛔ **A list of WHERE TO LOOK goes stale in silence; a list of WHAT IS SAFE TO
  READ fails safe.** Five instances of the first: `lint:imports`' screen
  directories, the iOS lane's `paths:` filter (**three times**), and
  `npm run typecheck`, which never ran `mobile/tsconfig.json` at all — so every
  phone screen was typechecked only in CI. Each time the omission fell toward
  *not checking*, and a green meant **"did not run"** while looking exactly like
  "passed". ⚠️ **Do not invert the other kind:** `check-source-bytes.mjs`
  enumerates source extensions so it does not read a PNG and report its bytes as
  control characters. **The test is which way the omission falls** — toward not
  checking something, or toward not trusting it. Fix the first kind by inverting
  it to an exemption list, or by making it answer to something that DISCOVERS:
  `check-phone-bundle.mjs --print-layers`, asserted by `tests/ci-scope.test.ts`.
- ⚠️ **CONFIG IS A SEPARATE DOOR FROM THE LEDGER, and it stays separate.** The
  web decision (Gate 4) was that `withConfigStore` is its own narrow surface, not
  `LedgerReader` plus writes — **that shape invites one more capability each
  time.** The web is gone; the rule survived the port. The phone's provider has
  `setPolicy` / `setTaxProfile` / `saveOpportunity` as three named methods, none
  of which can reach the ledger, and `commit` is still the only way money moves.
  ⚠️ **Saving opportunities is no longer "tier 3, closed"** — it shipped in
  6.0.3, which is what gave **B3**'s histogram and **6.5**'s watchlist anything to
  work with.
- ⛔ **A screen that needs a number it does not have gets it added to
  `src/core` with tests** — never computed in the screen. `src/screens/views.ts`
  is the read model and does no arithmetic on money; even formatting goes
  through `formatCents`.
- ⚠️ **Two tsconfigs, and `npm run typecheck` runs BOTH.** The root is
  node-only (no DOM, no JSX); `mobile/tsconfig.json` is the phone's. ⛔ **The
  phone half was missing from `typecheck` until 2026-09-10**, so every screen
  was typechecked only in CI — fifteen minutes away, on a macOS runner.
- ⛔ **A DEV SERVER EXECUTES CODE THAT DOES NOT TYPECHECK.** On 2026-09-08 a
  `store.commit()` was planted in `page.tsx` to prove `LedgerReader` rejected
  it. `tsc` rejected it exactly as intended — and a **forgotten dev server on
  port 3000** was watching the filesystem, recompiled the page, and ran the
  commit **47 times against the live ledger in 18 seconds.** Reversed with two
  ADJUSTMENTs (a CONTRIBUTION touches two accounts and an adjustment only pairs
  against retained earnings); the 47 events and their reversal are in the
  ledger forever, which is what append-only means.
  ⚡ **The rule that outlives the web app:** ⚠️ **never plant a side effect in
  a file anything might execute** — plant type errors and verify with `tsc`,
  then restore before running anything; and ⛔ **a type is a compile-time
  promise only.** The fix was not a rule, it was handing the caller an object
  that physically has no `commit` on it, so the same mistake gets a `TypeError`
  instead of moving real money.
- ⛔ **"Too expensive" and "walk away" are different answers, and the difference
  is measured.** `priceFixable` re-runs the evaluator with the asking price set
  to the ceiling; if that is a BUY, price is the whole problem. Do not infer it
  from which gates failed — a gate can care about price indirectly. And the
  screen's explanation follows the verdict: the price ceiling explains a price
  problem, the failing gate explains everything else.
- ⚠️ **The screen's DECISIONS live in `src/screens/`, not in the `.tsx`.**
  Which rows, in what order, which warnings and how loud — all tested there,
  because there is no browser here and no device. The `.tsx` is typography only.
  ⛔ Styling and legibility are asserted by NOTHING (B39); that judgement is
  Jason's.
- ⚠️ **Metro needs an `extensionAlias` resolver for this repo's `.js`-for-`.ts`
  imports.** Turbopack could not do it and every page 500'd; Metro needed the
  same shim. Backlog **B38**.
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
cd mobile && npx expo start         # the operator interface IS the phone
```

