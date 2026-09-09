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
