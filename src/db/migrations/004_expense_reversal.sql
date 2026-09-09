-- Gate 4 / backlog B33: an ADJUSTMENT that corrects an expense must correct the
-- analytic record too.
--
-- Business expenses live in two places: the ledger (a posting against
-- RETAINED_EARNINGS) and this table (the category breakdown behind operating
-- profit). An ADJUSTMENT reversing an expense moved only the ledger, so
-- `profit` and the ledger could disagree — found at button-up, where the ledger
-- returned to $50.00 while `profit --expenses` still reported $1.50 of SUPPLIES.
--
-- A reversal now writes a compensating row here with a NEGATIVE amount, and
-- this column is what links it back to the expense it undoes. Nothing is ever
-- deleted or edited: the table stays append-only like the ledger it mirrors.
--
-- Nullable because every row written before now — and every ordinary expense —
-- reverses nothing.

ALTER TABLE expenses ADD COLUMN reverses_event_id TEXT NULL REFERENCES ledger_events(event_id);

CREATE INDEX idx_expenses_reverses ON expenses(reverses_event_id);
CREATE INDEX idx_expenses_event ON expenses(event_id);
