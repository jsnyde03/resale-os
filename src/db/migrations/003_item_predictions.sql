-- Gate 3: make prediction accuracy measurable.
--
-- `expected_resale_cents` is a GROSS price; what an item actually realises is
-- NET of fees and postage. Comparing them was comparing different things, so
-- the expectation is now stored in the same terms as the outcome.
--
-- All three are nullable: items bought before this migration, and items bought
-- without a scored opportunity behind them, genuinely have no prediction. A
-- zero would be a lie about a number nobody produced.

ALTER TABLE items ADD COLUMN expected_net_proceeds_cents INTEGER NULL;
ALTER TABLE items ADD COLUMN expected_profit_cents INTEGER NULL;
ALTER TABLE items ADD COLUMN actual_net_proceeds_cents INTEGER NULL;

CREATE INDEX idx_items_opportunity ON items(opportunity_id);
