import { Link } from 'expo-router';
import Contract from './contract';
import { ScrollView, Text, View } from 'react-native';

// ⛔ The whole point of 5.2: the engine is imported UNCHANGED, straight from
// the repo's `src/`. Not copied, not adapted, not re-exported through a shim.
// If any of these needed an edit to load here, the purity claim from Gate 1 was
// wrong and we want to know now rather than after the UI is built.
import { initialFundState } from '../../src/core/capital/state.js';
import { applyCommand } from '../../src/core/capital/engine.js';
import { computeMetrics } from '../../src/core/capital/metrics.js';
import { DEFAULT_POLICY } from '../../src/core/capital/policy.js';
import { formatCents } from '../../src/core/money.js';
import { parseOpportunity } from '../../src/domain/opportunity.js';
import { evaluateOpportunity } from '../../src/scoring/evaluate.js';

const T0 = '2026-09-09T12:00:00.000Z';

/** A real evaluation, run on the device, with no server and no network. */
function proof() {
  let state = initialFundState(DEFAULT_POLICY);
  state = applyCommand(state, { type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 }).state;

  const metrics = computeMetrics(state);
  const evaluation = evaluateOpportunity(
    parseOpportunity({
      opportunityId: 'proof',
      name: 'Lego set',
      category: 'TOYS',
      source: 'MANUAL',
      sourceUrl: null,
      askingPriceCents: 1_200,
      inboundShippingCents: 0,
      salesTaxCents: 0,
      acquisitionTravelCents: 0,
      expectedGrossCents: 6_000,
      marketplace: 'EBAY',
      postageCents: null,
      soldLast90Days: 50,
      activeListings: 8,
      operatorDaysEstimate: null,
      compPricesCents: [5_800, 6_100, 6_000],
      compMedianAgeDays: 45,
      hassleBps: 2_000,
    }),
    state,
  );

  return { metrics, evaluation };
}

export default function Index() {
  // ⚠️ CI builds with EXPO_PUBLIC_RUN_CONTRACT=1 so the driver contract runs on
  // launch and writes its verdict. A run that needed a tap would need a UI
  // driver, and the point of this lane is to need as little as possible.
  if (process.env.EXPO_PUBLIC_RUN_CONTRACT === '1') return <Contract />;

  const { metrics, evaluation } = proof();
  const rows: [string, string][] = [
    ['NAV', formatCents(metrics.navCents)],
    ['Deployable', formatCents(metrics.deployableCapitalCents)],
    ['Mode', metrics.mode],
    ['Max per item', formatCents(metrics.maxCapitalPerItemCents)],
    ['—', ''],
    ['Max price', formatCents(evaluation.price.maxPriceCents)],
    ['Bound by', evaluation.price.boundBy],
    ['Expected profit', formatCents(evaluation.economics.expectedProfitCents)],
    ['Days to sale', `${evaluation.economics.velocity.expectedDaysToSale}d`],
    ['Buy / risk', `${evaluation.result.buyScore} / ${evaluation.result.riskScore}`],
    ['Verdict', evaluation.result.recommendation],
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <View style={{ padding: 24, paddingTop: 72 }}>
        <Text style={{ color: '#fafafa', fontSize: 20, fontWeight: '600', marginBottom: 4 }}>
          Engine running on device
        </Text>
        <Text style={{ color: '#737373', fontSize: 13, marginBottom: 12 }}>
          src/core, src/scoring and src/domain, imported unchanged.
        </Text>
        <Link href="/contract" style={{ color: '#a3a3a3', marginBottom: 16 }}>
          run the driver contract →
        </Link>
        {rows.map(([label, value], i) => (
          <View
            key={`${label}-${i}`}
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
          >
            <Text style={{ color: '#a3a3a3' }}>{label}</Text>
            <Text style={{ color: '#fafafa', fontVariant: ['tabular-nums'] }}>{value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
