-- self-managed
--
-- Gate 4 / D9: a correction to the analytic record that moves no cash.
--
-- Two things need it. A miscategorised expense (SUPPLIES that was really
-- POSTAGE) is a books error, not a money error. And an expense whose cash was
-- already returned by an ADJUSTMENT recorded before `reversesEventId` existed
-- has a ledger that is right and an `expenses` table that is wrong, with no
-- command able to say so — the live book's $1.50 of smoke-test SUPPLIES.
--
-- ⚠️ This file is `-- self-managed`: it runs outside the runner's transaction
-- and owns its own. SQLite cannot alter a CHECK constraint in place, so a new
-- event type means rebuilding `ledger_events`, and rebuilding a table that
-- `ledger_postings` and `expenses` both reference needs foreign keys genuinely
-- OFF. `PRAGMA defer_foreign_keys` was tried first and does not survive the
-- DROP; it fails with a foreign key violation.
--
-- It is written to be safe to re-run: the scratch table is dropped first and
-- the indexes are IF NOT EXISTS, so a crash before the runner records this file
-- is recovered by simply running it again.

PRAGMA foreign_keys = OFF;

BEGIN;

DROP TABLE IF EXISTS ledger_events_new;

CREATE TABLE ledger_events_new (
  id            INTEGER PRIMARY KEY,
  event_id      TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN (
                  'CONTRIBUTION','PURCHASE','SALE','OWNER_PAYOUT',
                  'BUSINESS_EXPENSE','TAX_PAYMENT','CHARGE_OFF',
                  'PASSIVE_RECOVERY','ITEM_STATE_CHANGE','ADJUSTMENT',
                  'EXPENSE_CORRECTION')),
  occurred_at   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  item_id       TEXT NULL REFERENCES items(item_id),
  memo          TEXT NULL,
  payload_json  TEXT NOT NULL,
  prev_hash     TEXT NULL,
  hash          TEXT NOT NULL
);

-- Column-for-column, so the hash chain is byte-identical afterwards.
INSERT INTO ledger_events_new
  (id, event_id, type, occurred_at, recorded_at, item_id, memo, payload_json, prev_hash, hash)
SELECT
   id, event_id, type, occurred_at, recorded_at, item_id, memo, payload_json, prev_hash, hash
  FROM ledger_events;

DROP TABLE ledger_events;

ALTER TABLE ledger_events_new RENAME TO ledger_events;

CREATE INDEX IF NOT EXISTS idx_events_occurred ON ledger_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_item     ON ledger_events(item_id);

COMMIT;

PRAGMA foreign_keys = ON;
