/**
 * The CLI, spawned for real. (Backlog B36, promoted into 4.2.4.)
 *
 * `src/cli/index.ts` is twelve hundred lines routing every command in the
 * system, and until now nothing exercised a single one of them. That is how the
 * raw-stack-trace bug shipped: a refused command printed an unhandled
 * `EngineError` at the operator, and no test opened the CLI to notice.
 *
 * These spawn the actual process against a throwaway ledger, because the things
 * worth testing here — exit codes, what reaches stderr, whether a refusal reads
 * like a refusal — only exist at the process boundary. They are slower than a
 * unit test and there are deliberately few of them.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every case here spawns node+tsx at least once, at roughly a second a go. */
const CLI_TIMEOUT = 60_000;

let dir: string;
let dbPath: string;

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly all: string;
}

function cli(...args: string[]): Run {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli/index.ts', ...args, `--db=${dbPath}`],
    { encoding: 'utf8', cwd: process.cwd() },
  );
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? -1, stdout, stderr, all: stdout + stderr };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'resale-cli-'));
  dbPath = join(dir, 'cli.db');
  // One ledger, built through the CLI itself, shared by the reads below.
  expect(cli('contribute', '--amount=50.00').status).toBe(0);
  expect(cli('expense', '--amount=1.50', '--category=SUPPLIES').status).toBe(0);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('the CLI reports', () => {
  it('prints the bankroll and the mode', () => {
    const r = cli('status');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bankroll (NAV)');
    expect(r.stdout).toContain('$48.50');
    expect(r.stdout).toContain('BOOTSTRAP');
  }, CLI_TIMEOUT);

  it('verifies the chain, the replay and the expense drift', () => {
    const r = cli('verify');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('hash chain: OK');
    expect(r.stdout).toContain('replay:     OK');
    expect(r.stdout).toContain('expenses:   OK');
  }, CLI_TIMEOUT);

  it('reports the expense it was told about', () => {
    const r = cli('profit', '--expenses');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SUPPLIES');
    expect(r.stdout).toContain('$1.50');
  }, CLI_TIMEOUT);
});

