/**
 * The verdict: BUY, WATCH, PASS or REJECT — with reasons in words.
 *
 * ⚠️ **The reasons are generated, never written by a model.** Determinism is the
 * product; a recommendation you cannot reconstruct is a recommendation you
 * cannot audit. Every line here comes from a constraint code or a scored
 * component.
 *
 * ⚠️ **A failing capital gate is fatal, whatever the score.** The gates are
 * evaluated independently of the Buy Score and are checked first. Profit is not
 * an input to any of them.
 *
 * SCORING_SPEC §5. Pure.
 */

import type { Bps } from '../core/money.js';
import { formatCents } from '../core/money.js';
import type { ModePolicy } from '../core/capital/policy.js';
import type { ConstraintAssessment } from '../core/capital/constraints.js';
import type { BuyScoreBreakdown } from './buy-score.js';
import type { RiskBreakdown, RiskFactor } from './risk-score.js';

export const RECOMMENDATIONS = ['BUY', 'WATCH', 'PASS', 'REJECT'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** How far below `minBuyScore` still counts as worth watching. */
export const WATCH_BAND = 10;

export interface RecommendationResult {
  readonly recommendation: Recommendation;
  /** Ordered, human-readable. The first line is the headline reason. */
  readonly reasons: readonly string[];
  readonly buyScore: number;
  readonly riskScore: number;
  readonly confidenceBps: Bps;
}

const RISK_FACTOR_LABELS: Readonly<Record<RiskFactor, string>> = {
  capitalConsumed: 'share of the fund in one item',
  modeledDownside: 'modeled downside',
  compUncertainty: 'thin or scattered comps',
  counterfeitRisk: 'counterfeit risk',
  holdUncertainty: 'uncertain hold time',
  priceVolatility: 'volatile prices',
  conditionUncertainty: 'uncertain condition',
  returnRisk: 'return risk',
  concentration: 'category concentration',
  sellerRisk: 'seller risk',
  shippingComplexity: 'shipping complexity',
  restockRisk: 'restock or reprint risk',
};

export interface RecommendInputs {
  readonly gates: ConstraintAssessment;
  readonly buy: BuyScoreBreakdown;
  readonly risk: RiskBreakdown;
  readonly confidenceBps: Bps;
  readonly maxPriceCents: number;
  readonly policy: ModePolicy;
}

export function recommend(inputs: RecommendInputs): RecommendationResult {
  const { gates, buy, risk, confidenceBps, policy } = inputs;
  const base = {
    buyScore: buy.score,
    riskScore: risk.score,
    confidenceBps,
  };

  // A failed gate ends it. No score rescues a capital rule.
  if (gates.failures.length > 0) {
    return {
      ...base,
      recommendation: 'REJECT',
      reasons: [
        gates.failures.length === 1
          ? 'Rejected on a capital rule:'
          : `Rejected on ${gates.failures.length} capital rules:`,
        ...gates.failures.map((f) => `${f.code} — ${f.message}`),
      ],
    };
  }

  const scoreOk = buy.score >= policy.minBuyScore;
  const riskOk = risk.score <= policy.maxRiskScore;
  const confidenceOk = confidenceBps >= policy.minConfidenceBps;

  if (scoreOk && riskOk && confidenceOk) {
    return {
      ...base,
      recommendation: 'BUY',
      reasons: [
        `Buy at up to ${formatCents(inputs.maxPriceCents)}.`,
        ...strengths(buy),
        ...(buy.boundBy === 'NONE'
          ? []
          : [`Score held down by ${capLabel(buy)}, not by the weighted components.`]),
        `Risk ${risk.score}/${policy.maxRiskScore}, mostly ${riskDrivers(risk)}.`,
      ],
    };
  }

  const shortfalls: string[] = [];
  if (!scoreOk) shortfalls.push(`buy score ${buy.score} vs ${policy.minBuyScore} needed`);
  if (!riskOk) shortfalls.push(`risk ${risk.score} vs ${policy.maxRiskScore} allowed`);
  if (!confidenceOk) {
    shortfalls.push(
      `confidence ${(confidenceBps / 100).toFixed(0)}% vs ` +
        `${(policy.minConfidenceBps / 100).toFixed(0)}% needed`,
    );
  }

  // Close on score but not there is worth watching — the price may move, or
  // better comps may turn up. Not close is a pass.
  const watchable = riskOk && buy.score >= policy.minBuyScore - WATCH_BAND;

  return {
    ...base,
    recommendation: watchable ? 'WATCH' : 'PASS',
    reasons: [
      watchable
        ? `Close, but not yet: ${shortfalls.join('; ')}.`
        : `Pass: ${shortfalls.join('; ')}.`,
      ...weaknesses(buy),
      ...(watchable
        ? [`Would qualify at a lower price — up to ${formatCents(inputs.maxPriceCents)}.`]
        : []),
    ],
  };
}

function capLabel(buy: BuyScoreBreakdown): string {
  return buy.boundBy === 'VELOCITY'
    ? `expected hold time (ceiling ${buy.velocityCap})`
    : `confidence (ceiling ${buy.confidenceCap})`;
}

const COMPONENT_LABELS = {
  demand: 'demand',
  speed: 'expected speed of sale',
  profit: 'profit',
  roi: 'ROI',
  comp: 'comp quality',
  ops: 'ease of handling',
} as const;

type Component = keyof typeof COMPONENT_LABELS;

function ranked(buy: BuyScoreBreakdown): Component[] {
  return (Object.keys(COMPONENT_LABELS) as Component[]).sort(
    (a, b) => buy[b] - buy[a] || a.localeCompare(b),
  );
}

function strengths(buy: BuyScoreBreakdown): string[] {
  const best = ranked(buy).slice(0, 2);
  return [`Strongest on ${best.map((c) => COMPONENT_LABELS[c]).join(' and ')}.`];
}

function weaknesses(buy: BuyScoreBreakdown): string[] {
  const worst = ranked(buy).slice(-2).reverse();
  return [`Weakest on ${worst.map((c) => COMPONENT_LABELS[c]).join(' and ')}.`];
}

function riskDrivers(risk: RiskBreakdown): string {
  return risk.topDrivers.map((f) => RISK_FACTOR_LABELS[f]).join(', ');
}
