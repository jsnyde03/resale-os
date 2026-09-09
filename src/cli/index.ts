#!/usr/bin/env node
/**
 * The Gate 1-3 operator interface. There is no UI until Gate 4, and a fund you
 * cannot record a purchase into is not a fund.
 *
 * Amounts are typed as dollars ("12.34"); everything below this file is cents.
 */

import { FundStore, systemClock } from '../db/store.js';
import { openFundStore } from '../db/open-store.js';
import { DEFAULT_DB_PATH } from '../db/driver.js';
import { reconcile } from '../db/replay.js';
import { exportLedger, importLedger, LedgerTransferError, type LedgerExport } from '../db/portable.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { EngineError } from '../core/capital/engine.js';
import { InvariantViolation } from '../core/ledger/invariants.js';
import { computeMetrics } from '../core/capital/metrics.js';
import { maxAffordableLandedCost } from '../core/capital/constraints.js';
import { assessQuote } from '../core/capital/quote.js';
import { applyBps, formatCents, parseDollars, toBps } from '../core/money.js';
import { estimateNetProceeds, feeModel, grossNeededForNet } from '../core/fees.js';
import {
  estimateFromComps,
  estimateFromOperator,
  soldNeededForHold,
} from '../core/velocity.js';
import { assessProfitFloor } from '../core/capital/reachability.js';
import { accuracyReport, accuracyVerdict } from '../core/capital/accuracy.js';
import { profitReport, expenseBreakdown, expenseReversalDrift } from '../db/reporting.js';
import {
  backupStaleness,
  backupWithRetention,
  listBackups,
  defaultBackupDir,
} from '../db/backup.js';
import { evaluateOpportunity, type Evaluation } from '../scoring/evaluate.js';
import { parseOpportunity, type OpportunityStatus } from '../domain/opportunity.js';
import { incrementalReserve } from '../core/tax/annual.js';
import {
  DEFAULT_TAX_TABLES,
  taxTableWarnings,
  type FilingStatus,
} from '../core/tax/tables.js';
import { TaxProfileError } from '../core/tax/profile.js';
import { DEFAULT_POLICY, PolicyError, type Policy } from '../core/capital/policy.js';
import type { ChargeOffReason } from '../core/capital/state.js';
import type { Account } from '../core/ledger/accounts.js';
import type { ExpenseCategory } from '../core/capital/commands.js';

interface Args {
  readonly _: string[];
  readonly flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]!] = match[2] ?? 'true';
    else positional.push(arg);
  }
  return { _: positional, flags };
}

function money(args: Args, name: string, fallback?: string): number {
  const raw = args.flags[name] ?? fallback;
  if (raw === undefined) throw new Error(`missing --${name}`);
  return parseDollars(raw);
}

