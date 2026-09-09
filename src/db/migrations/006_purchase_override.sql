-- D4, answered 2026-09-09: a purchase may overrule the capital gates, and it
-- may never do so silently.
--
-- Before this, `cli buy --force` printed "recording it as it happened" and
-- committed an ordinary PURCHASE with no marker of any kind, so an overruled
-- buy was indistinguishable from a clean one the moment the terminal scrolled.
-- That was live on the real fund.
--
-- `overrode_gates` is the JSON array of failed constraint codes as they read at
-- the time of purchase. Stored as text rather than normalised: the codes are a
-- historical record of what the rules said THEN, not a foreign key into what
-- they say now, and joining against a live rule set would rewrite history every
-- time a constraint is renamed.
--
-- Both are NULL for a clean purchase. NULL means "no override", which is a
-- different fact from an empty array, and the two must not collapse.

ALTER TABLE items ADD COLUMN overrode_gates TEXT NULL;
ALTER TABLE items ADD COLUMN override_reason TEXT NULL;
