import { useMemo } from 'react';
import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { watchlist, type WatchCandidate } from '../../src/screens/watchlist.js';
import { OpportunityReader } from '../../src/db/repositories/opportunities.js';
import { parseOpportunity } from '../../src/domain/opportunity.js';
import { evaluateOpportunity } from '../../src/scoring/evaluate.js';
import { formatCents } from '../../src/core/money.js';
import { useFund } from '../src/fund/FundProvider.js';
import { C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * The refusals that expire.
 *
 * ⛔ **Only "not yet" is here.** A buyable item is a decision and a
 * never-buyable one is a closed decision; keeping either would make this a list
 * of things to re-read forever. The before-scan measured that the closed ones
 * are the majority — so this screen is usually short, and that is the point.
 *
 * ⚠️ It RECOMPUTES against today's rules, which is the opposite of what the feed
 * does — and deliberately, because "at what bankroll would this clear" is only
 * answerable forward. Stored verdicts are untouched, and a row scored under
 * older rules is marked.
 */
export default function WatchlistScreen() {
  const { store, state, metrics } = useFund();

  const view = useMemo(() => {
    const rows = new OpportunityReader(store.db).list({ limit: 200 });
    const candidates: WatchCandidate[] = [];
    for (const r of rows) {
      // ⚠️ A row whose stored input cannot be parsed is skipped rather than
      // crashing the screen — it was written by an older shape, and one bad row
      // must not take the list with it.
      try {
        candidates.push({
          opportunityId: r.opportunity_id,
          input: parseOpportunity(JSON.parse(r.input_json)),
          policyVersion: r.policy_version,
        });
      } catch {
        continue;
      }
    }
    return watchlist(candidates, state, metrics.navCents, evaluateOpportunity);
  }, [store, state, metrics.navCents]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 16 }}>
        <H1>Waiting on the bankroll</H1>

        <Card style={{ borderWidth: 1, borderColor: view.rows.length > 0 ? C.warn : C.line }}>
          <Text style={{ color: view.rows.length > 0 ? C.text : C.dim, fontSize: 16, lineHeight: 23 }}>
            {view.headline}
          </Text>
        </Card>

        {view.rows.length > 0 ? (
          <Card>
            {view.rows.map((r) => (
              <View key={r.opportunityId} style={{ paddingVertical: 6 }}>
                <Row label={r.name} value={formatCents(r.unlocksAtCents)} tone="warn" />
                <Muted>
                  {formatCents(r.askingPriceCents)} asked · {formatCents(r.shortfallCents)} more
                  bankroll needed
                  {r.stale ? ' · scored under older rules' : ''}
                </Muted>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Row label="Bankroll now" value={formatCents(view.navCents)} tone="dim" />
          <Row label="Scored, all told" value={String(view.considered)} tone="dim" />
          {/* ⚡ Counted, never listed. The number matters — it is how much of what
              you pick up is closed rather than pending — but the items do not,
              because nothing about the fund changes them. */}
          <Row label="No bankroll would fix" value={String(view.closed)} tone="dim" />
        </Card>

        <Muted>
          These are recomputed against the rules as they stand now, not the verdict stored when
          they were scored. ⚠️ The rules get stricter as the fund grows, so a threshold can move.
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
