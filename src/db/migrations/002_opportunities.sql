-- Gate 2: opportunities, and the authorization table that autonomous purchasing
-- will one day need.
--
-- The status CHECK already includes APPROVED and ARMED, so adding them later is
-- a code change rather than a migration of live rows. NOTHING in this codebase
-- transitions into either state.

CREATE TABLE opportunities (
  opportunity_id            TEXT PRIMARY KEY,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,

  name                      TEXT NOT NULL,
  category                  TEXT NOT NULL,
  source                    TEXT NOT NULL DEFAULT 'MANUAL',
  source_url                TEXT NULL,
  source_listing_id         TEXT NULL,
  marketplace               TEXT NOT NULL DEFAULT 'EBAY',

  -- what it costs
  asking_price_cents        INTEGER NOT NULL,
  inbound_shipping_cents    INTEGER NOT NULL DEFAULT 0,
  sales_tax_cents           INTEGER NOT NULL DEFAULT 0,
  acquisition_travel_cents  INTEGER NOT NULL DEFAULT 0,
  landed_cost_cents         INTEGER NOT NULL,

  -- what it should return. expected_gross is BEFORE fees; the rest is derived.
  expected_gross_cents      INTEGER NOT NULL,
  marketplace_fee_cents     INTEGER NOT NULL,
  postage_cents             INTEGER NOT NULL,
  packaging_cents           INTEGER NOT NULL,
  net_proceeds_cents        INTEGER NOT NULL,
  expected_profit_cents     INTEGER NOT NULL,
  expected_roi_bps          INTEGER NOT NULL,
  modeled_downside_cents    INTEGER NOT NULL,

  -- the evidence the hold time was derived from
  sold_last_90d             INTEGER NULL,
  active_listings           INTEGER NOT NULL DEFAULT 0,
  velocity_source           TEXT NOT NULL CHECK (velocity_source IN ('COMPS','OPERATOR_ESTIMATE')),
  sell_through_bps          INTEGER NOT NULL,
  expected_days_to_sale     INTEGER NOT NULL,
  expected_days_p90         INTEGER NOT NULL,

  -- the verdict
  buy_score                 INTEGER NULL,
  risk_score                INTEGER NULL,
  confidence_bps            INTEGER NULL,
  max_recommended_cents     INTEGER NULL,
  price_bound_by            TEXT NULL,
  recommendation            TEXT NULL CHECK (recommendation IS NULL OR recommendation IN
                              ('BUY','WATCH','PASS','REJECT')),
  reasoning_json            TEXT NULL,
  score_breakdown_json      TEXT NULL,
  scored_at                 TEXT NULL,
  -- A score means nothing without the rules that produced it.
  policy_version            TEXT NULL,

  status                    TEXT NOT NULL CHECK (status IN (
                              'WATCHING','ELIGIBLE','RECOMMENDED','PASSED',
                              'APPROVED','ARMED','PURCHASED')),
  -- Set when a PURCHASED opportunity became a real item.
  item_id                   TEXT NULL REFERENCES items(item_id),
  input_json                TEXT NOT NULL,

  UNIQUE (source, source_listing_id)
);

-- Architecture only. There is deliberately NO code path that inserts here.
-- The system never grants itself spending authority.
CREATE TABLE authorizations (
  authorization_id   TEXT PRIMARY KEY,
  opportunity_id     TEXT NULL REFERENCES opportunities(opportunity_id),
  scope              TEXT NOT NULL CHECK (scope IN ('ITEM','SKU','CATEGORY')),
  granted_by         TEXT NOT NULL,
  granted_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  max_price_cents    INTEGER NOT NULL,
  max_quantity       INTEGER NOT NULL,
  allowed_retailers  TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN
                       ('APPROVED','ARMED','DISARMED','EXPIRED','CONSUMED')),
  disarmed_at        TEXT NULL,
  disarm_reason      TEXT NULL
);

CREATE INDEX idx_opps_status ON opportunities(status, buy_score);
CREATE INDEX idx_opps_category ON opportunities(category, status);
CREATE INDEX idx_opps_created ON opportunities(created_at);
CREATE INDEX idx_auth_state ON authorizations(state, expires_at);
