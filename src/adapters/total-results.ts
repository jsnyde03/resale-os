/**
 * `totalResults` — one field, three forms, and two of the naive parses are
 * catastrophic.
 *
 * ⛔ **This is the most dangerous line of code in the data route**, which is why
 * it is a file of its own with no network in it. Measured against the real API
 * on 2026-09-11:
 *
 * ```
 * sold search    "122956"      a clean integer
 * active search  "240,000+"    formatted, with a comma AND a plus
 * documented     null          a third form nobody had seen yet
 * ```
 *
 * ```
 * parseInt("240,000+")  ->  240     a thousandfold under
 * Number("240,000+")    ->  NaN
 * ```
 *
 * With 240,000 genuinely active, an item is a months-long hold. Misparsed as
 * 240 it clears every ceiling in the policy. ⚠️ And `NaN` has form here:
 * `minSellThroughBps` once reached a gate as `NaN` and printed *"vs a NaN%
 * minimum"*, failing closed by luck rather than by design.
 *
 * ⛔ **So a total that will not parse is REJECTED, never defaulted**, and the
 * `+` is carried as a FLOOR rather than rounded away — `90 × (active + 1)/sold`
 * is not linear in either count, and an ACTIVE floor is the unsafe direction.
 * See `CountBounds` in `core/velocity.ts`, and backlog **B77** and **B79**.
 *
 * Pure. No I/O, no clock.
 */

/** A count that parsed, and whether the source meant "at least". */
export interface ParsedTotal {
  readonly ok: true;
  readonly value: number;
  /** The source said `"240,000+"`: the true value is unknown and larger. */
  readonly isFloor: boolean;
}

export interface UnparseableTotal {
  readonly ok: false;
  /** What arrived, so a refusal can show it rather than describe it. */
  readonly raw: string;
  readonly reason: string;
}

export type TotalResult = ParsedTotal | UnparseableTotal;

/**
 * Either a bare run of digits, or comma-grouped thousands — optionally followed
 * by a `+`. Deliberately strict: `"1,2,3"`, `"1.5"`, `"about 500"` and `""` are
 * all refusals rather than best-effort readings.
 */
const TOTAL_RE = /^(\d{1,3}(?:,\d{3})*|\d+)(\+?)$/;

const bad = (raw: string, reason: string): UnparseableTotal => ({ ok: false, raw, reason });

export function parseTotalResults(raw: unknown): TotalResult {
  // ⚠️ `null` is the documented third form, and it is a refusal rather than a
  // zero. "The vendor does not know how many" and "there are none" are
  // different facts, and only one of them is safe to feed a gate.
  if (raw === null || raw === undefined) {
    return bad(String(raw), 'the vendor returned no total');
  }

  // A plain number would be a vendor change rather than a malformed value, so
  // it is accepted — but only if it is genuinely a count.
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) {
      return bad(String(raw), 'not a whole non-negative count');
    }
    return { ok: true, value: raw, isFloor: false };
  }

  if (typeof raw !== 'string') return bad(String(raw), `unexpected ${typeof raw}`);

  const cleaned = raw.trim();
  const match = TOTAL_RE.exec(cleaned);
  if (match === null) return bad(raw, 'not a number, with or without grouping');

  const [, digits, plus] = match as unknown as [string, string, string];
  const value = Number(digits.replace(/,/g, ''));

  // Belt and braces: a 22-digit total would parse above and arrive here as an
  // imprecise float. A count the language cannot hold exactly is not a count.
  if (!Number.isSafeInteger(value)) return bad(raw, 'too large to hold exactly');

  return { ok: true, value, isFloor: plus === '+' };
}
