-- Gate 1: config, the ledger, items, expenses.
-- Written close to ANSI. Money is INTEGER cents; rates are INTEGER bps.
-- Future enum values (APPROVED / ARMED) are already inside CHECK constraints so
-- adding them later is not a migration of live rows.

CREATE TABLE config (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE items (
  item_id                TEXT PRIMARY KEY,
  opportunity_id         TEXT NULL,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  sku                    TEXT NULL,
  condition              TEXT NULL,
  acquired_at            TEXT NOT NULL,
  landed_cost_cents      INTEGER NOT NULL,
  book_value_cents       INTEGER NOT NULL,
  expected_days_to_sale  INTEGER NOT NULL,
  expected_resale_cents  INTEGER NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN (
                           'ACTIVE','MARKDOWN','CAPITAL_RECOVERY','SOLD',
                           'CHARGED_OFF','PASSIVE_RECOVERY','PERSONAL_KEEP')),
  charge_off_reason      TEXT NULL CHECK (charge_off_reason IS NULL OR charge_off_reason IN (
                           'UNSELLABLE','DAMAGED','LOST','PERSONAL_KEEP','STALE')),
  listing_live           INTEGER NOT NULL DEFAULT 0 CHECK (listing_live IN (0,1)),
  marketplace            TEXT NULL,
  sold_at                TEXT NULL,
  days_to_sale           INTEGER NULL,
  realized_profit_cents  INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL
);

CREATE TABLE ledger_events (
  id            INTEGER PRIMARY KEY,
  event_id      TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN (
                  'CONTRIBUTION','PURCHASE','SALE','OWNER_PAYOUT',
                  'BUSINESS_EXPENSE','TAX_PAYMENT','CHARGE_OFF',
                  'PASSIVE_RECOVERY','ITEM_STATE_CHANGE','ADJUSTMENT')),
  occurred_at   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  item_id       TEXT NULL REFERENCES items(item_id),
  memo          TEXT NULL,
  payload_json  TEXT NOT NULL,
  prev_hash     TEXT NULL,
  hash          TEXT NOT NULL
);

CREATE TABLE ledger_postings (
  id            INTEGER PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES ledger_events(event_id),
  seq           INTEGER NOT NULL,
  account       TEXT NOT NULL CHECK (account IN (
                  'LIQUID','INVENTORY_AT_COST','TAX_RESERVE','OPERATING_RESERVE',
                  'OWNER_PAYABLE','CONTRIBUTED_CAPITAL','RETAINED_EARNINGS')),
  amount_cents  INTEGER NOT NULL,
  memo          TEXT NULL,
  UNIQUE (event_id, seq)
);

CREATE TABLE expenses (
  expense_id    TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES ledger_events(event_id),
  scope         TEXT NOT NULL CHECK (scope IN ('TRANSACTION','BUSINESS')),
  item_id       TEXT NULL REFERENCES items(item_id),
  category      TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  occurred_at   TEXT NOT NULL,
  memo          TEXT NULL,
  -- 1 when the cost was capitalised into an item's book value (acquisition
  -- travel, inbound shipping). Reporting must not count those twice.
  capitalized   INTEGER NOT NULL DEFAULT 0 CHECK (capitalized IN (0,1)),
  CHECK (scope = 'BUSINESS' OR item_id IS NOT NULL)
);

CREATE INDEX idx_postings_account ON ledger_postings(account);
CREATE INDEX idx_postings_event   ON ledger_postings(event_id);
CREATE INDEX idx_events_occurred  ON ledger_events(occurred_at);
CREATE INDEX idx_events_item      ON ledger_events(item_id);
CREATE INDEX idx_items_state      ON items(state);
CREATE INDEX idx_items_category   ON items(category, state);
CREATE INDEX idx_expenses_scope   ON expenses(scope, occurred_at);
