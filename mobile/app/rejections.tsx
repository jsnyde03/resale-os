import { useMemo } from 'react';
import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { rejectionsView } from '../../src/screens/rejections.js';
import { OpportunityReader } from '../../src/db/repositories/opportunities.js';
import { useFund } from '../src/fund/FundProvider.js';
import { C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * *Why is nothing passing?*
 *
 * ⛔ **Backlog B3, and it needed 6.0.3 first.** Nothing recorded a refusal until
 * checking an item started saving it, so this question had no data behind it. A
 * walk-away is most of what an operator does in a day.
 *
 * ⚠️ The gates OVERLAP — one refusal can fail several at once — so the shares
 * legitimately sum past 100%. Normalising them would be inventing a denominator
 * to make a chart look tidy.
 */
export default function Rejections() {
  const { store } = useFund();

  const view = useMemo(
    () => rejectionsView(new OpportunityReader(store.db).rejectionHistogram()),
    [store],
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 16 }}>
        <H1>What is stopping you</H1>

        <Card
          style={{
            borderWidth: 1,
            borderColor: !view.readable ? C.bad : view.conclusive ? C.line : C.warn,
          }}
        >
          <Text
            style={{
              color: !view.readable ? C.bad : view.conclusive ? C.text : C.warn,
              fontSize: 16,
              lineHeight: 23,
            }}
          >
            {view.headline}
          </Text>
        </Card>

        {view.rows.length > 0 ? (
          <Card>
            {view.rows.map((r) => (
              <Row
                key={r.code}
                label={r.wording}
                value={`${r.n}`}
                tone={r === view.rows[0] && view.conclusive ? 'warn' : 'dim'}
              />
            ))}
          </Card>
        ) : null}

        {/* ⚡ The number that turns the top row into an action. The hold gate is
            the one predicted to dominate, and it inverts exactly. */}
        {view.conclusive && view.rows[0]?.code === 'HOLD_TOO_LONG' ? (
          <Muted>
            Hold time is derived: 90 × (listed + 1) ÷ sold-in-90. To clear it, look for roughly
            4.3 × (listed + 1) sold — against ten listings that is about 48. The aisle screen
            prints the exact number for whatever you are holding.
          </Muted>
        ) : null}

        {!view.readable ? (
          <Muted>
            {view.unreadableRows} refusal{view.unreadableRows === 1 ? '' : 's'} could not be read.
            That is a defect in how they were stored, not a fund that refuses nothing — the two
            look identical on a chart, which is why this line exists.
          </Muted>
        ) : null}

        <Muted>
          Gates overlap, so one refusal can appear on several rows. The counts are refusals, not
          items.
        </Muted>

        <Link href="/sourcing" style={{ color: C.faint, paddingTop: 8 }}>
          score something →
        </Link>
        <Link href="/" style={{ color: C.faint }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
