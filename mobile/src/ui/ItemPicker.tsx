import { Pressable, Text, View } from 'react-native';

import type { ItemRecord } from '../../../src/core/capital/state.js';
import { formatCents } from '../../../src/core/money.js';
import { C, Muted, NUM } from './theme.js';

/**
 * Choosing which item a command is about.
 *
 * ⛔ The desktop took an `--id`. On a phone that would mean remembering
 * `lego-millennium-falcon-0007` while standing at a counter, so the app shows
 * what the fund is actually holding and the operator taps it.
 *
 * ⚠️ **It shows the id anyway.** The id is what appears in the ledger, in a
 * backup and in every report, and hiding it would mean the operator never
 * learns the vocabulary their own records are written in.
 */
export function ItemPicker({
  items,
  selected,
  onSelect,
  empty,
}: {
  items: readonly ItemRecord[];
  selected: string | null;
  onSelect: (itemId: string) => void;
  empty: string;
}) {
  if (items.length === 0) return <Muted>{empty}</Muted>;
  return (
    <View style={{ gap: 8 }}>
      {items.map((item) => {
        const isSelected = item.itemId === selected;
        return (
          <Pressable
            key={item.itemId}
            onPress={() => onSelect(item.itemId)}
            style={({ pressed }) => ({
              backgroundColor: C.card,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isSelected ? C.good : C.line,
              padding: 14,
              minHeight: 48,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ color: C.text, fontSize: 15, flexShrink: 1 }}>{item.name}</Text>
              <Text style={{ color: C.dim, fontSize: 15, ...NUM }}>
                {formatCents(item.bookValueCents)}
              </Text>
            </View>
            <Text style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
              {item.itemId} · {item.category}
              {item.state === 'ACTIVE' ? '' : ` · ${item.state}`}
              {/* D4 follows the item everywhere it appears. An override that is
                  visible only on the screen that recorded it is a silent one
                  by the second day. */}
              {item.overrodeGates ? ` · overrode ${item.overrodeGates.length}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
