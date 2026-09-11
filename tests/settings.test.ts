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
  allocationEdit,
  allocationFieldsFrom,
  bpsFromPercent,
  bumpEdited,
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

describe('the version bump stays readable', () => {
  it('counts instead of growing forever', () => {
    // ⚠️ The first version appended `+edited` unconditionally, so four edits
    // produced `+edited+edited+edited+edited`. A version string is read by a
    // person deciding whether to adopt defaults; an unreadable one is a warning
    // nobody acts on.
    expect(bumpEdited('1.2.3')).toBe('1.2.3+edited');
    expect(bumpEdited('1.2.3+edited')).toBe('1.2.3+edited2');
    expect(bumpEdited('1.2.3+edited2')).toBe('1.2.3+edited3');
    expect(bumpEdited('1.2.3+edited9')).toBe('1.2.3+edited10');

    let p = DEFAULT_POLICY;
    for (let i = 0; i < 5; i += 1) {
      const e = policyEdit(p, 'BOOTSTRAP', { ...policyFieldsFrom(p, 'BOOTSTRAP'), maxHoldDays: String(20 + i) }, NAV);
      if (e.next) p = e.next;
    }
    expect(p.version).toBe(`${DEFAULT_POLICY.version}+edited5`);
    expect(p.version.match(/edited/g)).toHaveLength(1);
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

describe('6.7 — the allocation block, which is what D2 needs', () => {
  const alloc = () => allocationFieldsFrom(DEFAULT_POLICY);

  it('opens on the stored split, as percentages a person typed', () => {
    expect(alloc()).toEqual({
      ownerPercent: '20',
      operatingReservePercent: '10',
      reinvestPercent: '70',
      setAsideMinNav: '100.00',
    });
  });

  it('saves a changed split and BUMPS the version', () => {
    // ⛔ Policy lives in the database. The version is the only thing that can
    // later detect a stored policy drifting from the code's.
    const e = allocationEdit(DEFAULT_POLICY, { ...alloc(), ownerPercent: '30', reinvestPercent: '60' }, NAV);
    expect(e.problems).toEqual([]);
    expect(e.changed).toBe(true);
    expect(e.next?.allocation.ownerBps).toBe(3_000);
    expect(e.next?.allocation.reinvestBps).toBe(6_000);
    expect(e.next?.version).not.toBe(DEFAULT_POLICY.version);
  });

  it('is a no-op when nothing moved, and does not bump', () => {
    const e = allocationEdit(DEFAULT_POLICY, alloc(), NAV);
    expect(e.changed).toBe(false);
    expect(e.next).toBeNull();
  });

  it('⛔ refuses a split that does not add up, in the operator language', () => {
    const e = allocationEdit(DEFAULT_POLICY, { ...alloc(), ownerPercent: '30' }, NAV);
    expect(e.next).toBeNull();
    // ⚠️ Not "must sum to 10000 bps" — that is not how anybody typed them.
    expect(e.problems[0]).toContain('add up to 100%');
    expect(e.problems[0]).toContain('110%');
  });

  it('⛔ defers to the engine validator for rules the form has never heard of', () => {
    // The threshold must sit below the GROWTH promotion, or the fund could
    // reach GROWTH while still retaining 100% of profit. The form does not
    // know that rule; `validatePolicy` does, and it is exhaustive by
    // construction — so the form must not carry a second copy of the rules.
    const e = allocationEdit(DEFAULT_POLICY, { ...alloc(), setAsideMinNav: '9000.00' }, NAV);
    expect(e.next).toBeNull();
    expect(e.problems.join(' ')).toContain('setAsideMinNavCents');
  });

  it('refuses an owner share of zero — the owner is paid on every profit', () => {
    const e = allocationEdit(
      DEFAULT_POLICY,
      { ...alloc(), ownerPercent: '0', reinvestPercent: '90' },
      NAV,
    );
    expect(e.next).toBeNull();
    expect(e.problems.length).toBeGreaterThan(0);
  });

  it('rejects unparseable input without touching the policy', () => {
    for (const bad of [
      { ownerPercent: 'twenty' },
      { setAsideMinNav: 'a hundred' },
      { reinvestPercent: '' },
    ]) {
      const e = allocationEdit(DEFAULT_POLICY, { ...alloc(), ...bad }, NAV);
      expect(e.next, JSON.stringify(bad)).toBeNull();
      expect(e.problems.length).toBeGreaterThan(0);
    }
  });
});

describe('6.7.2 — the split says what it multiplies into', () => {
  const alloc = () => allocationFieldsFrom(DEFAULT_POLICY);

  it('⚡ reports what stays in the fund and what leaves it', () => {
    // A split is not a preference, it is a growth rate, and neither number
    // states that alone.
    const e = allocationEdit(DEFAULT_POLICY, alloc(), 20_000);
    expect(e.consequence.reinvestBps).toBe(7_000);
    expect(e.consequence.withdrawnBps).toBe(3_000);
  });

  it('⚠️ says the split is DORMANT below the threshold, which is where the fund is', () => {
    // The live fund is $50 against a $100 threshold, so 20/10/70 currently
    // moves no money at all — and an operator editing it deserves to know that
    // before concluding the numbers did nothing.
    const e = allocationEdit(DEFAULT_POLICY, alloc(), 5_000);
    expect(e.consequence.splitIsDormant).toBe(true);
    expect(e.consequence.startsAtCents).toBe(10_000);
  });

  it('and stops being dormant once the fund crosses it', () => {
    // The control: "dormant" must track the NAV, not be constant.
    expect(allocationEdit(DEFAULT_POLICY, alloc(), 10_000).consequence.splitIsDormant).toBe(false);
    expect(allocationEdit(DEFAULT_POLICY, alloc(), 9_999).consequence.splitIsDormant).toBe(true);
  });

  it('reports the consequence of a REFUSED edit against the stored policy', () => {
    // ⚠️ Not against the rejected one. A screen that showed the consequence of
    // a split it refused to save would be describing a fund that does not exist.
    const e = allocationEdit(DEFAULT_POLICY, { ...alloc(), ownerPercent: '30' }, 20_000);
    expect(e.next).toBeNull();
    expect(e.consequence.reinvestBps).toBe(DEFAULT_POLICY.allocation.reinvestBps);
  });
});
