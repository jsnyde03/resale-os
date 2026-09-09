# Architecture

_Last updated: 2026-09-08 (Gate 1)_

## 1. What this is

A **private, single-operator web application** that runs a resale business as a
fund: it decides what to buy, how much capital it may risk, tracks every item and
transaction, and reconciles the money to the cent.

It is **not** a SaaS product, has no multi-tenancy, no auth beyond a local
gate, and no App Store distribution. It is equipment for one business.

## 2. Non-negotiable design rules

| # | Rule | Why |
|---|---|---|
| A1 | **The financial core is pure TypeScript with no I/O.** `src/core/**` imports nothing from the DB, the network, or a framework. | It can be exhaustively tested, and a UI bug can never corrupt the money. |
| A2 | **All money is integer cents.** No floats anywhere in the ledger, ever. | Float cents drift; a fund that cannot reconcile is worthless. |
| A3 | **The ledger is append-only and double-entry.** Balances are *derived*, never stored as an authoritative mutable number. | "Why did my balance change?" is answerable by construction. |
| A4 | **Every posting set balances to zero** and is checked by an invariant assertion before it is committed. | A bug throws at write time instead of silently producing wrong money. |
| A5 | **No LLM touches financial calculation, capital rules, or accounting.** | Determinism is the product. AI is a later, optional *input* to estimates only. |
| A6 | **Scores are pure functions** `(opportunity, portfolioState, policy) -> result`. Same inputs, same output, forever. | Scores are auditable and back-testable. |
| A7 | **Confidence travels with every estimate.** A number without a confidence is not accepted by the scorer. | Low-confidence data must never be spent like high-confidence data. |

## 3. Stack (and why)

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict, ESM | Required; one language across engine and UI. |
| Runtime | Node >= 22.5 | Ships `node:sqlite` built in. |
| Database | **SQLite via `node:sqlite`** | Zero native compilation (no `better-sqlite3` build step on Windows), zero install risk. |
| DB access | **Hand-written SQL behind a repository layer** (`src/db/`) | An ORM buys little for ~15 tables and costs a native dep. All SQL lives in one directory, written close to ANSI, so the Postgres port is a driver swap plus dialect touch-ups. |
| Validation | **Zod 4** | One schema definition validates API input, adapter output, and config. |
| Tests | **Vitest** | Fast, TS-native, no config ceremony. |
| Frontend | **Next.js (App Router) + React + Tailwind** — added at **Gate 4** | Not installed yet: nothing before Gate 4 needs it, and an unused 300 MB dep tree is noise. |
| Jobs | A single `scripts/worker.ts` loop + explicit CLI commands | One operator, one machine. A queue system here would be theatre. |

### Postgres migration path (deliberate, not hypothetical)

`src/db/driver.ts` exposes a 5-method interface (`exec`, `all`, `get`, `run`,
`transaction`). Nothing outside `src/db/` imports `node:sqlite`. Porting =
implementing that interface over `pg` and adjusting the migration SQL dialect
(`INTEGER PRIMARY KEY` -> `BIGSERIAL`, `TEXT` timestamps -> `timestamptz`).
Money stays integer, so no numeric-type hazard.

## 4. Module map

```
src/
  core/                <- PURE. no I/O, no clock, no randomness. the authority.
    money.ts             integer cents, bps, remainder-exact allocation
    math.ts              clamp/lerp/median, roundHalfAwayFromZero, normalizeZero
    fees.ts              marketplace fee models; gross -> net proceeds
    velocity.ts          comp counts -> expected days to sale, p90, confidence
    ledger/              accounts, postings, invariants
    capital/             engine, policy, metrics, constraints, tax adapter,
                         reachability, accuracy
    tax/                 tables, profile, annual model (SE + brackets + QBI)
  scoring/             PURE. confidence, buy score, risk score, max price,
                       recommend, evaluate
  domain/              zod schemas + derived economics (opportunity)
  db/                  driver, migrations, store, replay, hash, backup,
                       reporting, repositories  <- the ONLY I/O to data
  cli/                 the operator interface until Gate 4
  adapters/            source adapters (eBay, manual, CSV)          [Gate 5, empty]
  server/              API route handlers                           [Gate 4, empty]
tests/                 vitest; financial suites are the heaviest by design
scripts/               check-source-bytes, check-import-direction
docs/                  this file, the specs, the gate plan
```

⚠️ **The direction is enforced, not merely intended.** `npm run lint:imports`
fails if `core` imports from `db`, `cli`, `server`, `scoring` or `domain`, or if
any pure layer touches `node:sqlite`, `node:fs` or `node:child_process`. It was
planted against and verified.

**Dependency direction is one-way:** `core` <- `scoring` <- `domain` <- `db` <-
`server`/`cli`. `core` imports nothing from the layers above it. This is checked
by a lint script (`scripts/check-import-direction.ts`).

## 5. The operating loop the system implements

```
 discover  -> evaluate -> risk -> affordability -> recommend -> purchase
    ^                                                              |
    |                                                              v
 learn <- reconcile <- pay owner <- reserve tax/ops <- sell <- track inventory
```

Gate 1 builds the right-hand half (purchase -> ... -> pay owner -> reinvest),
because that is the half that must never be wrong. Discovery is cheap to add
later and expensive to trust early.

## 6. Authorization model (architected now, implemented later)

Opportunity status is a state machine. Gate 2 implements the first five states;
`APPROVED` and `ARMED` exist in the type and the DB CHECK constraint from day
one so adding them is not a migration of live rows.

```
WATCHING -> ELIGIBLE -> RECOMMENDED -> [APPROVED] -> [ARMED] -> PURCHASED
     \                       \                          /
      ------------> PASSED <-------------------------- (disarm/expire)
```

Hard rule carried in the schema and the engine: **the system never grants itself
spending authority.** `APPROVED`/`ARMED` require a row in `authorizations` that
records who granted it, the max price, max quantity, allowed retailers, and an
expiry. A future `DISARM ALL` is a single UPDATE over that table.

## 7. What is explicitly out of scope right now

Ava / any LLM integration; autonomous purchasing; multi-channel routing;
multi-user; mobile-native packaging; pre-release drop execution. Each has a
seam reserved (adapter interface, authorization table, `marketplace` column,
`channel_quotes` table) and nothing more.
