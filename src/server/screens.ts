/**
 * The primary screen, as data.
 *
 * A React component is the one part of this system that cannot be asserted
 * without a browser, and a browser is exactly what is not available here. So
 * the *decisions* a screen makes — which rows appear, in what order, which
 * warnings fire and how loud — live in this file, where they are ordinary
 * functions with ordinary tests. The `.tsx` becomes a renderer that adds no
 * judgement of its own.
 *
 * ⛔ No arithmetic on money here either. This reads `views.ts`, which reads
 * `src/core`. Anything that needs computing is computed there.
 */

import type { DashboardView } from '../screens/views.js';
import type { Money } from '../screens/views.js';

/** How hard a line shouts. `alarm` is reserved for "this ledger is wrong". */
export type Tone = 'normal' | 'muted' | 'notice' | 'alarm';

export interface ScreenRow {
  readonly label: string;
  readonly value: string;
  readonly tone: Tone;
  /** Set on the one figure a section exists to communicate. */
  readonly lead?: boolean;
}

export interface ScreenSection {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ScreenRow[];
  readonly note?: string;
  readonly noteTone?: Tone;
}

export interface ScreenBanner {
  readonly id: string;
  readonly tone: 'alarm' | 'notice';
  readonly headline: string;
  readonly detail: readonly string[];
}

export interface PrimaryScreen {
  /** Shown above everything. Empty on a healthy fund, which is the common case. */
  readonly banners: readonly ScreenBanner[];
  readonly sections: readonly ScreenSection[];
  readonly footer: string;
}

const row = (label: string, value: string, tone: Tone = 'normal', lead = false): ScreenRow =>
  lead ? { label, value, tone, lead } : { label, value, tone };

const cash = (label: string, m: Money, tone: Tone = 'normal', lead = false): ScreenRow =>
  row(label, m.text, tone, lead);

/**
 * ⚠️ Order is the design.
 *
 * The operator is standing in a shop holding something, and the question is
 * *what can I spend on this* — not *what is the fund worth*. So spendable money
 * leads and NAV is context beneath it. Getting this backwards produces a
 * dashboard that is accurate and useless.
 */
