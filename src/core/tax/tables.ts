/**
 * Tax constants, as dated data rather than as numbers buried in code.
 *
 * ⚠️ **A TABLE MUST BE VERIFIED BEFORE IT IS TRUSTED.** `verified: false` means
 * nobody has checked it against the IRS release for that year, and every
 * consumer of this module surfaces that rather than hiding it. Verify against
 * IRS Rev. Proc. 2024-40 (2025), Rev. Proc. 2025-32 (2026) or the equivalent
 * for a later year, then flip the flag and record who checked and when.
 *
 * **2026 is verified; 2025 is not, and is kept for replaying older events.**
 *
 * A tax table is exactly the kind of thing that goes stale silently, so
 * `taxTableWarnings()` compares the table's year against the year of the
 * transaction being reserved for and says so when they differ.
 */

import type { Bps, Cents } from '../money.js';

export const FILING_STATUSES = [
  'SINGLE',
  'MARRIED_JOINT',
  'MARRIED_SEPARATE',
  'HEAD_OF_HOUSEHOLD',
] as const;

export type FilingStatus = (typeof FILING_STATUSES)[number];

export interface Bracket {
  /** Taxable income up to this amount is taxed at `rateBps`. null = no ceiling. */
  readonly upToCents: Cents | null;
  readonly rateBps: Bps;
}

export interface TaxTables {
  readonly year: number;
  readonly source: string;
  /** False until a human has checked these against the IRS release. */
  readonly verified: boolean;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;

  readonly standardDeductionCents: Readonly<Record<FilingStatus, Cents>>;
  readonly brackets: Readonly<Record<FilingStatus, readonly Bracket[]>>;

  // --- self-employment -----------------------------------------------------
  /** Share of net SE earnings that is actually subject to SE tax: 92.35%. */
  readonly seEarningsFactorBps: Bps;
  /** No SE tax at all below this much in net SE earnings for the year. */
  readonly seMinimumEarningsCents: Cents;
  /** Social Security: 12.4%, and only up to the wage base. */
  readonly socialSecurityRateBps: Bps;
  readonly socialSecurityWageBaseCents: Cents;
  /** Medicare: 2.9%, uncapped. */
  readonly medicareRateBps: Bps;
  /** Additional Medicare: 0.9% above the threshold. */
  readonly additionalMedicareRateBps: Bps;
  readonly additionalMedicareThresholdCents: Readonly<Record<FilingStatus, Cents>>;

  // --- qualified business income (Section 199A) ----------------------------
  readonly qbiRateBps: Bps;
}

/**
 * 2025 federal figures. Single source of truth; edit here, not at call sites.
 */
