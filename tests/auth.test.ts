/**
 * The gate.
 *
 * Most of these are bypass attempts, because that is what a gate is for. The
 * two that matter most are structural rather than cryptographic:
 *
 *   - **there is no loopback exemption**, because a tunnel makes every remote
 *     request look local, and
 *   - **no password means unreachable, not open**, because the realistic
 *     failure is forgetting a dev server is running.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openFundStore } from '@/db/open-store.js';
import { withStore, withConfigStore } from '@/server/store.js';
import { T0 } from './helpers.js';
import {
  SESSION_TTL_SECONDS,
  authConfigFromEnv,
  bindingIsAllowed,
  isConfigured,
  isPublicPath,
  issueSession,
  passwordMatches,
  sessionIsValid,
  type AuthConfig,
} from '@/server/auth.js';

const NOW = 1_788_900_000_000;
const GOOD: AuthConfig = { password: 'correct-horse-battery-staple', secret: 'test-secret' };

describe('reading the configuration', () => {
  it('treats an unset or blank password as unconfigured', () => {
    expect(isConfigured(authConfigFromEnv({}))).toBe(false);
    expect(isConfigured(authConfigFromEnv({ RESALE_PASSWORD: '' }))).toBe(false);
    // An all-whitespace password is not a password.
    expect(isConfigured(authConfigFromEnv({ RESALE_PASSWORD: '   ' }))).toBe(false);
  });

  it('derives a signing secret rather than defaulting to a known one', () => {
    const a = authConfigFromEnv({ RESALE_PASSWORD: 'aaaaaaaaaaaa' });
    const b = authConfigFromEnv({ RESALE_PASSWORD: 'bbbbbbbbbbbb' });
    expect(a.secret).not.toBe(b.secret);
    // An explicit secret wins when one is given.
    expect(authConfigFromEnv({ RESALE_PASSWORD: 'x', RESALE_SESSION_SECRET: 's' }).secret).toBe('s');
  });
});

describe('no password means unreachable, not open', () => {
  it('permits only loopback when unconfigured', () => {
    const open = authConfigFromEnv({});
    expect(bindingIsAllowed(open, '127.0.0.1')).toBe(true);
    expect(bindingIsAllowed(open, 'localhost')).toBe(true);
    expect(bindingIsAllowed(open, '::1')).toBe(true);
    expect(bindingIsAllowed(open, '0.0.0.0')).toBe(false);
    expect(bindingIsAllowed(open, '192.168.4.49')).toBe(false);
  });

  it('permits any binding once a password exists', () => {
    expect(bindingIsAllowed(GOOD, '0.0.0.0')).toBe(true);
  });

  it('validates no session at all when unconfigured', () => {
    // Belt and braces: even if something were reachable, an unconfigured gate
    // hands out nothing. It fails closed in both directions.
    const open = authConfigFromEnv({});
    expect(sessionIsValid(open, issueSession(open, NOW), NOW)).toBe(false);
  });
});

describe('the startup guard', () => {
  const guard = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, ['scripts/check-binding.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });

  it('refuses a reachable binding with no password', () => {
    const r = guard({ RESALE_PASSWORD: '' }, '--hostname', '0.0.0.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REFUSING TO START');
  });

  it('allows loopback with no password', () => {
    const r = guard({ RESALE_PASSWORD: '' }, '--hostname', '127.0.0.1');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('127.0.0.1 only');
  });

  it('refuses a password short enough to be guessed', () => {
    const r = guard({ RESALE_PASSWORD: 'hunter2' }, '--hostname', '0.0.0.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('7 characters');
  });

  it('allows a reachable binding with a real password', () => {
    const r = guard({ RESALE_PASSWORD: 'correct-horse-battery' }, '--hostname', '0.0.0.0');
    expect(r.status).toBe(0);
  });

  it('defaults to loopback when no hostname is passed', () => {
    // The default must be the safe one, not the convenient one.
    expect(guard({ RESALE_PASSWORD: '' }).status).toBe(0);
  });
});

describe('the password check', () => {
  it('accepts the password and rejects everything else', () => {
    expect(passwordMatches(GOOD, 'correct-horse-battery-staple')).toBe(true);
    expect(passwordMatches(GOOD, 'correct-horse-battery-stapl')).toBe(false);
    expect(passwordMatches(GOOD, 'correct-horse-battery-staple ')).toBe(false);
    expect(passwordMatches(GOOD, '')).toBe(false);
    expect(passwordMatches(GOOD, 'a')).toBe(false);
  });

  it('never matches when unconfigured, including against an empty attempt', () => {
    const open = authConfigFromEnv({});
    expect(passwordMatches(open, '')).toBe(false);
    expect(passwordMatches(open, 'anything')).toBe(false);
  });
});

describe('sessions', () => {
  it('accepts a token it just issued', () => {
    expect(sessionIsValid(GOOD, issueSession(GOOD, NOW), NOW)).toBe(true);
  });

  it('issues a different token every time', () => {
    // A fixed token would be a password that never changes and never expires.
    expect(issueSession(GOOD, NOW)).not.toBe(issueSession(GOOD, NOW));
  });

  it('expires', () => {
    const token = issueSession(GOOD, NOW);
    expect(sessionIsValid(GOOD, token, NOW + SESSION_TTL_SECONDS * 1000 - 1000)).toBe(true);
    expect(sessionIsValid(GOOD, token, NOW + SESSION_TTL_SECONDS * 1000 + 1000)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const other: AuthConfig = { password: GOOD.password!, secret: 'a-different-secret' };
    expect(sessionIsValid(GOOD, issueSession(other, NOW), NOW)).toBe(false);
  });

  it('rejects a forged expiry — the signature covers it', () => {
    const token = issueSession(GOOD, NOW);
    const [, nonce, signature] = token.split('.') as [string, string, string];
    const farFuture = Math.floor(NOW / 1000) + SESSION_TTL_SECONDS * 100;
    // Extending your own session by editing the cookie is the obvious attack.
    expect(sessionIsValid(GOOD, `${farFuture}.${nonce}.${signature}`, NOW)).toBe(false);
  });

  it('rejects malformed, empty and missing tokens', () => {
    for (const bad of [undefined, '', '.', 'a.b', 'a.b.c.d', 'x.y.z', 'NaN.n.s', '0.n.s']) {
      expect(sessionIsValid(GOOD, bad, NOW)).toBe(false);
    }
  });
});

describe('what is reachable without a session', () => {
  it('is the login page and Next’s own assets, and nothing else', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/_next/static/chunk.js')).toBe(true);
    expect(isPublicPath('/favicon.ico')).toBe(true);

    // Everything that shows money is gated.
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/sourcing')).toBe(false);
    // And no path traversal out of the public prefixes.
    expect(isPublicPath('/_next/../')).toBe(false);
    expect(isPublicPath('/login/../')).toBe(false);
    expect(isPublicPath('/loginx')).toBe(false);
  });
});

describe('the reader handed to a screen cannot write, at runtime', () => {
  it('has no write methods on it at all', async () => {
    // ⛔ Regression test for 2026-09-08: a planted `store.commit()` in page.tsx
    // failed `tsc` and a forgotten dev server executed it anyway, writing 47
    // events to the live ledger. A type is a compile-time promise; this asserts
    // the runtime one.
    const dir = mkdtempSync(join(tmpdir(), 'resale-reader-'));
    try {
      const dbPath = join(dir, 'reader.db');
      const store = openFundStore(dbPath);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      store.close();

      process.env.RESALE_DB = dbPath;
      // Inside the callback: `withStore` closes the ledger on the way out, so a
      // reader used afterwards is a closed database rather than a proof.
      await withStore((reader) => {
        for (const m of ['commit', 'setPolicy', 'setTaxProfile', 'acceptTaxTables', 'close']) {
          expect((reader as unknown as Record<string, unknown>)[m]).toBeUndefined();
        }
        // And the db it exposes cannot write either.
        for (const m of ['run', 'exec', 'transaction', 'close']) {
          expect((reader.db as unknown as Record<string, unknown>)[m]).toBeUndefined();
        }
        // Positive control: it can still actually read, or this proves nothing.
        expect(reader.state().balances.LIQUID).toBe(5_000);
        expect(reader.db.get('SELECT COUNT(*) AS n FROM ledger_events')).toBeDefined();
      });
    } finally {
      delete process.env.RESALE_DB;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('the config door does not open the ledger one', () => {
  it('can write config and still cannot write money', async () => {
    // ⛔ Gate 4 opened config editing to the web (2026-09-08) and stopped
    // exactly there. This asserts the "stopped exactly there" half — the part
    // that is easy to lose the next time something needs one more capability.
    const dir = mkdtempSync(join(tmpdir(), 'resale-config-'));
    try {
      const dbPath = join(dir, 'config.db');
      const store = openFundStore(dbPath);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      store.close();

      process.env.RESALE_DB = dbPath;
      await withConfigStore((config) => {
        // No route to the ledger, at runtime, not just in the types.
        for (const m of ['commit', 'events', 'db', 'opportunities', 'close', 'state']) {
          expect((config as unknown as Record<string, unknown>)[m]).toBeUndefined();
        }
        // Positive control: it really can do its actual job.
        expect(config.policy().version).toBeTruthy();
        expect(typeof config.setPolicy).toBe('function');
      });

      // And the ledger is untouched by all of that.
      const after = openFundStore(dbPath);
      expect(after.state().balances.LIQUID).toBe(5_000);
      expect(after.verifyChain()).toEqual({ ok: true });
      after.close();
    } finally {
      delete process.env.RESALE_DB;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('refuses an invalid policy through the same validator the CLI uses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-config-'));
    try {
      const dbPath = join(dir, 'config.db');
      openFundStore(dbPath).close();
      process.env.RESALE_DB = dbPath;

      await withConfigStore((config) => {
        const good = config.policy();
        // A hold ordering the validator refuses: ideal <= penalty <= max.
        expect(() =>
          config.setPolicy({
            ...good,
            modes: {
              ...good.modes,
              BOOTSTRAP: { ...good.modes.BOOTSTRAP, maxHoldDays: 1, idealHoldDays: 99 },
            },
          }),
        ).toThrow();
        // Nothing landed — a refused edit must leave the stored rules alone.
        expect(config.policy().modes.BOOTSTRAP.maxHoldDays).toBe(
          good.modes.BOOTSTRAP.maxHoldDays,
        );
      });
    } finally {
      delete process.env.RESALE_DB;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