describe('a refused command reads like a refusal', () => {
  it('says what was refused, exits 1, and prints no stack trace', () => {
    // Paying out more than is payable. The ledger is untouched; this is a
    // normal outcome of asking for something the rules do not allow.
    const r = cli('payout', '--amount=999.00');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refused:');
    expect(r.stderr).toContain('PAYOUT_EXCEEDS_PAYABLE');
    // The regression this file exists for.
    expect(r.all).not.toContain('at Object.');
    expect(r.all).not.toMatch(/\n\s+at .*\(.*:\d+:\d+\)/);
  }, CLI_TIMEOUT);

  it('refuses to reverse an event that is not an expense', () => {
    const r = cli(
      'adjust',
      '--account=LIQUID',
      '--amount=1.00',
      '--reason=x',
      '--reverses=evt_000001',
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refused:');
    expect(r.stderr).toContain('only a BUSINESS_EXPENSE can be reversed');
    expect(r.all).not.toMatch(/\n\s+at .*\(.*:\d+:\d+\)/);
  }, CLI_TIMEOUT);

  it('leaves the ledger untouched after a refusal', () => {
    const before = cli('status').stdout;
    cli('payout', '--amount=999.00');
    expect(cli('status').stdout).toBe(before);
    expect(cli('verify').status).toBe(0);
  }, CLI_TIMEOUT);
});

describe('the books-only correction, end to end', () => {
  it('reclassifies a category without moving money', () => {
    const navBefore = cli('status').stdout.match(/Bankroll \(NAV\)\s+(\S+)/)?.[1];
    const r = cli(
      'expense',
      'correct',
      '--event=evt_000002',
      '--amount=1.50',
      '--to=POSTAGE',
      '--reason=this was postage',
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('reclassified');

    const profit = cli('profit', '--expenses').stdout;
    expect(profit).toContain('POSTAGE');
    // The money did not move; only the label did.
    expect(cli('status').stdout.match(/Bankroll \(NAV\)\s+(\S+)/)?.[1]).toBe(navBefore);
    expect(cli('verify').status).toBe(0);
  }, CLI_TIMEOUT);

  it('renders a no-posting event legibly in the ledger', () => {
    // A books-only event has no postings, so without explicit rendering it
    // prints as a bare line and the reader cannot tell what it did.
    const r = cli('ledger');
    expect(r.stdout).toContain('EXPENSE_CORRECTION');
    expect(r.stdout).toContain('(no postings)');
    expect(r.stdout).toContain('reclassified to POSTAGE');
  }, CLI_TIMEOUT);
});

/**
 * D4 at the process boundary: the operator's actual override path.
 *
 * ⛔ This is where the defect lived. `--force` printed "recording it as it
 * happened" and committed an ordinary PURCHASE, so an overruled buy left no
 * trace at all — and it was live on the real fund.
 */
describe('overriding the capital gates', () => {
  /** Far more than the bankroll allows, so the gates are certain to refuse. */
  const bigBuy = ['buy', '--id=ovr-01', '--category=DISNEY_PINS', '--price=40.00', '--days=7'];

  it('refuses the purchase outright without --force', () => {
    const r = cli(...bigBuy);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('This purchase fails the capital rules');
    expect(cli('items').stdout).not.toContain('ovr-01');
  }, CLI_TIMEOUT);

  it('refuses --force on its own, because an unexplained override is the bug', () => {
    const r = cli(...bigBuy, '--force');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('--reason');
    // ⚠️ The half-committed case is the one that would hurt: refusing the
    // override but recording the purchase anyway.
    expect(cli('items').stdout).not.toContain('ovr-01');
  }, CLI_TIMEOUT);

  it('records the override, and says which gates it overruled', () => {
    const r = cli(...bigBuy, '--force', '--reason=seller would not split the lot');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('recorded as overriding');
    const items = cli('items').stdout;
    expect(items).toContain('ovr-01');
    // Recorded is not enough — the operator has to be able to SEE it later.
    expect(items).toContain('overrode MAX_PER_ITEM_EXCEEDED');
    expect(items).toContain('seller would not split the lot');
    expect(cli('verify').status).toBe(0);
  }, CLI_TIMEOUT);
});

/**
 * ⛔ **A tested helper is not a used helper.** `daysBetween` has its own unit
 * tests; this asserts the CLI actually CALLS it.
 *
 * The consequence is not cosmetic: `accuracy` excludes any sold item whose
 * `daysToSale` is undefined, so before this a sale recorded without `--days`
 * was invisible to the instrument that measures whether the estimates are any
 * good.
 */
describe('a sale records how long it was actually held', () => {
  it('appears in the accuracy report without anyone typing --days', () => {
    // ⚠️ This block runs last, so it may fund itself without disturbing the
    // balances the earlier reads assert.
    expect(cli('contribute', '--amount=200.00').status).toBe(0);
    // Comps rather than a guess: an operator estimate carries 30% confidence
    // and the gate wants 45%, which is the rule working, not an obstacle.
    const bought = cli('buy', '--id=held-01', '--category=BOOKS', '--price=2.00',
      '--resale=20.00', '--sold=90', '--active=10');
    expect(bought.all).not.toContain('fails the capital rules');
    expect(bought.status).toBe(0);
    expect(cli('sell', '--id=held-01', '--gross=20.00', '--fee=3.05', '--postage=4.00').status)
      .toBe(0);

    const rows = cli('accuracy', '--items').stdout;
    // Bought and sold in the same second, so the hold is 0 days — which is the
    // honest answer, and is a different fact from "not recorded".
    expect(rows).toContain('held-01');
    // itemId, expected days (from the velocity model), then ACTUAL days.
    expect(rows).toMatch(/held-01\s+\d+\s+0\s/);
  }, CLI_TIMEOUT);
});

describe('a retired ledger refuses to become a second head', () => {
  /**
   * ⛔ The fund reached the phone on 2026-09-10 and two databases have shared
   * one history since. Append-only over a hash chain means a single event on
   * either side diverges them permanently, and `importLedger` refuses a
   * mismatched chain BY DESIGN — so nothing can merge them afterwards.
   *
   * ⚠️ Its own directory and its own ledger. The suite above shares a database
   * across cases, and a marker dropped on it would leak into whatever runs next.
   */
  let retiredDir: string;
  let retiredDb: string;

  function retiredCli(...args: string[]): Run {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli/index.ts', ...args, `--db=${retiredDb}`],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    return { status: result.status ?? -1, stdout, stderr, all: stdout + stderr };
  }

  beforeAll(() => {
    retiredDir = mkdtempSync(join(tmpdir(), 'resale-retired-'));
    retiredDb = join(retiredDir, 'retired.db');
    expect(retiredCli('contribute', '--amount=50.00').status).toBe(0);
    writeFileSync(`${retiredDb}.retired`, 'moved to the phone', 'utf8');
  }, CLI_TIMEOUT);

  afterAll(() => {
    rmSync(retiredDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('refuses a write, and says why rather than just failing', () => {
    const r = retiredCli('contribute', '--amount=10.00');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('RETIRED');
    expect(r.stderr).toContain('fork');
  }, CLI_TIMEOUT);

  it('leaves the ledger untouched when it refuses', () => {
    // ⚠️ The assertion that matters. A guard that printed the refusal AFTER
    // the write would pass the test above and lose the fund.
    const r = retiredCli('status');
    expect(r.stdout).toContain('$50.00');
    expect(r.stdout).not.toContain('$60.00');
  }, CLI_TIMEOUT);

  it('still allows the reads that are the recovery path', () => {
    // ⚠️ Until a backup has left the phone this database is the fund's only
    // other copy. Refusing `verify` and `export` would trade a fork risk for a
    // loss risk.
    expect(retiredCli('status').status).toBe(0);
    expect(retiredCli('verify').status).toBe(0);
    expect(retiredCli('export', `--to=${join(retiredDir, 'out.json')}`).status).toBe(0);
  }, CLI_TIMEOUT);

  it('refuses a command nobody thought of, because the list names what may RUN', () => {
    // ⛔ The direction the omission falls. A banned-command list would admit
    // every command added after it was written; this refuses them.
    const r = retiredCli('policy', 'adopt-defaults');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('RETIRED');
  }, CLI_TIMEOUT);
});
