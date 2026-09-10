import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { accuracyView, profitView, taxView } from '../../src/screens/views.js';
import { useFund } from '../src/fund/FundProvider.js';
import { C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * Profit, accuracy and tax.
 *
 * ⛔ **Every number here comes from `src/screens/views.ts`** — the read model
 * the Gate 4 dashboard used, imported unchanged. Not ported, not
 * reimplemented: a second implementation of "what did this fund earn" is how
 * two screens end up both looking right and disagreeing.
 *
 * ⚠️ It was one import from being unusable here. `views.ts` reached
 * `node:sqlite` through `db/backup.js` → `db/driver.js`, which would have
 * dragged the desktop driver into the bundle; `scripts/check-phone-bundle.mjs`
 * now walks that graph on every `npm run check`.
 */

type Tab = 'PROFIT' | 'ACCURACY' | 'TAX';

const pct = (bps: number): string => `${Math.round(bps / 100)}%`;

function Profit() {
  const { store, state } = useFund();
  const v = useMemo(() => profitView(store), [store, state.eventCount]);
  return (
    <View style={{ gap: 14 }}>
      <Card>
        <Row label="Item profit" value={v.itemProfit.text} />
        <Row label="Business expenses" value={v.businessExpenses.text} tone="dim" />
        <Row
          label="Operating profit"
          value={v.operatingProfit.text}
          tone={v.operatingProfit.cents >= 0 ? 'good' : 'bad'}
        />
        <Row label="Realised ROI" value={pct(v.realisedRoi)} tone="dim" />
      </Card>

      <Card>
        <Row label="Tax reserve" value={v.taxReserve.text} tone="dim" />
        <Row label="Owner distributable" value={v.ownerDistributable.text} tone="dim" />
        <Row label="Owner paid" value={v.ownerPaid.text} tone="dim" />
        <Row label="Owner payable" value={v.ownerPayable.text} />
      </Card>

      <Card>
        <Row label="Sold" value={String(v.soldItems)} tone="dim" />
        <Row label="Charged off" value={`${v.chargedOffItems} · ${v.chargeOff.text}`} tone="dim" />
        <Row label="Recovered" value={v.recovery.text} tone="dim" />
      </Card>

      {v.expenses.length > 0 ? (
        <Card>
          <Text style={{ color: C.dim, fontSize: 13, marginBottom: 6 }}>Where it went</Text>
          {v.expenses.map((e) => (
            <Row
              key={`${e.category}-${e.scope}-${String(e.capitalized)}`}
              // ⚠️ `capitalized` costs were folded into an item's book value at
              // purchase. Showing them beside deductible spend without saying so
              // would double-count them by eye.
              label={`${e.category}${e.capitalized ? ' (in book value)' : ''} ×${e.n}`}
              value={e.total.text}
              tone="dim"
            />
          ))}
        </Card>
      ) : (
        <Muted>No expenses recorded yet.</Muted>
      )}
    </View>
  );
}

function Accuracy() {
  const { store, state } = useFund();
  const v = useMemo(() => accuracyView(store), [store, state.eventCount]);

  return (
    <View style={{ gap: 14 }}>
      <Card>
        <Text style={{ color: C.text, fontSize: 15 }}>{v.verdict}</Text>
      </Card>

      <Card>
        <Row label="Sales measured" value={String(v.n)} />
        {/* ⛔ B59: kept apart, never summed into one median. A model's
            expectation and the operator's are different things. */}
        <Row label="from the scorer" value={String(v.scoredN)} indent tone="dim" />
        <Row label="priced by you" value={String(v.quotedN)} indent tone="dim" />
        {v.unpredictedN > 0 ? (
          <Row label="no prediction (excluded)" value={String(v.unpredictedN)} tone="warn" />
        ) : null}
      </Card>

      {v.readable ? (
        <>
          <Card>
            <Row
              label="Median days error"
              value={`${v.medianDaysError >= 0 ? '+' : ''}${v.medianDaysError}d`}
              tone={Math.abs(v.medianDaysError) <= 2 ? 'good' : 'warn'}
            />
            <Row label="Sold on time or early" value={pct(v.onTimeBps)} tone="dim" />
            <Row label="Median proceeds error" value={v.medianProceedsError.text} tone="dim" />
            <Row label="Met expected proceeds" value={pct(v.proceedsMetBps)} tone="dim" />
          </Card>
          <Card>
            <Row label="Expected profit" value={v.totalExpectedProfit.text} tone="dim" />
            <Row label="Actual profit" value={v.totalActualProfit.text} />
            <Row
              label="Realisation"
              value={pct(v.profitRealisationBps)}
              tone={v.profitRealisationBps >= 10_000 ? 'good' : 'warn'}
            />
          </Card>
        </>
      ) : (
        // ⚠️ The view carries `readable` precisely so a screen can refuse to
        // draw a trend rather than draw a misleading one. A ratio from three
        // sales is a rumour.
        <Muted>
          Too few sales to read a trend. The figures exist and they do not mean anything yet —
          they are deliberately not drawn.
        </Muted>
      )}

      {v.unpredictedN > 0 ? (
        <Muted>
          {v.unpredictedN} sold item{v.unpredictedN === 1 ? '' : 's'} carried no prediction and
          {v.unpredictedN === 1 ? ' is' : ' are'} excluded. Say what you expect to sell for when
          you buy, and the purchase becomes measurable.
        </Muted>
      ) : null}
    </View>
  );
}

function Tax() {
  const { store, state } = useFund();
  const v = useMemo(() => taxView(store), [store, state.eventCount]);
  return (
    <View style={{ gap: 14 }}>
      <Card>
        <Row label={`Business income ${v.year}`} value={v.businessIncomeYtd.text} />
        <Row label="Reserved so far" value={v.reservedSoFar.text} />
        <Row
          label="Reserve on hand"
          value={v.reserveOnHand.text}
          tone={v.reserveOnHand.cents >= v.reservedSoFar.cents ? 'good' : 'bad'}
        />
      </Card>

      <Card>
        <Text style={{ color: C.dim, fontSize: 13, marginBottom: 6 }}>
          What the reserve covers
        </Text>
        <Row label="Self-employment" value={v.selfEmployment.text} tone="dim" />
        <Row label="Federal income" value={v.federalIncome.text} tone="dim" />
        <Row label="State income" value={v.stateIncome.text} tone="dim" />
        <Row label="Total" value={v.total.text} />
      </Card>

      {/* ⛔ Income tax ABSTAINS without a profile, and every consumer must say
          so. A reserve that silently omits income tax looks like a small one. */}
      {v.incomeTaxAbstained ? (
        <Card style={{ borderWidth: 1, borderColor: C.warn }}>
          <Text style={{ color: C.warn, fontSize: 15, marginBottom: 6 }}>
            Income tax is not being estimated
          </Text>
          <Muted>
            No tax profile is set, so only self-employment tax is reserved. The number above is
            not what you will owe.
          </Muted>
        </Card>
      ) : null}

      {v.warnings.map((w) => (
        <Card
          key={w.code}
          style={{ borderWidth: 1, borderColor: w.severity === 'warn' ? C.warn : C.line }}
        >
          {/* ⚠️ Severity is carried through rather than flattened — rendering
              "accepted" as an alarm teaches the operator to ignore alarms. */}
          <Text style={{ color: w.severity === 'warn' ? C.warn : C.dim, fontSize: 13, lineHeight: 19 }}>
            {w.message}
          </Text>
        </Card>
      ))}
    </View>
  );
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('PROFIT');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 14 }}>
        <H1>Reports</H1>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['PROFIT', 'ACCURACY', 'TAX'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={({ pressed }) => ({
                backgroundColor: t === tab ? C.line : C.card,
                borderWidth: 1,
                borderColor: t === tab ? C.good : C.line,
                borderRadius: 8,
                paddingHorizontal: 14,
                minHeight: 44,
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: C.text, fontSize: 14 }}>{t}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'PROFIT' ? <Profit /> : tab === 'ACCURACY' ? <Accuracy /> : <Tax />}

        <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