export function primaryScreen(view: DashboardView): PrimaryScreen {
  const { headline: h, integrity: i, reachability: r, profit: p, tax: t } = view;

  const banners: ScreenBanner[] = [];

  // An unverifiable ledger invalidates every number below it, so it goes first
  // and it is the only thing allowed to be an alarm.
  if (!i.ok) {
    const detail: string[] = [];
    if (!i.chainOk) detail.push(`hash chain broken at ${i.chainBrokenAt ?? 'an unknown event'}`);
    if (!i.replayOk) detail.push(`replay mismatch: ${i.replayDifferences.join('; ')}`);
    if (!i.expenseDriftOk) {
      detail.push(`expense drift on ${i.expenseDrift.length} event(s)`);
    }
    detail.push('Do not record anything else until `verify` passes.');
    banners.push({
      id: 'integrity',
      tone: 'alarm',
      headline: 'This ledger does not verify.',
      detail,
    });
  }

  // Not an alarm: the numbers are right, the rules are just impossible to
  // satisfy. The operator meets this as a wall of rejections otherwise.
  if (!r.reachable) {
    banners.push({
      id: 'reachability',
      tone: 'notice',
      headline: `The ${r.minProfit.text} profit floor is not reachable at this bankroll.`,
      detail: [
        `A ${r.maxPerItem.text} item must sell for ${r.grossNeeded.text} gross to clear it — ` +
          `${r.requiredMultiple.toFixed(1)}x on every flip.`,
        `At a 3x flip that floor implies a bankroll of about ${r.impliedBankroll.text}.`,
        'Either fund it to there, or lower minExpectedProfitCents.',
      ],
    });
  }

  const sections: ScreenSection[] = [
    {
      id: 'spendable',
      title: 'Can spend now',
      rows: [
        cash('Deployable', h.deployable, 'normal', true),
        cash('Max per item', h.maxPerItem),
        row('Max hold', `${h.maxHoldDays} days`),
        cash('Min profit per flip', h.minExpectedProfit),
      ],
      note: `${h.mode} · ${h.activeItems} active item${h.activeItems === 1 ? '' : 's'}`,
      noteTone: 'muted',
    },
    {
      id: 'bankroll',
      title: 'Bankroll',
      rows: [
        cash('NAV', h.nav, 'normal', true),
        cash('liquid cash', h.liquid, 'muted'),
        cash('inventory at cost', h.inventoryAtCost, 'muted'),
        cash('less earmarks', h.earmarked, 'muted'),
        cash('Unencumbered cash', h.unencumberedCash),
        cash('Liquid floor', h.liquidFloor, 'muted'),
      ],
      ...(h.setAsideSuppressed
        ? {
            note:
              `Set-aside OFF until ${h.setAsideFloor.text} — ` +
              'every after-tax cent compounds. Tax still accrues.',
            noteTone: 'notice' as Tone,
          }
        : {}),
    },
    {
      id: 'earmarks',
      title: 'Spoken for',
      rows: [
        cash('Tax reserve', h.taxReserve),
        cash('Operating reserve', h.operatingReserve),
        cash('Owner payable', h.ownerPayable),
      ],
      note: 'Inside NAV, not available to deploy.',
      noteTone: 'muted',
    },
  ];

  // Only when there is exposure to show. An empty table is noise on a phone.
  if (h.categoryExposure.length > 0) {
    sections.push({
      id: 'exposure',
      title: `Category exposure (cap ${h.categoryCap.text})`,
      rows: h.categoryExposure.map((e) =>
        cash(e.category, e.amount, e.amount.cents > h.categoryCap.cents ? 'notice' : 'normal'),
      ),
    });
  }

  sections.push({
    id: 'profit',
    title: 'Profit',
    rows: [
      cash('Item profit', p.itemProfit),
      cash('less business expenses', p.businessExpenses, 'muted'),
      cash('Operating profit', p.operatingProfit, 'normal', true),
      cash('less tax reserve', p.taxReserve, 'muted'),
      cash('Owner distributable', p.ownerDistributable),
    ],
    note: `${p.soldItems} sold · ${p.chargedOffItems} charged off`,
    noteTone: 'muted',
  });

  sections.push({
    id: 'tax',
    title: `Tax — ${t.year}`,
    rows: [
      cash('Business income YTD', t.businessIncomeYtd),
      cash('Reserved so far', t.reservedSoFar, 'muted'),
      cash('Reserve on hand', t.reserveOnHand, 'muted'),
    ],
    // An abstention is the more important thing to say, so it wins the slot.
    ...(t.incomeTaxAbstained
      ? {
          note: 'No tax profile set — income tax abstains rather than guessing.',
          noteTone: 'notice' as Tone,
        }
      : t.warnings.length > 0
        ? {
            note: t.warnings.map((w) => w.message).join(' '),
            noteTone: (t.warnings.some((w) => w.severity === 'warn')
              ? 'notice'
              : 'muted') as Tone,
          }
        : {}),
  });

  return { banners, sections, footer: backupFooter(view) };
}

/**
 * Backup state is a footnote, not a banner. It is a risk to the future rather
 * than evidence that anything on screen is wrong, and a red bar that usually
 * means nothing trains the operator to ignore red bars.
 */
export function backupFooter(view: DashboardView): string {
  const i = view.integrity;
  if (!i.backupConfigured) return 'Backup NOT CONFIGURED — run: backup config --to=<dir>';
  if (i.backupLastSuccessAt === null) return 'Backup never run.';
  if (i.backupStale) return `Backup ${i.backupEventsBehind} event(s) behind.`;
  return `Backup current (${i.backupLastSuccessAt.slice(0, 10)}) · ${view.headline.eventCount} events`;
}
