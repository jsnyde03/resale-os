/**
 * One completeness check for every versioned config this project stores.
 *
 * ⛔ **Backlog B30.** Four variants of the same bug shipped in two days: a
 * stored config predating a field the code now requires, reaching a calculation
 * as `undefined` and coming out as `NaN`. `minSellThroughBps` did exactly that
 * and printed "vs a NaN% minimum"; it failed closed by luck.
 *
 * The fix is not a longer hand-written list of checks — a list is only correct
 * until the next field is added, and then it is silently wrong. **Drive the
 * check off the DEFAULTS object**: every key present there must be present in
 * the stored value, so adding a field to the type makes it required here with
 * no further edit.
 *
 * ⚠️ Optionality falls out for free. A key absent from the defaults is not
 * required, which is exactly how a genuinely optional field like
 * `stateJurisdiction` should behave.
 */

export function missingConfigKeys<T extends object>(defaults: T, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['(the whole object)'];
  const candidate = value as Record<string, unknown>;
  const missing: string[] = [];
  for (const key of Object.keys(defaults)) {
    // `null` is a legitimate stored value — `stateRateBasis` and
    // `itemizedDeductionCents` both use it to mean "deliberately not set".
    // Only `undefined` and an absent key are the failure being caught.
    if (!(key in candidate) || candidate[key] === undefined) missing.push(key);
  }
  return missing;
}

/**
 * Throws with the repair instruction when a stored config is older than the
 * code. `repair` is the command that fixes it — a message that names the
 * problem without naming the fix makes the operator go and find it.
 */
export function assertConfigShape<T extends object>(
  defaults: T,
  value: unknown,
  label: string,
  repair: string,
  fail: (message: string) => never,
): void {
  const missing = missingConfigKeys(defaults, value);
  if (missing.length === 0) return;
  fail(
    `stored ${label} is missing ${missing.join(', ')} — it is older than the code. Run: ${repair}`,
  );
}