function int(args: Args, name: string, fallback?: number): number {
  const raw = args.flags[name];
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer`);
  return n;
}

function req(args: Args, name: string): string {
  const raw = args.flags[name];
  if (raw === undefined) throw new Error(`missing --${name}`);
  return raw;
}

const pad = (label: string, width = 24): string => label.padEnd(width, ' ');

function printStatus(store: FundStore, showBackup = false): void {
  const state = store.state();
  const m = computeMetrics(state);
  const rows: [string, string][] = [
    ['Bankroll (NAV)', formatCents(m.navCents)],
    ['  liquid cash', formatCents(m.liquidCents)],
    ['  inventory at cost', formatCents(m.inventoryAtCostCents)],
    ['  less earmarks', formatCents(-m.earmarkedCents)],
    ['Deployable now', formatCents(m.deployableCapitalCents)],
    ['Unencumbered cash', formatCents(m.unencumberedCashCents)],
    ['Liquid floor', formatCents(m.minLiquidFloorCents)],
    ['Tax reserve', formatCents(m.taxReserveCents)],
    ['Operating reserve', formatCents(m.operatingReserveCents)],
    ['Owner payable', formatCents(m.ownerPayableCents)],
    [
      'Set-aside',
      m.navCents < state.policy.allocation.setAsideMinNavCents
        ? `OFF until ${formatCents(state.policy.allocation.setAsideMinNavCents)} - profit compounds`
        : 'ON - owner and reserves take their share',
    ],
    ['Mode', m.mode],
    ['  max per item', formatCents(m.maxCapitalPerItemCents)],
    ['  max hold', `${m.modePolicy.maxHoldDays} days`],
    ['  min profit', formatCents(m.modePolicy.minExpectedProfitCents)],
    ['Active items', String(m.activeItemCount)],
    ['Events recorded', String(state.eventCount)],
  ];
  for (const [label, value] of rows) console.log(`${pad(label)} ${value}`);

  const exposure = Object.entries(m.categoryExposureCents).sort(([a], [b]) => a.localeCompare(b));
  if (exposure.length > 0) {
    console.log('\nCategory exposure (cap ' + formatCents(m.maxCategoryExposureCents) + '):');
    for (const [category, cents] of exposure) {
      console.log(`  ${pad(category, 20)} ${formatCents(cents)}`);
    }
  }

  // Whether the ledger is backed up is a fact about safety, so it belongs on
  // the main screen rather than behind a subcommand nobody runs.
  //
  // ⚠️ Only on a standalone `status`. Inside a command that just moved money the
  // automatic backup has not run yet, so this line would report the state from
  // before it — technically true and actively misleading.
  if (!showBackup) return;
  const backupSettings = store.backupSettings();
  const backupState = store.backupState();
  if (backupSettings.directory === '') {
    console.log(`${pad('Backup')} NOT CONFIGURED - run: backup config --to=<dir>`);
  } else {
    const { behind, stale } = backupStaleness(backupState, state.eventCount);
    console.log(
      `${pad('Backup')} ` +
        (backupState.lastSuccessAt === null
          ? 'never run'
          : stale
            ? `${behind} event(s) behind (last ${backupState.lastSuccessAt.slice(0, 10)})`
            : `current (${backupState.lastSuccessAt.slice(0, 10)})`),
    );
    if (backupState.lastError) {
      console.log(`${pad('  last error')} ${backupState.lastError}`);
    }
  }

  // A profit floor and a per-item cap multiply into a constraint neither one
  // states. When they are incompatible, say so here rather than letting the
  // operator discover it as a wall of rejections.
  const reach = assessProfitFloor(m.navCents, m.modePolicy, feeModel(undefined));
  if (!reach.reachable) {
    console.log(
      `
!  The ${formatCents(reach.minProfitCents)} profit floor is NOT reachable at this bankroll.`,
    );
    console.log(
      `   A ${formatCents(reach.maxPerItemCents)} item must sell for ` +
        `${formatCents(reach.grossNeededCents)} gross to clear it - ` +
        `${(reach.requiredMultipleBps / 10_000).toFixed(1)}x on every flip.`,
    );
    console.log(
      `   At a 3x flip that floor implies a bankroll of about ` +
        `${formatCents(reach.impliedBankrollCents)} ` +
        `(${formatCents(reach.impliedMaxPerItemCents)} per item).`,
    );
    console.log('   Either fund it to there, or lower minExpectedProfitCents.');
  }
}

function printEvaluation(id: string, e: Evaluation): void {
  const ec = e.economics;
  console.log(
    `${formatCents(ec.landedCostCents)} landed  ->  ` +
      `${formatCents(ec.netProceedsCents)} net  ->  ` +
      `${formatCents(ec.expectedProfitCents)} profit (${(ec.expectedRoiBps / 100).toFixed(0)}% ROI)`,
  );
  console.log(
    `${ec.velocity.soldLast90Days} sold / ${ec.velocity.activeListings} active  ->  ` +
      `~${ec.velocity.expectedDaysToSale}d (p90 ${ec.velocity.expectedDaysP90}d)` +
      `${ec.velocity.source === 'OPERATOR_ESTIMATE' ? '  [your estimate, not comps]' : ''}`,
  );
  console.log('');
  console.log(
    `${pad('buy score', 14)}${e.buy.score}` +
      (e.buy.boundBy === 'NONE' ? '' : `  (capped by ${e.buy.boundBy.toLowerCase()})`),
  );
  console.log(`${pad('risk score', 14)}${e.risk.score}`);
  console.log(`${pad('confidence', 14)}${Math.round(e.confidence.confidenceBps / 100)}%`);
  console.log(
    `${pad('max to pay', 14)}${formatCents(e.price.maxPriceCents)}` +
      `  (limited by ${e.price.boundBy.toLowerCase().replace('_', ' ')})`,
  );
  console.log('');
  console.log(`${e.result.recommendation}  ${id}`);
  for (const reason of e.result.reasons) console.log(`  ${reason}`);
}

/** Commands that move money. Only these trigger an automatic backup. */
const MUTATING = new Set([
  'contribute', 'buy', 'sell', 'expense', 'payout', 'tax', 'chargeoff', 'recover',
  'adjust',
]);

/**
 * Copy the ledger after a command that changed it.
 *
 * ⚠️ **Never throws.** The command already succeeded and the money already
 * moved; refusing to acknowledge that because a sync folder was offline would
 * be worse than a missing backup. It warns loudly and records the failure, so
 * `status` can report staleness rather than a failure passing silently.
 */
function autoBackup(store: FundStore, dbPath: string, now: string): void {
  if (dbPath === ':memory:') return;
  const settings = store.backupSettings();
  if (!settings.auto || settings.directory === '') return;

  try {
    const result = backupWithRetention(dbPath, settings, now);
    store.setBackupState({
      lastSuccessAt: now,
      lastSuccessEvents: result.latest.events,
      lastPath: result.latest.path,
      lastError: null,
      lastErrorAt: null,
    });
    console.log(
      `backed up (${result.latest.events} events)` +
        (result.daily ? ' + today’s dated copy' : ''),
    );
  } catch (err) {
    const message = (err as Error).message;
    console.error('');
    console.error(`!  BACKUP FAILED: ${message}`);
    console.error('   The command succeeded; the copy did not. Run: backup');
    store.setBackupState({ ...store.backupState(), lastError: message, lastErrorAt: now });
  }
}

function main(): void {
  const [, , command = 'help', ...rest] = process.argv;
  const args = parseArgs(rest);
  const dbPath = args.flags.db ?? DEFAULT_DB_PATH;
  const now = args.flags.at ?? systemClock();

  if (command === 'help' || command === '--help') {
    console.log(`resale-os

  init                                        create the database and seed policy
  status                                      balances, mode, exposure
  contribute --amount=75                      fund the bankroll
  buy --from-opp=X [--id=] [--price=]         buy a scored opportunity; carries
                                              its prediction onto the item
  buy --id=X --name="..." --category=C --price=12.34
      --resale=32          the GROSS price you expect to sell at, before fees
      --sold=45 --active=5 comp counts; the hold time is DERIVED from these
      [--days=7]           a hand estimate instead - carries low confidence
      [--shipping=] [--tax=] [--travel=] [--marketplace=EBAY] [--est-postage=]
      [--force --reason="why you overruled the gates"]
  sell --id=X --gross=30 [--fee=] [--payment=] [--postage=] [--packaging=] [--days=5]
  expense --amount=8.99 --category=PACKAGING [--from-reserve] [--id=X]
  expense correct --event=evt_X --amount=1.50 --reason="..." --to=POSTAGE
  expense correct --event=evt_X --amount=1.50 --reason="..." --settled-by=evt_Y
  payout --amount=1.50                        pay the owner
  tax [show]                                  what the year owes, and what is reserved
  tax pay --amount=2.61                       pay tax from the reserve
  tax profile [show]                          your filing situation
  tax profile set --filing=SINGLE --other-income=60000 --w2-wages=60000
                  [--state-rate-bps=500 --state-basis="where it came from"]
                  [--itemized=] [--no-qbi]
  tax tables [show]                           which tax figures are in use
  tax tables accept [--by=] [--note=]         use them as-is (NOT verification)
  chargeoff --id=X --reason=STALE [--keep-listing]
  recover --id=X --gross=15 [--fee=] [--postage=]
  headroom --category=C                       max landed cost that clears every capital gate
  policy [show]                               the rules this fund is running
  policy adopt-defaults                       re-seed policy from the code defaults
  policy set --min-profit=100                 change one number in place
  accuracy [--items]                          how good the estimates were
  profit [--expenses]                         item vs operating vs distributable
  backup                                      copy the ledger, and verify the copy
  backup config --to=dir [--auto=off] [--retain-days=90]
  backup status                               is it current, and where
  export [--to=resale-export.json]      # the fund, as commands
  import --from=resale-export.json      # replays and verifies every hash
  adjust --account=LIQUID --amount=-1.00 --reason="..." [--reverses=evt_X]
                                              correct a mistake; append-only, so
                                              both the error and the fix remain
  ledger [--limit=20]                         recent events
  verify                                      hash chain + independent replay
  items [--state=ACTIVE]

  opp add --id=X --name="..." --category=C --price=12.34 --resale=39
          --sold=45 --active=5 [--comps=38,39,40] [--comp-age=20]
          [--days=7] [--hassle-bps=2000] [--marketplace=EBAY]
  opp list [--rec=BUY] [--min-score=] [--max-risk=] [--category=] [--limit=]
  opp show --id=X                             the full reasoning
  opp pass --id=X
  opp rejections                              which gate is actually binding

Global: --db=path  --at=ISO-timestamp`);
    return;
  }

  const store = openFundStore(dbPath, systemClock);

  try {
    switch (command) {
      case 'init': {
        store.setPolicy(store.policy() ?? DEFAULT_POLICY);
        console.log(`initialised ${dbPath}`);
        printStatus(store);
        break;
      }

      case 'status':
        printStatus(store, true);
        break;

      case 'contribute': {
        const amountCents = money(args, 'amount');
        store.commit({ type: 'CONTRIBUTION', amountCents, occurredAt: now });
        console.log(`contributed ${formatCents(amountCents)}`);
        printStatus(store);
        break;
      }

      case 'buy': {
        // Buying from a scored opportunity carries its prediction onto the
        // item, which is the only way prediction accuracy becomes measurable.
        if (args.flags['from-opp']) {
          const oppId = args.flags['from-opp'];
          const row = store.opportunities().get(oppId);
          if (!row) {
            console.error(`no opportunity "${oppId}" — score it first with: opp add`);
            process.exitCode = 1;
            break;
          }
          const input = parseOpportunity(JSON.parse(row.input_json));
          // Re-evaluate against the fund AS IT IS NOW. A verdict from last week
          // was about a different bankroll.
          const evaluation = evaluateOpportunity(input, store.state());
          if (!evaluation.gates.passed && !args.flags.force) {
            console.log('This purchase no longer clears the capital rules:');
            for (const f of evaluation.gates.failures) console.log(`  ✗ ${f.code}: ${f.message}`);
            console.log('');
            console.log('Record it anyway with --force.');
            process.exitCode = 1;
            break;
          }

          const itemId = args.flags.id ?? oppId;
          const paid = args.flags.price ? money(args, 'price') : input.askingPriceCents;
          store.commit({
            type: 'PURCHASE',
            itemId,
            name: input.name,
            category: input.category,
            purchasePriceCents: paid,
            inboundShippingCents: input.inboundShippingCents,
            salesTaxCents: input.salesTaxCents,
            acquisitionTravelCents: input.acquisitionTravelCents,
            expectedDaysToSale: evaluation.economics.velocity.expectedDaysToSale,
            expectedResaleCents: input.expectedGrossCents,
            expectedNetProceedsCents: evaluation.economics.netProceedsCents,
            // Recomputed against what was actually paid, which may be less than
            // the asking price if you negotiated.
            expectedProfitCents:
              evaluation.economics.netProceedsCents -
              (paid + evaluation.economics.otherLandedCents),
            opportunityId: oppId,
            marketplace: input.marketplace,
            occurredAt: now,
          });
          store.opportunities().markPurchased(oppId, itemId, now);
          console.log(
            `bought ${itemId} from ${oppId} at ${formatCents(paid)}` +
              (paid < input.askingPriceCents ? ` (asking was ${formatCents(input.askingPriceCents)})` : ''),
          );
          printStatus(store);
          break;
        }

        const purchasePriceCents = money(args, 'price');
        const inboundShippingCents = args.flags.shipping ? money(args, 'shipping') : 0;
        const salesTaxCents = args.flags.tax ? money(args, 'tax') : 0;
        const acquisitionTravelCents = args.flags.travel ? money(args, 'travel') : 0;

        // ⛔ The arithmetic lives in `core/capital/quote.ts`, not here. The
        // phone's buy screen has to reach the same verdict from the same
        // numbers, and two implementations of "what will this net" is how a
        // fund starts disagreeing with itself about what it was allowed to buy.
        const { quote, assessment } = assessQuote(store.state(), {
          category: req(args, 'category'),
          purchasePriceCents,
          inboundShippingCents,
          salesTaxCents,
          acquisitionTravelCents,
          ...(args.flags.resale ? { expectedGrossCents: money(args, 'resale') } : {}),
          ...(args.flags.marketplace ? { marketplace: args.flags.marketplace } : {}),
          ...(args.flags['est-postage'] ? { estPostageCents: money(args, 'est-postage') } : {}),
          ...(args.flags.sold !== undefined
            ? { soldLast90Days: int(args, 'sold'), activeListings: int(args, 'active', 0) }
            : { operatorDaysEstimate: int(args, 'days', 7) }),
        });
        const landed = quote.landedCostCents;
        const velocity = quote.velocity;
        const expectedDaysToSale = velocity.expectedDaysToSale;
        const expectedGrossCents = quote.expectedGrossCents;
        const model = quote.feeModel;
        const estimate = quote.estimate;
        const expectedProfit = quote.expectedProfitCents;

        if (velocity.source === 'COMPS') {
          console.log(
            `${velocity.soldLast90Days} sold / ${velocity.activeListings} active  ->  ` +
              `${(velocity.sellThroughBps / 100).toFixed(0)}% sell-through, ` +
              `~${expectedDaysToSale}d to sell (p90 ${velocity.expectedDaysP90}d), ` +
              `confidence ${(velocity.confidenceBps / 100).toFixed(0)}%`,
          );
        } else {
          console.log(
            `!  no comps given: using your ${expectedDaysToSale}d estimate at ` +
              `${(velocity.confidenceBps / 100).toFixed(0)}% confidence. ` +
              `Pass --sold= --active= to derive it instead.`,
          );
        }
        console.log(
          `${formatCents(expectedGrossCents)} gross on ${model.marketplace}` +
            `  -  fees ${formatCents(estimate.marketplaceFeeCents)}` +
            `  -  postage ${formatCents(estimate.postageCents)}` +
            `  -  packaging ${formatCents(estimate.packagingCents)}` +
            `  =  ${formatCents(estimate.netCents)} net`,
        );
        console.log(
          `net ${formatCents(estimate.netCents)} - landed ${formatCents(landed)} = ` +
            `${formatCents(expectedProfit)} expected profit
`,
        );

        let overrodeGates: string[] | undefined;
        let overrideReason: string | undefined;
        if (!assessment.passed) {
          console.log('This purchase fails the capital rules:');
          for (const f of assessment.failures) console.log(`  ✗ ${f.code}: ${f.message}`);
          if (!args.flags.force) {
            console.log('\nRecord it anyway with --force --reason="..." (the override is recorded).');
            process.exitCode = 1;
            break;
          }
          // ⛔ D4, answered 2026-09-09: an override is allowed and must never be
          // silent. Before this, --force committed an ordinary PURCHASE and an
          // overruled buy was indistinguishable from a clean one.
          if (!args.flags.reason) {
            console.log('\n--force needs --reason="..." — an override with no stated reason');
            console.log('    is exactly what the record exists to prevent.');
            process.exitCode = 1;
            break;
          }
          overrodeGates = assessment.failures.map((f) => f.code);
          overrideReason = args.flags.reason;
          console.log(`\n--force given: recorded as overriding ${overrodeGates.join(', ')}.`);
        }

        store.commit({
          type: 'PURCHASE',
          itemId: req(args, 'id'),
          name: args.flags.name ?? req(args, 'id'),
          category: req(args, 'category'),
          purchasePriceCents,
          inboundShippingCents,
          salesTaxCents,
          acquisitionTravelCents,
          expectedDaysToSale,
          expectedResaleCents: expectedGrossCents,
          listingLive: args.flags['listing-live'] === 'true',
          ...(overrodeGates ? { overrodeGates, overrideReason } : {}),
          ...(args.flags.marketplace ? { marketplace: args.flags.marketplace } : {}),
          occurredAt: now,
        });
        console.log(`bought ${req(args, 'id')} at a landed cost of ${formatCents(landed)}`);
        printStatus(store);
        break;
      }

      case 'sell': {
        const result = store.commit({
          type: 'SALE',
          itemId: req(args, 'id'),
          grossProceedsCents: money(args, 'gross'),
          marketplaceFeeCents: args.flags.fee ? money(args, 'fee') : 0,
          paymentFeeCents: args.flags.payment ? money(args, 'payment') : 0,
          outboundShippingCents: args.flags.postage ? money(args, 'postage') : 0,
          packagingCents: args.flags.packaging ? money(args, 'packaging') : 0,
          ...(args.flags.days ? { daysToSale: int(args, 'days') } : {}),
          occurredAt: now,
        });
        const a = result.allocation!;
        console.log(`profit ${formatCents(a.profitCents)}`);
        if (a.setAsideSuppressed) {
          console.log(
            `  bankroll ${formatCents(a.navAtAllocationCents)} is below the ` +
              `${formatCents(store.policy().allocation.setAsideMinNavCents)} set-aside ` +
              `threshold - nothing is taken out, it all compounds`,
          );
        }
        console.log(`  tax reserve      ${formatCents(a.taxCents)}`);
        console.log(`    self-employment  ${formatCents(a.tax.selfEmploymentCents)}`);
        if (a.tax.federalIncomeCents > 0) {
          console.log(`    federal income   ${formatCents(a.tax.federalIncomeCents)}`);
        }
        if (a.tax.stateIncomeCents > 0) {
          console.log(`    state income     ${formatCents(a.tax.stateIncomeCents)}`);
        }
        if (a.tax.carriedForwardCents > 0) {
          console.log(
            `    !  ${formatCents(a.tax.carriedForwardCents)} of tax is owed but could not be ` +
              `reserved from this sale - later sales will pick it up`,
          );
        }
        if (a.tax.belowSelfEmploymentThreshold) {
          console.log(
            `    (the year is still under $400 of net self-employment earnings,` +
              ` so no SE tax is owed yet)`,
          );
        }
        if (!a.tax.incomeTaxEstimated) {
          console.log(
            `    !  income tax is NOT being reserved - no tax profile is set.` +
              `  Run: tax profile set`,
          );
        }
        console.log(`  owner            ${formatCents(a.ownerCents)}`);
        console.log(`  operating        ${formatCents(a.operatingReserveCents)}`);
        console.log(`  reinvested       ${formatCents(a.reinvestedCents)}`);
        printStatus(store);
        break;
      }

      case 'expense': {
        // `expense correct` fixes the BOOKS without moving money — a
        // miscategorised expense, or one whose cash came back through an event
        // that never declared what it was reversing. Anything that moves cash
        // is an `adjust`, not a correction.
        if (args._[0] === 'correct') {
          const correctsEventId = req(args, 'event');
          const amountCents = money(args, 'amount');
          const reclassifyTo = args.flags.to as ExpenseCategory | undefined;
          const settledByEventId = args.flags['settled-by'];
          store.commit({
            type: 'EXPENSE_CORRECTION',
            correctsEventId,
            amountCents,
            reason: req(args, 'reason'),
            ...(reclassifyTo !== undefined ? { reclassifyTo } : {}),
            ...(settledByEventId !== undefined ? { settledByEventId } : {}),
            occurredAt: now,
          });
          console.log(
            reclassifyTo !== undefined
              ? `reclassified ${formatCents(amountCents)} of ${correctsEventId} to ${reclassifyTo}`
              : `settled ${formatCents(amountCents)} of ${correctsEventId} against ` +
                `${settledByEventId}`,
          );
          printStatus(store);
          break;
        }
        store.commit({
          type: 'BUSINESS_EXPENSE',
          amountCents: money(args, 'amount'),
          category: req(args, 'category') as ExpenseCategory,
          fundedFromOperatingReserve: args.flags['from-reserve'] === 'true',
          ...(args.flags.id ? { itemId: args.flags.id } : {}),
          occurredAt: now,
        });
        printStatus(store);
        break;
      }

      case 'payout': {
        store.commit({ type: 'OWNER_PAYOUT', amountCents: money(args, 'amount'), occurredAt: now });
        printStatus(store);
        break;
      }

      case 'tax': {
        const sub = args._[0] ?? 'show';

        if (sub === 'pay') {
          store.commit({
            type: 'TAX_PAYMENT',
            amountCents: money(args, 'amount'),
            occurredAt: now,
          });
          printStatus(store);
          break;
        }

        if (sub === 'profile') {
          const action = args._[1] ?? 'show';
          const loaded = store.taxProfileOrDefault();
          const profile = loaded.profile;
          if (loaded.stale) {
            console.log(`!  the stored tax profile could not be read: ${loaded.reason}`);
            console.log('   falling back to the unconfigured default; re-set it below');
            console.log('');
          }

          if (action === 'set') {
            const next = {
              configured: true,
              filingStatus: (args.flags.filing ?? profile.filingStatus) as FilingStatus,
              expectedOtherIncomeCents: args.flags['other-income']
                ? money(args, 'other-income')
                : profile.expectedOtherIncomeCents,
              expectedW2WagesCents: args.flags['w2-wages']
                ? money(args, 'w2-wages')
                : profile.expectedW2WagesCents,
              stateIncomeTaxBps: args.flags['state-rate-bps']
                ? int(args, 'state-rate-bps')
                : profile.stateIncomeTaxBps,
              // Naming a jurisdiction switches the state calculation to that
              // state's real brackets. The flat rate above stays as the
              // fallback for anything not modelled.
              stateJurisdiction: args.flags['state-county']
                ? { state: req(args, 'state'), locality: req(args, 'state-county') }
                : (profile.stateJurisdiction ?? null),
              stateRateBasis: args.flags['state-basis'] ?? profile.stateRateBasis,
              itemizedDeductionCents: args.flags.itemized
                ? money(args, 'itemized')
                : profile.itemizedDeductionCents,
              claimQbiDeduction: args.flags['no-qbi'] ? false : profile.claimQbiDeduction,
              stateAllowsQbiDeduction: args.flags['state-allows-qbi']
                ? true
                : profile.stateAllowsQbiDeduction,
            };
            store.setTaxProfile(next); // validates; a bad edit throws
            console.log('tax profile updated');
          }

          const current = store.taxProfileOrDefault().profile;
          console.log(`configured       ${current.configured ? 'yes' : 'NO - income tax is not being reserved'}`);
          console.log(`filing status    ${current.filingStatus}`);
          console.log(`other income     ${formatCents(current.expectedOtherIncomeCents)}`);
          console.log(`W-2 wages        ${formatCents(current.expectedW2WagesCents)}`);
          console.log(`state rate       ${(current.stateIncomeTaxBps / 100).toFixed(2)}%`);
          console.log(`  basis          ${current.stateRateBasis ?? '(none recorded)'}`);
          // Which of the two paths is actually in force. Without this the flat
          // rate above reads as the answer when it is only the fallback.
          console.log(
            `  method         ${
              current.stateJurisdiction
                ? `${current.stateJurisdiction.state} brackets + ${current.stateJurisdiction.locality}`
                : 'flat marginal rate'
            }`,
          );
          console.log(
            `deduction        ${
              current.itemizedDeductionCents === null
                ? 'standard'
                : formatCents(current.itemizedDeductionCents)
            }`,
          );
          console.log(`QBI deduction    ${current.claimQbiDeduction ? 'yes' : 'no'}`);
          console.log(
            `  state allows it  ${current.stateAllowsQbiDeduction ? 'yes' : 'no - added back to the state base'}`,
          );
          if (!current.configured) {
            console.log('');
            console.log(
              'Set it with:  tax profile set --filing=SINGLE --other-income=60000 ' +
                '--w2-wages=60000 --state-rate-bps=0',
            );
          }
          break;
        }

        if (sub === 'tables') {
          const action = args._[1] ?? 'show';
          const tables = DEFAULT_TAX_TABLES;
          const state = store.state();
          const year = state.taxYear || Number(now.slice(0, 4));

          if (action === 'accept') {
            store.acceptTaxTables({
              tablesYear: tables.year,
              forTransactionYear: year,
              acceptedBy: args.flags.by ?? 'owner',
              acceptedAt: now,
              ...(args.flags.note ? { note: args.flags.note } : { note: null }),
            });
            console.log(
              `accepted the ${tables.year} tables as adequate for ${year}. ` +
                `This is NOT verification - they are still marked verified: false.`,
            );
          }

          console.log(`tables year      ${tables.year}`);
          console.log(`source           ${tables.source}`);
          console.log(`IRS-verified     ${tables.verified ? 'yes' : 'no'}`);
          const acc = store.taxTablesAcceptance();
          console.log(
            `owner-accepted   ${
              acc
                ? `${acc.tablesYear} tables for ${acc.forTransactionYear}, by ${acc.acceptedBy} on ${acc.acceptedAt.slice(0, 10)}`
                : 'no'
            }`,
          );
          for (const w of taxTableWarnings(tables, year, acc)) {
            console.log('');
            console.log(`${w.severity === 'info' ? ' ' : '!'}  ${w.message}`);
          }
          break;
        }

        if (sub === 'show') {
          const state = store.state();
          const tables = state.taxTables;
          const year = state.taxYear || Number(now.slice(0, 4));
          // The tax the BUSINESS caused, not the owner's whole liability.
          // annualTax(ytd) alone includes tax on their salary, which the fund
          // neither owes nor reserves for — reporting that as a shortfall was a
          // bug, and an alarming one.
          const business = incrementalReserve(
            0,
            state.ytdNetBusinessIncomeCents,
            state.taxProfile,
            tables,
          );

          console.log(`tax year ${year}`);
          console.log(`  business income YTD   ${formatCents(state.ytdNetBusinessIncomeCents)}`);
          console.log(`  reserved so far       ${formatCents(state.ytdTaxReservedCents)}`);
          console.log(`  reserve on hand       ${formatCents(computeMetrics(state).taxReserveCents)}`);
          console.log('');
          console.log('tax attributable to the business this year');
          console.log(`  self-employment       ${formatCents(business.selfEmploymentCents)}`);
          if (business.after.selfEmployment.belowThreshold) {
            console.log('    (under $400 of net SE earnings - none owed yet)');
          }
          console.log(`  federal income        ${formatCents(business.federalIncomeCents)}`);
          console.log(`  state income          ${formatCents(business.stateIncomeCents)}`);
          console.log(`  ------------------------------`);
          console.log(`  total                 ${formatCents(business.totalCents)}`);
          if (state.ytdNetBusinessIncomeCents > 0) {
            console.log(
              `  effective rate        ${(business.effectiveRateBps / 100).toFixed(2)}%`,
            );
          }
          if (!business.incomeTaxEstimated) {
            console.log('');
            console.log('!  Income tax is NOT included: no tax profile is set.');
            console.log('   Run:  tax profile set --filing=... --other-income=... --w2-wages=...');
          }
          const shortfall = business.totalCents - state.ytdTaxReservedCents;
          if (shortfall > 0) {
            console.log('');
            console.log(`!  The reserve is ${formatCents(shortfall)} short of the estimate.`);
            console.log(
              '   This happens when the profile changes mid-year, or after crossing the ' +
                '$400 threshold.',
            );
          }
          for (const w of taxTableWarnings(tables, year, store.taxTablesAcceptance())) {
            console.log('');
            console.log(`${w.severity === 'info' ? ' ' : '!'}  ${w.message}`);
          }
          break;
        }

        console.error(`unknown: tax ${sub}`);
        process.exitCode = 1;
        break;
      }

      case 'chargeoff': {
        store.commit({
          type: 'CHARGE_OFF',
          itemId: req(args, 'id'),
          reason: req(args, 'reason') as ChargeOffReason,
          keepListingLive: args.flags['keep-listing'] === 'true',
          occurredAt: now,
        });
        console.log('charged off. Capital did NOT return to the fund.');
        printStatus(store);
        break;
      }

      case 'recover': {
        const result = store.commit({
          type: 'PASSIVE_RECOVERY',
          itemId: req(args, 'id'),
          grossProceedsCents: money(args, 'gross'),
          marketplaceFeeCents: args.flags.fee ? money(args, 'fee') : 0,
          outboundShippingCents: args.flags.postage ? money(args, 'postage') : 0,
          occurredAt: now,
        });
        console.log(`recovered ${formatCents(result.allocation!.profitCents)}`);
        printStatus(store);
        break;
      }

      case 'headroom': {
        const category = req(args, 'category');
        const max = maxAffordableLandedCost(store.state(), category);
        const model = feeModel(args.flags.marketplace);
        const m = computeMetrics(store.state());
        const minProfit = m.modePolicy.minExpectedProfitCents;
        const active = int(args, 'active', 5);
        console.log(
          `To sell inside ${m.modePolicy.idealHoldDays} days against ${active} active ` +
            `listings, you need at least ` +
            `${soldNeededForHold(m.modePolicy.idealHoldDays, active)} sold in 90 days ` +
            `(${soldNeededForHold(m.modePolicy.maxHoldDays, active)} to clear the ` +
            `${m.modePolicy.maxHoldDays}-day ceiling).`,
        );
        console.log(
          `${category}: up to ${formatCents(max)} landed cost clears every capital gate.`,
        );
        console.log(
          `To clear the ${formatCents(minProfit)} minimum profit on a ` +
            `${formatCents(max)} item, it has to sell for at least ` +
            `${formatCents(grossNeededForNet(max + minProfit, model))} gross on ` +
            `${model.marketplace}.`,
        );
        break;
      }

      case 'policy': {
        const sub = args._[0] ?? 'show';

        // adopt-defaults is the recovery path, so it must NOT read the stored
        // policy first — a stored policy too broken to validate is exactly the
        // case it exists to fix.
        if (sub === 'adopt-defaults') {
          store.setPolicy(DEFAULT_POLICY);
          console.log(`adopted policy ${DEFAULT_POLICY.version}`);
          printStatus(store);
          break;
        }

        let current: Policy;
        try {
          current = store.policy();
        } catch (err) {
          console.error(`the stored policy is invalid: ${(err as Error).message}`);
          console.error('Run:  policy adopt-defaults');
          process.exitCode = 1;
          break;
        }

        if (sub === 'show') {
          const m = computeMetrics(store.state());
          console.log(`policy version   ${current.version}`);
          if (current.version !== DEFAULT_POLICY.version) {
            console.log(
              `  ! the code ships ${DEFAULT_POLICY.version}. This fund is running an OLDER
` +
                `    policy, because policy is stored in the database, not read from code.
` +
                `    Run: policy adopt-defaults`,
            );
          }
          console.log(`
tax reserve`);
          console.log(`  self-employment  ${current.allocation.tax.selfEmploymentRateBps / 100}%` +
            ` of ${current.allocation.tax.selfEmploymentBaseBps / 100}% of profit`);
          console.log(`  income tax       ${current.allocation.tax.incomeTaxBps / 100}%`);
          console.log(
            `
after-tax split  (suppressed below ` +
              `${formatCents(current.allocation.setAsideMinNavCents)} of NAV)`,
          );
          console.log(`  owner            ${current.allocation.ownerBps / 100}%`);
          console.log(`  operating        ${current.allocation.operatingReserveBps / 100}%`);
          console.log(`  reinvest         ${current.allocation.reinvestBps / 100}%`);
          console.log(`
${m.mode}`);
          console.log(`  min profit       ${formatCents(m.modePolicy.minExpectedProfitCents)}`);
          console.log(`  min ROI          ${m.modePolicy.minExpectedRoiBps / 100}%`);
          console.log(`  max per item     ${m.modePolicy.maxCapitalPerItemBps / 100}% of NAV`);
          console.log(`  max hold         ${m.modePolicy.maxHoldDays} days`);
          break;
        }

        if (sub === 'set') {
          // Only the knobs worth changing from a shell. Everything else is a
          // considered change and belongs in the code defaults plus a commit.
          let next = current;
          const changes: string[] = [];

          if (args.flags['min-profit']) {
            const cents = money(args, 'min-profit');
            const modes = { ...next.modes };
            for (const mode of ['BOOTSTRAP', 'GROWTH'] as const) {
              modes[mode] = { ...modes[mode], minExpectedProfitCents: cents };
            }
            next = { ...next, modes };
            changes.push(`min profit -> ${formatCents(cents)} in both modes`);
          }

          if (args.flags['income-tax-bps']) {
            const bps = int(args, 'income-tax-bps');
            next = {
              ...next,
              allocation: {
                ...next.allocation,
                tax: { ...next.allocation.tax, incomeTaxBps: bps },
              },
            };
            changes.push(`income tax -> ${bps / 100}%`);
          }

          if (changes.length === 0) {
            console.log('nothing to set. Try --min-profit=100 or --income-tax-bps=1200');
            process.exitCode = 1;
            break;
          }

          store.setPolicy(next); // validatePolicy runs here; a bad edit throws
          for (const line of changes) console.log(line);
          printStatus(store);
          break;
        }

        console.error(`unknown: policy ${sub}`);
        process.exitCode = 1;
        break;
      }

      case 'opp': {
        const sub = args._[0] ?? 'list';
        const repo = store.opportunities();

        if (sub === 'add' || sub === 'score') {
          const input = parseOpportunity({
            opportunityId: req(args, 'id'),
            name: args.flags.name ?? req(args, 'id'),
            category: req(args, 'category'),
            source: args.flags.source ?? 'MANUAL',
            sourceUrl: args.flags.url ?? null,
            askingPriceCents: money(args, 'price'),
            inboundShippingCents: args.flags.shipping ? money(args, 'shipping') : 0,
            salesTaxCents: args.flags.tax ? money(args, 'tax') : 0,
            acquisitionTravelCents: args.flags.travel ? money(args, 'travel') : 0,
            expectedGrossCents: money(args, 'resale'),
            marketplace: args.flags.marketplace ?? 'EBAY',
            postageCents: args.flags['est-postage'] ? money(args, 'est-postage') : null,
            soldLast90Days: args.flags.sold !== undefined ? int(args, 'sold') : null,
            activeListings: int(args, 'active', 0),
            operatorDaysEstimate: args.flags.days ? int(args, 'days') : null,
            compPricesCents: args.flags.comps
              ? args.flags.comps.split(',').map((c) => parseDollars(c))
              : [],
            compMedianAgeDays: int(args, 'comp-age', 45),
            hassleBps: int(args, 'hassle-bps', 2_000),
          });

          const evaluation = evaluateOpportunity(input, store.state());
          repo.save(input, evaluation, now);
          printEvaluation(input.opportunityId, evaluation);
          break;
        }

        if (sub === 'list') {
          const rows = repo.list({
            ...(args.flags.status ? { status: args.flags.status as OpportunityStatus } : {}),
            ...(args.flags.rec ? { recommendation: args.flags.rec } : {}),
            ...(args.flags['min-score'] ? { minBuyScore: int(args, 'min-score') } : {}),
            ...(args.flags['max-risk'] ? { maxRiskScore: int(args, 'max-risk') } : {}),
            ...(args.flags.category ? { category: args.flags.category } : {}),
            limit: int(args, 'limit', 25),
          });
          if (rows.length === 0) {
            console.log('nothing matches. `opp add` something first.');
            break;
          }
          console.log(
            `${pad('id', 14)}${pad('buy', 5)}${pad('risk', 6)}${pad('conf', 6)}` +
              `${pad('days', 6)}${pad('profit', 10)}${pad('max pay', 10)}rec`,
          );
          for (const r of rows) {
            console.log(
              pad(r.opportunity_id, 14) +
                pad(String(r.buy_score ?? '-'), 5) +
                pad(String(r.risk_score ?? '-'), 6) +
                pad(`${Math.round((r.confidence_bps ?? 0) / 100)}%`, 6) +
                pad(String(r.expected_days_to_sale), 6) +
                pad(formatCents(r.expected_profit_cents), 10) +
                pad(formatCents(r.max_recommended_cents ?? 0), 10) +
                (r.recommendation ?? '-'),
            );
          }
          break;
        }

        if (sub === 'show') {
          const row = repo.get(req(args, 'id'));
          if (!row) {
            console.error(`no opportunity "${req(args, 'id')}"`);
            process.exitCode = 1;
            break;
          }
          console.log(`${row.opportunity_id}  ${row.name}  [${row.category}]`);
          console.log(`status ${row.status}   scored ${row.scored_at ?? 'never'}`);
          console.log(`policy ${row.policy_version ?? '-'}`);
          console.log('');
          for (const reason of JSON.parse(row.reasoning_json ?? '[]') as string[]) {
            console.log(`  ${reason}`);
          }
          break;
        }

        if (sub === 'pass') {
          repo.setStatus(req(args, 'id'), 'PASSED', now);
          console.log(`${req(args, 'id')} marked PASSED`);
          break;
        }

        if (sub === 'rejections') {
          // Which gate is actually binding. The instrument for risk R2.
          const hist = repo.rejectionHistogram();
          if (hist.length === 0) {
            console.log('nothing rejected yet.');
            break;
          }
          console.log('why opportunities are being rejected:');
          for (const { code, n } of hist) console.log(`  ${pad(code, 34)} ${n}`);
          break;
        }

        console.error(`unknown: opp ${sub}`);
        process.exitCode = 1;
        break;
      }

      case 'accuracy': {
        // How good the estimates were. The instrument for risk R1.
        const report = accuracyReport(store.state());
        console.log(accuracyVerdict(report));
        console.log('');
        if (report.n > 0) {
          console.log(`${pad('scored sales', 24)}${report.n}`);
          console.log(`${pad('median days error', 24)}${report.medianDaysErrorDays >= 0 ? '+' : ''}${report.medianDaysErrorDays}d`);
          console.log(`${pad('sold on time or early', 24)}${Math.round(report.onTimeBps / 100)}%`);
          console.log(`${pad('median proceeds error', 24)}${formatCents(report.medianProceedsErrorCents)}`);
          console.log(`${pad('met expected proceeds', 24)}${Math.round(report.proceedsMetBps / 100)}%`);
          console.log(`${pad('expected profit', 24)}${formatCents(report.totalExpectedProfitCents)}`);
          console.log(`${pad('actual profit', 24)}${formatCents(report.totalActualProfitCents)}`);
          console.log(`${pad('realisation', 24)}${Math.round(report.profitRealisationBps / 100)}%`);
        }
        if (report.unpredictedN > 0) {
          console.log('');
          console.log(
            `${report.unpredictedN} sold item(s) had no scored prediction and are excluded. ` +
              'Buy with --from-opp to include them.',
          );
        }
        if (args.flags.items) {
          console.log('');
          console.log(`${pad('item', 16)}${pad('exp d', 7)}${pad('act d', 7)}${pad('exp net', 10)}act net`);
          for (const i of report.items) {
            console.log(
              pad(i.itemId, 16) +
                pad(String(i.expectedDaysToSale), 7) +
                pad(String(i.actualDaysToSale), 7) +
                pad(i.expectedNetProceedsCents === null ? '-' : formatCents(i.expectedNetProceedsCents), 10) +
                formatCents(i.actualNetProceedsCents),
            );
          }
        }
        break;
      }

      case 'profit': {
        const r = profitReport(store.db);
        console.log(`${pad('item profit', 26)}${formatCents(r.itemProfitCents)}`);
        console.log(`${pad('  less business expenses', 26)}${formatCents(-r.businessExpenseCents)}`);
        console.log(`${pad('operating profit', 26)}${formatCents(r.operatingProfitCents)}`);
        console.log(`${pad('  less tax reserve', 26)}${formatCents(-r.taxReserveCents)}`);
        console.log(`${pad('owner distributable', 26)}${formatCents(r.ownerDistributableCents)}`);
        console.log('');
        console.log(`${pad('owner paid to date', 26)}${formatCents(r.ownerPaidCents)}`);
        console.log(`${pad('owner payable', 26)}${formatCents(r.ownerPayableCents)}`);
        console.log('');
        console.log(`${pad('items sold', 26)}${r.soldItems}`);
        console.log(`${pad('items charged off', 26)}${r.chargedOffItems} (${formatCents(r.chargeOffCents)})`);
        console.log(`${pad('recovered', 26)}${formatCents(r.recoveryCents)}`);
        console.log(`${pad('realised ROI', 26)}${(r.realisedRoiBps / 100).toFixed(0)}%`);
        if (args.flags.expenses) {
          console.log('');
          console.log(`${pad('category', 16)}${pad('scope', 14)}${pad('cap?', 6)}total`);
          for (const line of expenseBreakdown(store.db)) {
            console.log(
              pad(line.category, 16) +
                pad(line.scope, 14) +
                pad(line.capitalized ? 'yes' : 'no', 6) +
                formatCents(line.totalCents),
            );
          }
        }
        break;
      }

      case 'backup': {
        const sub = args._[0] ?? 'run';
        const settings = store.backupSettings();

        if (sub === 'config') {
          const next = {
            directory: args.flags.to ?? settings.directory,
            auto: args.flags.auto ? args.flags.auto !== 'off' : settings.auto,
            retainDays: int(args, 'retain-days', settings.retainDays),
          };
          store.setBackupSettings(next);
          console.log(`directory     ${next.directory || '(not set)'}`);
          console.log(`automatic     ${next.auto ? 'yes - after every command that moves money' : 'no'}`);
          console.log(`retain        ${next.retainDays} days of dated copies`);
          if (next.directory === '') {
            console.log('');
            console.log('Set a directory OFF THIS DISK, or the backup does not survive the');
            console.log('failure it exists for. On this machine:');
            console.log(`  backup config --to="${process.env.OneDrive ?? 'D:/backups'}/resale-os-backups"`);
          }
          break;
        }

        if (sub === 'status') {
          const st = store.backupState();
          const { behind, stale } = backupStaleness(st, store.state().eventCount);
          console.log(`directory     ${settings.directory || '(not set)'}`);
          console.log(`automatic     ${settings.auto ? 'yes' : 'no'}`);
          console.log(`last success  ${st.lastSuccessAt ?? 'never'}`);
          console.log(`events behind ${behind}${stale ? '  <- STALE' : ''}`);
          if (st.lastError) console.log(`last error    ${st.lastError} (${st.lastErrorAt})`);
          for (const b of listBackups(settings.directory || defaultBackupDir(dbPath))) {
            console.log(`  ${pad(b.path, 60)} ${(b.bytes / 1024).toFixed(0)} KB`);
          }
          break;
        }

        const dir = args.flags.to ?? (settings.directory || defaultBackupDir(dbPath));
        const result = backupWithRetention(dbPath, { ...settings, directory: dir }, now);
        store.setBackupState({
          lastSuccessAt: now,
          lastSuccessEvents: result.latest.events,
          lastPath: result.latest.path,
          lastError: null,
          lastErrorAt: null,
        });
        console.log(`latest   ${result.latest.path}`);
        if (result.daily) console.log(`daily    ${result.daily.path}`);
        console.log(
          `  ${result.latest.events} events, ${(result.latest.bytes / 1024).toFixed(0)} KB, ` +
            `hash chain ${result.latest.chainOk ? 'OK' : 'BROKEN'}`,
        );
        if (result.pruned.length > 0) {
          console.log(`  pruned ${result.pruned.length} copy(ies) past ${settings.retainDays} days`);
        }
        break;
      }

      case 'adjust': {
        // The sanctioned correction. The ledger is append-only, so a mistake is
        // fixed by adding a compensating event rather than editing one — which
        // leaves BOTH the error and the correction visible. Without a command
        // for this, the only way to fix a slip is to edit the database by hand,
        // which is exactly what the hash chain exists to detect.
        const account = req(args, 'account') as Account;
        const amountCents = money(args, 'amount');
        const reason = req(args, 'reason');
        // `--reverses` is what keeps `profit` honest. Undoing an expense
        // without it moves the ledger and leaves the expense table saying the
        // money was still spent (B33).
        const reversesEventId = args.flags.reverses;
        store.commit({
          type: 'ADJUSTMENT',
          account,
          amountCents,
          reason,
          occurredAt: now,
          ...(reversesEventId !== undefined ? { reversesEventId } : {}),
        });
        console.log(
          `adjusted ${account} by ${formatCents(amountCents)} — ${reason}` +
            (reversesEventId !== undefined ? ` (reverses expense ${reversesEventId})` : ''),
        );
        printStatus(store);
        break;
      }

      case 'export': {
        // The fund as its commands, which is all a fund is — everything else
        // is derived. Written to a file the phone can import.
        const out = args.flags.to ?? 'resale-export.json';
        const dump = exportLedger(store.db, now);
        writeFileSync(out, JSON.stringify(dump, null, 2), 'utf8');
        console.log(`exported ${dump.events.length} events to ${out}`);
        console.log('  config keys: ' + Object.keys(dump.config).join(', '));
        console.log('');
        console.log('⚠️  The destination REPLAYS these commands and compares every');
        console.log('    regenerated hash. A mismatch refuses the import rather than');
        console.log('    importing something that does not verify.');
        break;
      }

      case 'import': {
        const from = req(args, 'from');
        const dump = JSON.parse(readFileSync(from, 'utf8')) as LedgerExport;
        const report = importLedger(store.db, dump, systemClock);
        console.log(`imported ${report.events} events from ${from}`);
        console.log(`  hashes reproduced: ${report.hashesMatched}`);
        console.log(`  chain verifies:    ${report.chainOk}`);
        console.log(`  reconciles:        ${report.reconciled}`);
        break;
      }

      case 'ledger': {
        const limit = int(args, 'limit', 20);
        for (const e of store.events().slice(-limit)) {
          console.log(`${e.event_id}  ${pad(e.type, 18)} ${e.occurred_at}  ${e.item_id ?? ''}`);
          // A books-only correction has no postings, so without this it prints
          // as a bare line and the reader cannot tell what it did.
          if (e.type === 'EXPENSE_CORRECTION') {
            const c = JSON.parse(e.payload_json) as {
              correctsEventId: string;
              amountCents: number;
              reclassifyTo?: string;
              settledByEventId?: string;
              reason: string;
            };
            console.log(
              `    ${pad('(no postings)', 22)} ${formatCents(c.amountCents)} of ${c.correctsEventId} ` +
                (c.reclassifyTo !== undefined
                  ? `reclassified to ${c.reclassifyTo}`
                  : `settled by ${c.settledByEventId}`) +
                `  (${c.reason})`,
            );
          }
          for (const p of store.postingsFor(e.event_id)) {
            const amount = Number(p.amount_cents);
            console.log(
              `    ${pad(p.account, 22)} ${amount >= 0 ? 'Dr' : 'Cr'} ` +
                `${formatCents(Math.abs(amount))}${p.memo ? `  (${p.memo})` : ''}`,
            );
          }
        }
        break;
      }

      case 'verify': {
        const chain = store.verifyChain();
        const recon = reconcile(store);
        // The analytic expense table is not part of the ledger, so neither the
        // hash chain nor the replay can see it drift. This is its control.
        const drift = expenseReversalDrift(store.db);
        console.log(`hash chain: ${chain.ok ? 'OK' : `BROKEN at ${chain.brokenAt}`}`);
        console.log(`replay:     ${recon.ok ? 'OK' : 'MISMATCH'}`);
        for (const d of recon.differences) console.log(`  ${d}`);
        console.log(`expenses:   ${drift.length === 0 ? 'OK' : 'DRIFT'}`);
        for (const d of drift) {
          console.log(
            `  ${d.eventId}: ledger ${formatCents(d.ledgerCents)} vs ` +
              `table ${formatCents(d.tableCents)}`,
          );
        }
        if (!chain.ok || !recon.ok || drift.length > 0) process.exitCode = 1;
        break;
      }

      case 'items': {
        const filter = args.flags.state;
        for (const item of Object.values(store.state().items)) {
          if (filter && item.state !== filter) continue;
          console.log(
            `${pad(item.itemId, 16)} ${pad(item.state, 18)} ${pad(item.category, 16)} ` +
              `book ${formatCents(item.bookValueCents)}  cost ${formatCents(item.landedCostCents)}` +
              `  p/l ${formatCents(item.realizedProfitCents)}`,
          );
          // D4: an override that is recorded but never shown is a silent
          // override with extra steps.
          if (item.overrodeGates) {
            console.log(
              `${' '.repeat(16)}!  overrode ${item.overrodeGates.join(', ')} — ` +
                `${item.overrideReason ?? 'no reason given'}`,
            );
          }
        }
        break;
      }

      default:
        console.error(`unknown command "${command}" — try: node src/cli/index.ts help`);
        process.exitCode = 1;
    }
    if (MUTATING.has(command) && process.exitCode !== 1) {
      autoBackup(store, dbPath, now);
    }
  } catch (err) {
    if (err instanceof TaxProfileError) {
      console.error(`tax profile error: ${err.message}`);
      console.error('Run:  tax profile set --filing=SINGLE --other-income=... --w2-wages=...');
      process.exitCode = 1;
    } else if (err instanceof PolicyError) {
      // The stored policy is older than the code. Say the fix rather than a stack.
      console.error(`policy error: ${err.message}`);
      console.error('This fund is running a policy the current code rejects.');
      console.error('Run:  policy adopt-defaults');
      process.exitCode = 1;
    } else if (err instanceof LedgerTransferError) {
      // The destination did not reproduce the source. Nothing was imported.
      console.error(`transfer refused: ${err.message}`);
      console.error('Nothing was imported. The destination ledger is unchanged.');
      process.exitCode = 1;
    } else if (err instanceof EngineError) {
      // A refused command is a normal outcome — the operator asked for
      // something the rules do not allow, and the ledger is untouched. It is
      // not a crash, and a stack trace tells them nothing they can act on.
      console.error(`refused: ${err.message}`);
      process.exitCode = 1;
    } else if (err instanceof InvariantViolation) {
      // This one IS alarming: the state that was about to be written did not
      // balance. Nothing was written, but it means a bug, not a bad request.
      console.error(`INVARIANT VIOLATION - nothing was written: ${err.message}`);
      console.error('This is a bug. Run `verify` and do not record anything else until it passes.');
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    store.close();
  }
}

main();
