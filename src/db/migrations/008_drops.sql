-- Gate 7.5, 2026-09-11: dated retail drops, so one survives the app closing.
--
-- ⛔ THIS TABLE STORES NO VERDICT, and that is the decision it embodies.
--
-- `opportunities` stores a recommendation because it records a decision that
-- was MADE — the operator stood in an aisle and passed, under the rules of that
-- day, and re-scoring the row later would show a number that was never the
-- reason for anything. A drop is the opposite: it has not happened yet. The
-- only useful question is what TODAY's rules say about it at today's bankroll,
-- and that changes every time the fund moves. So the screen recomputes, exactly
-- as the watchlist does.
--
-- ⚡ It also settles an id problem rather than storing one: `drop-<drop_id>` is
-- stable across re-evaluations, unlike the aisle screen's draft digest, so a
-- stored score would be silently overwritten every time the drop was re-judged
-- and nobody could tell which rules produced the row. Storing no score means
-- there is nothing to overwrite.
--
-- What IS stored is the FACTS: what is coming, and the comparable's market as
-- it was last read.

CREATE TABLE drops (
  drop_id                     TEXT PRIMARY KEY,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,

  name                        TEXT NOT NULL,
  retailer                    TEXT NOT NULL,
  -- ⛔ A drop with no date is a rumour, and `Drop` refuses one. The GLOB is
  -- here because `dropTiming` THROWS on an unparseable date, and the row that
  -- would throw is written long before it is read.
  drop_date                   TEXT NOT NULL
                                CHECK (drop_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  msrp_cents                  INTEGER NOT NULL CHECK (msrp_cents >= 0),

  -- --- the analogy -------------------------------------------------------
  -- ⚠️ BOTH OR NEITHER. `Comparable.why` is a required field in the type for a
  -- reason: an analogy nobody can inspect is a guess with a number attached,
  -- and the number becomes the resale price. A keyword with no stated reason
  -- would be exactly that, so the database refuses it.
  comparable_keyword          TEXT NULL,
  comparable_why              TEXT NULL,

  -- --- the comparable's market, as last read ------------------------------
  -- ⛔ NULL `valued_at` is "nobody has looked yet", which is NOT "nothing
  -- comparable has sold" (that is a null comparable above). The screen reports
  -- them as different states because they are different facts.
  valued_at                   TEXT NULL,
  comp_prices_json            TEXT NULL,
  comp_median_age_days        INTEGER NULL,
  comparable_sold_90d         INTEGER NULL,
  comparable_active           INTEGER NULL,
  comparable_sold_is_floor    INTEGER NOT NULL DEFAULT 0,
  comparable_active_is_floor  INTEGER NOT NULL DEFAULT 0,
  category                    TEXT NULL,

  -- --- where the drop itself came from ------------------------------------
  -- 'MANUAL' today; a feed names itself here once D19's adapter exists, so a
  -- row can always say who claimed this drop was happening.
  source                      TEXT NOT NULL DEFAULT 'MANUAL',
  source_url                  TEXT NULL,

  CHECK ((comparable_keyword IS NULL) = (comparable_why IS NULL)),
  -- ⛔ A valuation is all of it or none of it. A half-written reading would
  -- price a drop off counts with no comps, or comps with no category, and the
  -- screen cannot tell a partial write from a deliberate absence.
  CHECK (valued_at IS NULL OR (
    comp_prices_json IS NOT NULL AND comp_median_age_days IS NOT NULL AND
    comparable_sold_90d IS NOT NULL AND comparable_active IS NOT NULL AND
    category IS NOT NULL
  ))
);

-- The screen is ordered by deadline and the passed ones are kept.
CREATE INDEX idx_drops_date ON drops(drop_date);
