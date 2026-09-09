/**
 * The primary screen's decisions.
 *
 * A React component cannot be asserted here — there is no browser, and the
 * thing that actually matters about this screen (is it legible on a phone at
 * arm's length) is a human judgement anyway. So the decisions were moved out of
 * the component and into `screens.ts`, and this is what holds them:
 *
 *   - the order, because the operator is standing in a shop and the question is
 *     what can be spent, not what is owned;
 *   - which warnings fire, and how loud;
 *   - that an unverifiable ledger outranks everything else on the page.
 *
 * What this deliberately does NOT test is styling. If a row is unreadable, no
 * assertion here would know.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { dashboardView } from '@/server/views.js';
import { primaryScreen, backupFooter } from '@/server/screens.js';
import type { PrimaryScreen } from '@/server/screens.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { WITH_JOB, T0 } from './helpers.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function withFund(
  fn: (store: FundStore, screen: () => PrimaryScreen) => void,
  opts: { bankrollCents?: number; taxProfile?: boolean; minProfitCents?: number } = {},
): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-screen-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    if (opts.minProfitCents !== undefined) {
      // A profit floor high enough that no item the per-item cap allows could
      // ever clear it. That is the constraint two policy numbers multiply into.
      // ⚠️ It nests under `modes`, keyed by mode. A misspelled top-level key
      // here type-checks fine — spread syntax suppresses excess-property
      // checks — and silently changes nothing.
      store.setPolicy({
        ...DEFAULT_POLICY,
        modes: {
          ...DEFAULT_POLICY.modes,
          BOOTSTRAP: {
            ...DEFAULT_POLICY.modes.BOOTSTRAP,
            minExpectedProfitCents: opts.minProfitCents,
          },
        },
      });
    }
    if (opts.taxProfile !== false) store.setTaxProfile(WITH_JOB);
    store.commit({
      type: 'CONTRIBUTION',
      amountCents: opts.bankrollCents ?? 50_000,
      occurredAt: T0,
    });
    try {
      fn(store, () => primaryScreen(dashboardView(store)));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

const ids = (s: PrimaryScreen) => s.sections.map((x) => x.id);
const section = (s: PrimaryScreen, id: string) => {
  const found = s.sections.find((x) => x.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
};
const labels = (s: PrimaryScreen, id: string) => section(s, id).rows.map((r) => r.label);

describe('order is the design', () => {
  it('leads with what can be spent, not with what is owned', () => {
    withFund((_store, screen) => {
      const s = screen();
      // The whole point of the screen. NAV first would be accurate and useless.
      expect(ids(s)[0]).toBe('spendable');
      expect(ids(s).indexOf('spendable')).toBeLessThan(ids(s).indexOf('bankroll'));
      expect(section(s, 'spendable').rows[0]?.label).toBe('Deployable');
      expect(section(s, 'spendable').rows[0]?.lead).toBe(true);
    });
  });

  it('gives each section exactly one lead figure at most', () => {
    withFund((_store, screen) => {
      for (const sec of screen().sections) {
        expect(sec.rows.filter((r) => r.lead).length).toBeLessThanOrEqual(1);
      }
    });
  });

  it('shows the rows the CLI shows and the proof page dropped', () => {
    withFund((_store, screen) => {
      const s = screen();
      expect(labels(s, 'bankroll')).toContain('Liquid floor');
      expect(labels(s, 'earmarks')).toEqual([
        'Tax reserve',
        'Operating reserve',
        'Owner payable',
      ]);
      // Whatever mode the fixture is in, the note names it and the count.
      expect(section(s, 'spendable').note).toMatch(/^(BOOTSTRAP|GROWTH|SCALE) · 0 active items$/);
    });
  });

  it('pluralises the active-item count', () => {
    withFund((store, screen) => {
      store.commit({
        type: 'PURCHASE',
        itemId: 'pin-01',
        name: 'pin',
        category: 'DISNEY_PINS',
        purchasePriceCents: 1_500,
        expectedDaysToSale: 8,
        expectedResaleCents: 3_900,
        occurredAt: T0,
      });
      expect(screen().sections[0]?.note).toContain('1 active item');
      expect(screen().sections[0]?.note).not.toContain('1 active items');
    });
  });
});

describe('category exposure', () => {
  it('is omitted entirely when there is none — an empty table is noise', () => {
    withFund((_store, screen) => {
      expect(ids(screen())).not.toContain('exposure');
    });
  });

  it('appears once capital is deployed, with the cap in the title', () => {
    withFund((store, screen) => {
      store.commit({
        type: 'PURCHASE',
        itemId: 'pin-01',
        name: 'pin',
        category: 'DISNEY_PINS',
        purchasePriceCents: 1_500,
        expectedDaysToSale: 8,
        expectedResaleCents: 3_900,
        occurredAt: T0,
      });
      const s = screen();
      expect(ids(s)).toContain('exposure');
      expect(section(s, 'exposure').title).toMatch(/^Category exposure \(cap \$/);
      expect(labels(s, 'exposure')).toEqual(['DISNEY_PINS']);
    });
  });
});

describe('warnings, and how loud each one is', () => {
  it('says nothing at all on a healthy fund', () => {
    // A screen that always shows a banner has taught the operator to skip them.
    withFund((_store, screen) => {
      expect(screen().banners.filter((b) => b.tone === 'alarm')).toEqual([]);
    });
  });

  it('puts an unverifiable ledger first and alone at alarm', () => {
    withFund((store, screen) => {
      store.db.run("UPDATE ledger_events SET memo = 'tampered' WHERE event_id = 'evt_000001'");
      const s = screen();
      expect(s.banners[0]?.id).toBe('integrity');
      expect(s.banners[0]?.tone).toBe('alarm');
      expect(s.banners[0]?.detail.join(' ')).toContain('hash chain broken at evt_000001');
      expect(s.banners[0]?.detail.join(' ')).toContain('Do not record anything else');
      // Nothing else is ever an alarm.
      expect(s.banners.filter((b) => b.tone === 'alarm')).toHaveLength(1);
    });
  });

  it('stays quiet at the LIVE configuration, where the floor is reachable', () => {
    // $50 bankroll, $20 per item, $8 floor: 1.4x a flip. Measured, not assumed —
    // the first version of this test asserted a warning that correctly is not
    // there, which would have made the assertion below vacuous.
    withFund(
      (_store, screen) => {
        expect(screen().banners.find((x) => x.id === 'reachability')).toBeUndefined();
      },
      { bankrollCents: 5_000 },
    );
  });

  it('raises an unreachable profit floor as a notice, not an alarm', () => {
    // A $100 floor against 40% of a $50 NAV is a 7.2x required on every flip —
    // the collision that actually happened on this fund on 2026-09-08.
    withFund(
      (_store, screen) => {
        const b = screen().banners.find((x) => x.id === 'reachability');
        expect(b?.tone).toBe('notice');
        expect(b?.headline).toContain('not reachable');
        expect(b?.detail.join(' ')).toMatch(/x on every flip/);
        // Still not an alarm: the numbers are right, the rules are impossible.
        expect(screen().banners.filter((x) => x.tone === 'alarm')).toEqual([]);
      },
      { bankrollCents: 5_000, minProfitCents: 10_000 },
    );
  });

  it('says the set-aside is off while the fund is below the floor', () => {
    withFund(
      (_store, screen) => {
        const note = section(screen(), 'bankroll').note ?? '';
        expect(note).toContain('Set-aside OFF');
        expect(note).toContain('Tax still accrues');
        expect(section(screen(), 'bankroll').noteTone).toBe('notice');
      },
      { bankrollCents: 5_000 },
    );
  });

  it('drops the set-aside note once the fund is above the floor', () => {
    withFund((_store, screen) => {
      expect(section(screen(), 'bankroll').note).toBeUndefined();
    });
  });

  it('prefers the tax abstention over a table warning when both apply', () => {
    withFund(
      (_store, screen) => {
        // Without a profile the income-tax number does not exist. Saying so
        // matters more than a footnote about which year the tables are from.
        const tax = section(screen(), 'tax');
        expect(tax.note).toContain('abstains');
        expect(tax.noteTone).toBe('notice');
      },
      { taxProfile: false },
    );
  });
});

describe('the backup footer', () => {
  it('reports an unconfigured backup with the command that fixes it', () => {
    withFund((store) => {
      const text = backupFooter(dashboardView(store));
      expect(text).toContain('NOT CONFIGURED');
      expect(text).toContain('backup config --to=');
    });
  });

  it('is a footnote, never a banner — it is a future risk, not a wrong number', () => {
    withFund((_store, screen) => {
      const s = screen();
      expect(s.footer).toContain('Backup');
      expect(s.banners.map((b) => b.id)).not.toContain('backup');
    });
  });
});
