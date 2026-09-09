import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import type { StoredEvent } from '../../src/db/store.js';
import { useFund } from '../src/fund/FundProvider.js';
import { C, Card, H1, Muted } from '../src/ui/theme.js';

/**
 * Every event, in order, with its id.
 *
 * ⚡ **The id is the point.** Reversing a business expense needs
 * `reversesEventId`, and 5.6.4 deliberately withheld expense reversal from the
 * adjust screen rather than ship a version that moved the ledger without the
 * analytic `expenses` table — after which operating profit and the category
 * breakdown quietly disagree. This screen is what makes the id reachable, so
 * that reversal has somewhere to start.
 *
 * ⚠️ **It shows the hash, and whether the chain verifies.** The ledger is
 * tamper-evident and that is worth nothing if nobody can see the evidence.
 */

/** Newest first, and capped — a phone scrolling 10,000 events helps nobody. */
const PAGE = 40;

function EventRow({
  event,
  postings,
  expanded,
  onToggle,
}: {
  event: StoredEvent;
  postings: { account: string; amount_cents: number }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable onPress={onToggle}>
      <Card style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ color: C.text, fontSize: 15, flexShrink: 1 }}>{event.type}</Text>
          <Text style={{ color: C.faint, fontSize: 12 }}>{event.occurred_at.slice(0, 10)}</Text>
        </View>
        <Text selectable style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
          {event.event_id}
          {event.item_id ? ` · ${event.item_id}` : ''}
        </Text>
        {event.memo ? (
          <Text style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>{event.memo}</Text>
        ) : null}

        {expanded ? (
          <View style={{ marginTop: 10, gap: 3 }}>
            {postings.length === 0 ? (
              // ⚠️ A books-only event genuinely has none. Without saying so it
              // renders as a bare line and the reader cannot tell what it did.
              <Text style={{ color: C.faint, fontSize: 13 }}>(no postings — books only)</Text>
            ) : (
              postings.map((p, i) => (
                <View
                  key={`${p.account}-${i}`}
                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                >
                  <Text style={{ color: C.dim, fontSize: 13 }}>{p.account}</Text>
                  <Text
                    style={{ color: p.amount_cents >= 0 ? C.text : C.dim, fontSize: 13 }}
                  >
                    {formatCents(p.amount_cents)}
                  </Text>
                </View>
              ))
            )}
            <Text selectable style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>
              hash {event.hash.slice(0, 16)}…
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function Ledger() {
  const { store, state } = useFund();
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const events = useMemo(() => [...store.events()].reverse(), [store, state.eventCount]);
  const chain = useMemo(() => store.verifyChain(), [store, state.eventCount]);
  const postings = useMemo(
    () => (open ? store.postingsFor(open) : []),
    [store, open],
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 12 }}>
        <H1>Ledger</H1>

        <Card style={{ borderWidth: 1, borderColor: chain.ok ? C.good : C.bad }}>
          <Text style={{ color: chain.ok ? C.good : C.bad, fontSize: 15 }}>
            {chain.ok
              ? `Hash chain verifies across ${events.length} events`
              : `THE CHAIN IS BROKEN at ${chain.brokenAt}`}
          </Text>
          {!chain.ok ? (
            <Muted>
              An event was changed after it was written. Nothing here can repair that — restore
              from a backup and re-record anything since.
            </Muted>
          ) : null}
        </Card>

        {events.slice(0, limit).map((event) => (
          <EventRow
            key={event.event_id}
            event={event}
            postings={open === event.event_id ? postings : []}
            expanded={open === event.event_id}
            onToggle={() => setOpen(open === event.event_id ? null : event.event_id)}
          />
        ))}

        {limit < events.length ? (
          <Pressable onPress={() => setLimit(limit + PAGE)}>
            <Text style={{ color: C.dim, fontSize: 14, paddingVertical: 12 }}>
              show {Math.min(PAGE, events.length - limit)} more of {events.length}
            </Text>
          </Pressable>
        ) : null}

        <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
