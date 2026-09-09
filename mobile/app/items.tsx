import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { daysBetween } from '../../src/core/ids.js';
import { holdsCapital, type ItemRecord } from '../../src/core/capital/state.js';
import { useFund } from '../src/fund/FundProvider.js';
import { C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * What the fund is holding, and what it held.
 *
 * ⚠️ **The shelf and the history are one list with a filter, not two screens.**
 * An item's whole point is that it moves between those states, and splitting
 * them makes "what happened to that thing I bought" a navigation problem.
 */

type Filter = 'HOLDING' | 'SOLD' | 'ALL';

function age(item: ItemRecord, now: string): string {
  if (item.soldAt) {
    return item.daysToSale === undefined ? 'sold' : `sold in ${item.daysToSale}d`;
  }
  return `${daysBetween(item.acquiredAt, now)}d held`;
}

function Item({ item, now }: { item: ItemRecord; now: string }) {
  const profit = item.realizedProfitCents;
  const isSold = item.state === 'SOLD' || item.state === 'PASSIVE_RECOVERY';
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: C.text, fontSize: 16, flexShrink: 1 }}>{item.name}</Text>
        <Text
          style={{ color: isSold ? (profit >= 0 ? C.good : C.bad) : C.dim, fontSize: 16 }}
        >
          {isSold ? formatCents(profit) : formatCents(item.bookValueCents)}
        </Text>
      </View>
      <Text style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
        {item.itemId} · {item.category} · {age(item, now)}
        {item.state === 'ACTIVE' || isSold ? '' : ` · ${item.state}`}
      </Text>

      <View style={{ height: 6 }} />
      <Row label="Cost" value={formatCents(item.landedCostCents)} tone="dim" />
      {item.expectedProfitCents !== undefined ? (
        <Row label="Expected profit" value={formatCents(item.expectedProfitCents)} tone="dim" />
      ) : null}
      {isSold && item.actualNetProceedsCents !== undefined ? (
        <Row label="Netted" value={formatCents(item.actualNetProceedsCents)} tone="dim" />
      ) : null}
      {item.chargeOffReason ? (
        <Row label="Charged off" value={item.chargeOffReason} tone="bad" />
      ) : null}

      {/* ⛔ D4 follows the item for life. An override visible only on the screen
          that recorded it is a silent override by the second day. */}
      {item.overrodeGates ? (
        <View style={{ marginTop: 8, borderLeftWidth: 2, borderLeftColor: C.warn, paddingLeft: 10 }}>
          <Text style={{ color: C.warn, fontSize: 12 }}>
            Overrode {item.overrodeGates.join(', ')}
          </Text>
          <Text style={{ color: C.dim, fontSize: 13, lineHeight: 18 }}>
            {item.overrideReason ?? 'no reason recorded'}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export default function Items() {
  const { state } = useFund();
  const [filter, setFilter] = useState<Filter>('HOLDING');
  const now = new Date().toISOString();

  const items = useMemo(() => {
    const all = Object.values(state.items);
    const chosen =
      filter === 'ALL'
        ? all
        : filter === 'HOLDING'
          ? all.filter((i) => holdsCapital(i.state))
          : all.filter((i) => !holdsCapital(i.state));
    // Newest first: what you just bought is what you are looking for.
    return [...chosen].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
  }, [state.items, filter]);

  const onShelf = Object.values(state.items).filter((i) => holdsCapital(i.state));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 14 }}>
        <H1>Items</H1>
        <Muted>
          {onShelf.length} on the shelf,{' '}
          {formatCents(onShelf.reduce((acc, i) => acc + i.bookValueCents, 0))} tied up.
        </Muted>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['HOLDING', 'SOLD', 'ALL'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={({ pressed }) => ({
                backgroundColor: f === filter ? C.line : C.card,
                borderWidth: 1,
                borderColor: f === filter ? C.good : C.line,
                borderRadius: 8,
                paddingHorizontal: 14,
                minHeight: 44,
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: C.text, fontSize: 14 }}>{f}</Text>
            </Pressable>
          ))}
        </View>

        {items.length === 0 ? (
          <Muted>Nothing here.</Muted>
        ) : (
          items.map((item) => <Item key={item.itemId} item={item} now={now} />)
        )}

        <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