export const TAX_TABLES_2025: TaxTables = {
  year: 2025,
  source: 'IRS 2025 federal figures — NOT INDEPENDENTLY VERIFIED, see module header',
  verified: false,
  verifiedBy: null,
  verifiedAt: null,

  standardDeductionCents: {
    SINGLE: 1_500_000, // $15,000
    MARRIED_JOINT: 3_000_000, // $30,000
    MARRIED_SEPARATE: 1_500_000, // $15,000
    HEAD_OF_HOUSEHOLD: 2_250_000, // $22,500
  },

  brackets: {
    SINGLE: [
      { upToCents: 1_192_500, rateBps: 1_000 },
      { upToCents: 4_847_500, rateBps: 1_200 },
      { upToCents: 10_335_000, rateBps: 2_200 },
      { upToCents: 19_730_000, rateBps: 2_400 },
      { upToCents: 25_052_500, rateBps: 3_200 },
      { upToCents: 62_635_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    MARRIED_JOINT: [
      { upToCents: 2_385_000, rateBps: 1_000 },
      { upToCents: 9_695_000, rateBps: 1_200 },
      { upToCents: 20_670_000, rateBps: 2_200 },
      { upToCents: 39_460_000, rateBps: 2_400 },
      { upToCents: 50_105_000, rateBps: 3_200 },
      { upToCents: 75_160_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    MARRIED_SEPARATE: [
      { upToCents: 1_192_500, rateBps: 1_000 },
      { upToCents: 4_847_500, rateBps: 1_200 },
      { upToCents: 10_335_000, rateBps: 2_200 },
      { upToCents: 19_730_000, rateBps: 2_400 },
      { upToCents: 25_052_500, rateBps: 3_200 },
      { upToCents: 37_580_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    HEAD_OF_HOUSEHOLD: [
      { upToCents: 1_700_000, rateBps: 1_000 },
      { upToCents: 6_485_000, rateBps: 1_200 },
      { upToCents: 10_335_000, rateBps: 2_200 },
      { upToCents: 19_730_000, rateBps: 2_400 },
      { upToCents: 25_050_000, rateBps: 3_200 },
      { upToCents: 62_635_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
  },

  seEarningsFactorBps: 9_235,
  seMinimumEarningsCents: 40_000, // $400
  socialSecurityRateBps: 1_240,
  socialSecurityWageBaseCents: 17_610_000, // $176,100
  medicareRateBps: 290,
  additionalMedicareRateBps: 90,
  additionalMedicareThresholdCents: {
    SINGLE: 20_000_000,
    MARRIED_JOINT: 25_000_000,
    MARRIED_SEPARATE: 12_500_000,
    HEAD_OF_HOUSEHOLD: 20_000_000,
  },

  qbiRateBps: 2_000,
};


/**
 * 2026 federal figures — **VERIFIED**, and here is exactly how.
 *
 * The numbers are transcribed from GigWorkTracker's `services/tax-engine`
 * (`src/taxYears/2026.ts`), whose author confirmed them directly against:
 *
 *   - **IRS Rev. Proc. 2025-32** — brackets and the standard deduction,
 *     including the One Big Beautiful Bill Act amendments
 *   - **SSA 2026 COLA fact sheet** — the Social Security wage base,
 *     $176,100 → $184,500
 *
 * ⚠️ **This is second-hand verification, and it says so.** Somebody checked
 * these against the IRS release; it was not this project, and a reader deserves
 * to know which. What IS first-hand here is the transcription: the literal
 * below was **generated by a script that read that config**, not typed, because
 * a mistyped bracket is wrong money and reads exactly like a right one.
 *
 * Statutory figures (the 92.35% SE factor, the $400 floor, 12.4%/2.9% rates,
 * the Additional Medicare thresholds, the 20% QBI rate) are unchanged from
 * 2025 — they are set by statute rather than indexed.
 */
export const TAX_TABLES_2026: TaxTables = {
  year: 2026,
  source:
    'IRS Rev. Proc. 2025-32 (brackets, standard deduction); SSA 2026 COLA fact sheet ' +
    '(wage base). Transcribed from GigWorkTracker services/tax-engine, which verified them.',
  verified: true,
  verifiedBy: 'GigWorkTracker tax-engine (IRS Rev. Proc. 2025-32; SSA 2026 COLA fact sheet)',
  verifiedAt: '2026-09-08',

  standardDeductionCents: {
    SINGLE: 1_610_000, // $16,100
    MARRIED_JOINT: 3_220_000, // $32,200
    MARRIED_SEPARATE: 1_610_000, // $16,100
    HEAD_OF_HOUSEHOLD: 2_415_000, // $24,150
  },

  brackets: {
    SINGLE: [
      { upToCents: 1_240_000, rateBps: 1_000 },
      { upToCents: 5_040_000, rateBps: 1_200 },
      { upToCents: 10_570_000, rateBps: 2_200 },
      { upToCents: 20_177_500, rateBps: 2_400 },
      { upToCents: 25_622_500, rateBps: 3_200 },
      { upToCents: 64_060_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    MARRIED_JOINT: [
      { upToCents: 2_480_000, rateBps: 1_000 },
      { upToCents: 10_080_000, rateBps: 1_200 },
      { upToCents: 21_140_000, rateBps: 2_200 },
      { upToCents: 40_355_000, rateBps: 2_400 },
      { upToCents: 51_245_000, rateBps: 3_200 },
      { upToCents: 76_870_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    MARRIED_SEPARATE: [
      { upToCents: 1_240_000, rateBps: 1_000 },
      { upToCents: 5_040_000, rateBps: 1_200 },
      { upToCents: 10_570_000, rateBps: 2_200 },
      { upToCents: 20_177_500, rateBps: 2_400 },
      { upToCents: 25_622_500, rateBps: 3_200 },
      { upToCents: 38_435_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
    HEAD_OF_HOUSEHOLD: [
      { upToCents: 1_770_000, rateBps: 1_000 },
      { upToCents: 6_745_000, rateBps: 1_200 },
      { upToCents: 10_570_000, rateBps: 2_200 },
      { upToCents: 20_175_000, rateBps: 2_400 },
      { upToCents: 25_620_000, rateBps: 3_200 },
      { upToCents: 64_060_000, rateBps: 3_500 },
      { upToCents: null, rateBps: 3_700 },
    ],
  },

  seEarningsFactorBps: 9_235,
  seMinimumEarningsCents: 40_000, // $400, statutory
  socialSecurityRateBps: 1_240,
  socialSecurityWageBaseCents: 18_450_000, // $184,500
  medicareRateBps: 290,
  additionalMedicareRateBps: 90,
  // Fixed by statute, not inflation-adjusted. Unchanged from 2025.
  additionalMedicareThresholdCents: {
    SINGLE: 20_000_000,
    MARRIED_JOINT: 25_000_000,
    MARRIED_SEPARATE: 12_500_000,
    HEAD_OF_HOUSEHOLD: 20_000_000,
  },

  qbiRateBps: 2_000,
};

export const DEFAULT_TAX_TABLES = TAX_TABLES_2026;

/**
 * The owner's decision to use these tables anyway.
 *
 * ⚠️ **This is NOT verification, and it deliberately does not set
 * `verified`.** `verified` means somebody checked the numbers against an IRS
 * release; this means the owner judged them good enough for a reserve. Two
 * different facts, and collapsing them would lose the one that matters.
 *
 * Scoped to a specific (tablesYear, transactionYear) pair, so an acceptance for
 * 2025-tables-in-2026 does not silently carry into 2027. The warnings come
 * back when the year rolls over, which is exactly when someone should look
 * again.
 */
export interface TaxTablesAcceptance {
  readonly tablesYear: number;
  readonly forTransactionYear: number;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
  readonly note: string | null;
}

export interface TaxTableWarning {
  readonly code: 'TABLES_UNVERIFIED' | 'TABLES_WRONG_YEAR' | 'TABLES_ACCEPTED';
  /** ACCEPTED is informational; the other two are things to act on. */
  readonly severity: 'warn' | 'info';
  readonly message: string;
}

export function acceptanceCovers(
  acceptance: TaxTablesAcceptance | null,
  tables: TaxTables,
  transactionYear: number,
): boolean {
  return (
    acceptance !== null &&
    acceptance.tablesYear === tables.year &&
    acceptance.forTransactionYear === transactionYear
  );
}

/** Everything a caller should be told before believing a number from these. */
export function taxTableWarnings(
  tables: TaxTables,
  transactionYear: number,
  acceptance: TaxTablesAcceptance | null = null,
): TaxTableWarning[] {
  // An acceptance downgrades the noise to one honest line. It never claims the
  // tables are verified, because they are not.
  if (acceptanceCovers(acceptance, tables, transactionYear)) {
    const a = acceptance as TaxTablesAcceptance;
    return [
      {
        code: 'TABLES_ACCEPTED',
        severity: 'info',
        message:
          `${tables.year} tables, accepted as adequate for ${transactionYear} by ` +
          `${a.acceptedBy} on ${a.acceptedAt.slice(0, 10)}` +
          `${a.note ? ` (${a.note})` : ''}. Not IRS-verified.`,
      },
    ];
  }

  const warnings: TaxTableWarning[] = [];
  if (!tables.verified) {
    warnings.push({
      code: 'TABLES_UNVERIFIED',
      severity: 'warn',
      message:
        `the ${tables.year} tax tables have not been verified against an IRS release ` +
        `(source: ${tables.source})`,
    });
  }
  if (tables.year !== transactionYear) {
    warnings.push({
      code: 'TABLES_WRONG_YEAR',
      severity: 'warn',
      message: `reserving for a ${transactionYear} transaction using ${tables.year} tables`,
    });
  }
  return warnings;
}
