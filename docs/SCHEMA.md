# Database Schema

⚠️ **The migrations are the schema. This document is not.**

It used to restate every column, and it went stale within a day of migrations
`002` and `003` landing — which is what a doc that duplicates code always does.
So it now explains the **conventions and the decisions**, and points at the SQL
for the shape.

```
src/db/migrations/001_init.sql            config, ledger, items, expenses
src/db/migrations/002_opportunities.sql   opportunities, authorizations
src/db/migrations/003_item_predictions.sql  expected vs actual, for accuracy
```

Applied in order by `src/db/migrate.ts`; `schema_migrations` records what ran.
**Migrations are append-only — never edit an applied file.** A test asserts the
list only grows, because editing an applied migration means it silently never
runs on a database that already exists.

---

## Conventions

- Money columns end in `_cents` and are `INTEGER NOT NULL`. **Never `REAL`.**
- Rates end in `_bps` and are `INTEGER`. `10000 bps = 100%`.
- Timestamps are `TEXT` ISO-8601 UTC — sorts lexicographically, ports to
  `timestamptz` cleanly.
- Enums are `TEXT` plus a `CHECK`. Future values (`APPROVED`, `ARMED`) are
  already inside the CHECK so adding them is a code change, not a data migration.
- Booleans are `INTEGER CHECK (x IN (0,1))`.
- **Nullable means "nobody produced this number."** An item bought without a
  scored opportunity has `expected_net_proceeds_cents = NULL`, and prediction
  accuracy excludes it. A zero would be a lie about a number nobody produced.

## The decisions worth knowing

### Postings are debit-positive for every account

`ledger_postings.amount_cents` is `+` for a debit and `−` for a credit,
regardless of account class. So an account balance is `SUM(amount_cents)`, the
whole table always sums to `0`, and the accounting identity is a one-line check.
Liability and equity accounts therefore carry negative balances internally;
`presentedBalance()` flips the sign for display, in exactly one place.

### The ledger is append-only and hash-chained

`ledger_events` carries `prev_hash` and `hash`. There is **no UPDATE or DELETE
path for events** in the repository API — a mistake is corrected with an
`ADJUSTMENT`, which leaves both the error and the correction visible.
`verifyChain()` recomputes the chain and names the first row that disagrees.

### Two tables are maintained independently, and cross-checked

`items.book_value_cents` and the `INVENTORY_AT_COST` postings are written by the
same transaction but derived differently. `assertAllInvariants()` compares them
on **every load**, so books-vs-shelf drift surfaces immediately rather than at
year end.

### `expenses.capitalized` prevents double-charging

Inbound shipping and acquisition travel are already inside an item's book value.
They are recorded here for analysis with `capitalized = 1`, and reporting that
sums the table without that filter charges every item twice.

### `opportunities` stores its own inputs and policy version

`input_json` and `policy_version` are kept alongside the verdict. A score is
meaningless without the rules that produced it, and a verdict whose inputs are
gone cannot be audited or reproduced. A test re-derives an old score from the
stored input and asserts it matches.

### `authorizations` exists and nothing writes to it

The seam for future autonomous purchasing: scope, granter, expiry, max price,
max quantity, allowed retailers. **There is deliberately no code path that
inserts into this table**, and a test asserts it stays empty. `DISARM ALL` would
be one `UPDATE`. The system never grants itself spending authority.

### `config` holds policy, tax profile, tax-table acceptance, backup settings

Four keys, and they are the source of the most-repeated bug in this project:
**a stored value and a code definition that can disagree.** See
`MASTER_PLAN_LOG` P1 and backlog **B30**. Current defences:

- `validatePolicy` is **exhaustive by construction**, driven off the shipped
  default's keys, so it cannot fall behind the type.
- Repair paths (`policy adopt-defaults`, `tax profile set`) do **not** read the
  broken value first.
- Backup settings read tolerantly; policy does not. Different jobs.

---

## Postgres migration path

Nothing outside `src/db/` imports `node:sqlite`, and `npm run lint:imports`
enforces it. Porting means implementing the 5-method `Db` interface over `pg`
and adjusting the migration dialect (`INTEGER PRIMARY KEY` → `BIGSERIAL`, `TEXT`
timestamps → `timestamptz`). Money stays integer, so there is no numeric-type
hazard. Backlog **B8**, and only when SQLite actually hurts.
