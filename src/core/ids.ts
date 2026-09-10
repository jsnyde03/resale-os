/**
 * Item ids.
 *
 * ⚠️ **An item id is part of the command, so it is HASHED and permanent.** It
 * cannot be renamed later without breaking the chain, and it is what the
 * operator will read in every list for the life of the fund. So it is derived
 * deliberately rather than being whatever a UUID generator produced.
 *
 * On the desktop the operator typed one (`buy --id=pin-01`). On a phone that is
 * friction at exactly the wrong moment, standing in a shop, so it is derived
 * from what the thing is called plus the event count.
 */

/**
 * A readable, unique id.
 *
 * ⛔ Unique because `eventCount` only ever grows — every recorded event
 * increments it, imports included, and nothing removes events from an
 * append-only ledger. It is NOT the item count: two items could share a slug
 * and a position in the item list, but never a position in the event stream.
 */
export function itemIdFrom(name: string, eventCount: number): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
      // A trailing hyphen can survive the truncation above.
      .replace(/-$/, '') || 'item';
  return `${slug}-${String(eventCount + 1).padStart(4, '0')}`;
}

/**
 * The id a SCORED purchase carries.
 *
 * ⛔ **Its presence is a claim**: `accuracy.ts` reads `opportunityId` to tell a
 * scorer's prediction (SCORED) from a person's estimate (QUOTED), so it is set
 * only when the sourcing screen actually produced the numbers. A typed buy has
 * none, and `evaluatePurchase`'s internal placeholder never reaches a command.
 *
 * ⚠️ **Minted at the handoff, not at the evaluation.** Evaluating two items
 * without buying either leaves the ledger where it was, so both would take the
 * same event count — but at most one of them can then be the next purchase, and
 * the next increments it. Two recorded purchases can never share an id.
 * The earlier `aisle-<name>` form could: it was the name alone.
 */
export function opportunityIdFrom(name: string, eventCount: number): string {
  return `opp-${itemIdFrom(name, eventCount)}`;
}

/**
 * Whole days between two ISO timestamps, floored at zero.
 *
 * ⛔ **Derived, never typed.** `daysToSale` feeds the prediction-accuracy
 * report, and the CLI made it an optional `--days` flag the operator supplied
 * by hand — so an item bought on the 1st and sold on the 8th was recorded as
 * however many days the operator remembered, or as nothing at all. Both
 * timestamps are already on the record; the number should come from them.
 *
 * ⚠️ Whole days by floor, so anything under 24 hours is 0, which is the honest
 * answer for a same-day flip. It is not rounded up to 1 to look better.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`cannot read "${fromIso}" and "${toIso}" as timestamps`);
  }
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}
