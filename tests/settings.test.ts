/**
 * The door 5.10 removed and 5.12 put back.
 *
 * ⛔ These assert the two rules this project has already broken elsewhere.
 * **A repair path must not depend on the broken thing** — the screen that fixes
 * a bad tax profile has to open against one. And **policy lives in the
 * database**, so a change has to bump the version, because the version is the
 * only thing that can later detect a stored policy drifting from the code's.
 */

import { describe, expect, it } from 'vitest';
import {
  bpsFromPercent,
  percentFromBps,
  policyEdit,
  policyFieldsFrom,
  policyStatus,
  taxEdit,
  taxFieldsFrom,
} from '@/ui/settings.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { UNCONFIGURED_TAX_PROFILE } from '@/core/tax/profile.js';

const NAV = 5_000;
const fields = () => policyFieldsFrom(DEFAULT_POLICY, 'BOOTSTRAP');

describe('percentages become integer basis points', () => {
  it('parses and round-trips without floats', () => {
    for (const [text, bps] of [['40', 4_000], ['12.5', 1_250], ['7.15', 715], ['0.01', 1], ['100', 10_000]] as const) {
      expect(bpsFromPercent(text)).toBe(bps);
      expect(bpsFromPercent(percentFromBps(bps))).toBe(bps);
    }
  });

  it('refuses what is not a percentage', () => {
    for (const bad of ['', 'x', '-5', '101', '1.234', '4,0']) {
      expect(bpsFromPercent(bad)).toBeUndefined();
    }
  });
});

describe('editing a mode', () => {
  it('reports no change when nothing was typed over', () => {
    const e = policyEdit(DEFAULT_POLICY, 'BOOTSTRAP', fields(), NAV);
    expect(e.problems).toEqual([]);
    expect(e.changed).toBe(false);
    expect(e.next).toBeNull();
  });

  it('bumps the version when something changed, because nothing else can detect drift', () => {
    const e = policyEdit(DEFAULT_POLICY, 'BOOTSTRAP', { ...fields(), maxHoldDays: '30' }, NAV);
    expect(e.problems).toEqual([]);
    expect(e.changed).toBe(true);
    expect(e.next?.version).not.toBe(DEFAULT_POLICY.version);
    expect(e.next?.modes.BOOTSTRAP.maxHoldDays).toBe(30);
    // ⛔ The other mode is untouched. A form over one mode must not quietly
    // rewrite the other one's numbers.
    expect(e.next?.modes.GROWTH).toEqual(DEFAULT_POLICY.modes.GROWTH);
  });

  it('says what is wrong with every bad field at once', () => {
    const e = policyEdit(
      DEFAULT_POLICY,
      'BOOTSTRAP',
      { maxPerItemPercent: 'x', minProfit: 'y', maxHoldDays: 'z' },
      NAV,
    );
    expect(e.problems).toHaveLength(3);
    expect(e.next).toBeNull();
  });

  it('shows the profit floor and the per-item cap MULTIPLYING, before it is saved', () => {
    // ⚠️ The trap that cost a real day: a $100 floor against 40% of a $50 NAV
    // demands 7.2x on every flip, and neither number says so on its own.
    const e = policyEdit(DEFAULT_POLICY, 'BOOTSTRAP', { ...fields(), minProfit: '100.00' }, NAV);
    expect(e.problems).toEqual([]);
    expect(e.reachability.reachable).toBe(false);
    expect(e.reachability.requiredMultipleBps).toBeGreaterThan(50_000);

    // And the shipped setting is reachable, so the assertion above is not
    // trivially true of everything.
    expect(policyEdit(DEFAULT_POLICY, 'BOOTSTRAP', fields(), NAV).reachability.reachable).toBe(true);
  });

  it('runs the engine validator rather than a second opinion', () => {
    // maxCapitalPerItemBps above the deployed ceiling is a combination this
    // form knows nothing about; `validatePolicy` is exhaustive by construction.
    const e = policyEdit(DEFAULT_POLICY, 'BOOTSTRAP', { ...fields(), maxPerItemPercent: '100' }, NAV);
    if (e.problems.length > 0) expect(e.next).toBeNull();
    else expect(e.next?.modes.BOOTSTRAP.maxCapitalPerItemBps).toBe(10_000);
  });
});

describe('the stored policy against the code', () => {
  it('detects divergence by version and nothing else', () => {
    expect(policyStatus(DEFAULT_POLICY).diverged).toBe(false);
    expect(policyStatus({ ...DEFAULT_POLICY, version: 'older' }).diverged).toBe(true);
  });
});

describe('the tax profile', () => {
  it('opens against an UNCONFIGURED profile', () => {
    // ⛔ The repair path must not depend on the broken thing.
    const f = taxFieldsFrom(UNCONFIGURED_TAX_PROFILE);
    expect(f.stateRatePercent).toBe('0');
    expect(taxEdit(f).problems).toEqual([]);
  });

  it('opens against a MALFORMED profile, which is the case that matters', () => {
    // Adding a required field makes every stored row invalid — including for
    // the repair. This has shipped twice on this project.
    const f = taxFieldsFrom({} as never);
    expect(f).toBeDefined();
    expect(() => taxEdit(f)).not.toThrow();
  });

  it('opens against no profile at all', () => {
    expect(() => taxFieldsFrom(null)).not.toThrow();
    expect(() => taxFieldsFrom(undefined)).not.toThrow();
  });

  it('refuses a non-zero state rate with no stated basis', () => {
    // ⚠️ A bare rate is unexplainable six months later and a wrong one is
    // invisible. The engine throws on it; this turns that into a sentence.
    const f = taxFieldsFrom(UNCONFIGURED_TAX_PROFILE);
    const bad = taxEdit({ ...f, stateRatePercent: '7.15', stateRateBasis: '   ' });
    expect(bad.next).toBeNull();
    expect(bad.problems.join(' ')).toMatch(/where it came from/);

    const good = taxEdit({ ...f, stateRatePercent: '7.15', stateRateBasis: 'state 4.75 + local 2.40' });
    expect(good.problems).toEqual([]);
    expect(good.next?.stateIncomeTaxBps).toBe(715);
    expect(good.next?.configured).toBe(true);
  });

  it('allows a zero rate with no basis, because there is nothing to explain', () => {
    const f = taxFieldsFrom(UNCONFIGURED_TAX_PROFILE);
    expect(taxEdit({ ...f, stateRatePercent: '0', stateRateBasis: '' }).next?.stateIncomeTaxBps).toBe(0);
  });
});
