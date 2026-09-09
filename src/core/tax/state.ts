/**
 * State and local income tax, as brackets rather than as one flat rate.
 *
 * ⚠️ **Why this matters, and how little.** `TaxProfile.stateIncomeTaxBps` is a
 * flat MARGINAL rate, and for an *incremental* reserve a flat marginal rate is
 * exactly right — right up until the business income crosses a bracket edge,
 * at which point it is wrong for the part above the edge and nothing says so.
 *
 * The flat path is still there and still the default. A profile that names a
 * jurisdiction gets the real brackets; one that does not keeps the rate it was
 * given. Nobody's stored profile becomes invalid.
 *
 * ⛔ Generated from GigWorkTracker's `stateTaxConfigs/2026.ts` and
 * `mdLocalTax2026.ts` by script, never typed — same rule as the federal tables.
 * State brackets come from the Maryland statute (Budget Reconciliation and
 * Financing Act of 2025, retroactive to 1 Jan 2025); the county piggyback rates
 * are confirmed against the DLS/Comptroller "Local Tax Rates" table.
 */

import type { Bps } from '../money.js';
import type { Bracket, FilingStatus } from './tables.js';

export interface StateTaxTable {
  readonly state: string;
  readonly year: number;
  readonly source: string;
  readonly verified: boolean;
  readonly brackets: Readonly<Record<FilingStatus, readonly Bracket[]>>;
  /**
   * Mandatory local "piggyback" tax, applied to the same state taxable income.
   * ⚠️ Only the FLAT counties are here. Anne Arundel and Frederick are
   * graduated, and a flat approximation of a graduated rate is the exact error
   * this module exists to remove — they are absent rather than wrong.
   */
  readonly localRateBps: Readonly<Record<string, Bps>>;
}

export const MD_2026: StateTaxTable = {
  state: 'MD',
  year: 2026,
  source:
    'Maryland statute (Budget Reconciliation and Financing Act of 2025) for state brackets; ' +
    'DLS/Comptroller "Local Tax Rates" and "Withholding Tax Facts, January 2026" for county rates. ' +
    'Transcribed from GigWorkTracker services/tax-engine.',
  verified: true,

  brackets: {
    SINGLE: [
      { upToCents: 100_000, rateBps: 200 },
      { upToCents: 200_000, rateBps: 300 },
      { upToCents: 300_000, rateBps: 400 },
      { upToCents: 10_000_000, rateBps: 475 },
      { upToCents: 12_500_000, rateBps: 500 },
      { upToCents: 15_000_000, rateBps: 525 },
      { upToCents: 25_000_000, rateBps: 550 },
      { upToCents: 50_000_000, rateBps: 575 },
      { upToCents: 100_000_000, rateBps: 625 },
      { upToCents: null, rateBps: 650 },
    ],
    MARRIED_JOINT: [
      { upToCents: 100_000, rateBps: 200 },
      { upToCents: 200_000, rateBps: 300 },
      { upToCents: 300_000, rateBps: 400 },
      { upToCents: 15_000_000, rateBps: 475 },
      { upToCents: 17_500_000, rateBps: 500 },
      { upToCents: 22_500_000, rateBps: 525 },
      { upToCents: 30_000_000, rateBps: 550 },
      { upToCents: 60_000_000, rateBps: 575 },
      { upToCents: 120_000_000, rateBps: 625 },
      { upToCents: null, rateBps: 650 },
    ],
    MARRIED_SEPARATE: [
      { upToCents: 100_000, rateBps: 200 },
      { upToCents: 200_000, rateBps: 300 },
      { upToCents: 300_000, rateBps: 400 },
      { upToCents: 10_000_000, rateBps: 475 },
      { upToCents: 12_500_000, rateBps: 500 },
      { upToCents: 15_000_000, rateBps: 525 },
      { upToCents: 25_000_000, rateBps: 550 },
      { upToCents: 50_000_000, rateBps: 575 },
      { upToCents: 100_000_000, rateBps: 625 },
      { upToCents: null, rateBps: 650 },
    ],
    HEAD_OF_HOUSEHOLD: [
      { upToCents: 100_000, rateBps: 200 },
      { upToCents: 200_000, rateBps: 300 },
      { upToCents: 300_000, rateBps: 400 },
      { upToCents: 10_000_000, rateBps: 475 },
      { upToCents: 12_500_000, rateBps: 500 },
      { upToCents: 15_000_000, rateBps: 525 },
      { upToCents: 25_000_000, rateBps: 550 },
      { upToCents: 50_000_000, rateBps: 575 },
      { upToCents: 100_000_000, rateBps: 625 },
      { upToCents: null, rateBps: 650 },
    ],
  },

  localRateBps: {
    "Allegany County": 320,
    "Baltimore City": 320,
    "Baltimore County": 320,
    "Calvert County": 320,
    "Caroline County": 320,
    "Carroll County": 303,
    "Cecil County": 274,
    "Charles County": 303,
    "Dorchester County": 330,
    "Garrett County": 265,
    "Harford County": 306,
    "Howard County": 320,
    "Kent County": 330,
    "Montgomery County": 320,
    "Prince George's County": 320,
    "Queen Anne's County": 320,
    "St. Mary's County": 320,
    "Somerset County": 320,
    "Talbot County": 240,
    "Washington County": 295,
    "Wicomico County": 320,
    "Worcester County": 225,
    "Nonresident": 225,
    // Anne Arundel County: GRADUATED — not modelled
    // Frederick County: GRADUATED — not modelled
  },
};

export const STATE_TAX_TABLES: Readonly<Record<string, StateTaxTable>> = {
  MD: MD_2026,
};

/** The table for a jurisdiction, or null when it is not modelled. */
export function stateTable(state: string, year: number): StateTaxTable | null {
  const t = STATE_TAX_TABLES[state.toUpperCase()];
  return t && t.year === year ? t : null;
}
