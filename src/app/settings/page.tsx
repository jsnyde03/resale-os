import { redirect } from 'next/navigation';
import { withConfigStore } from '../../server/store.js';
import { parseDollars, toDollarsInput } from '../../core/money.js';
import { FILING_STATUSES, type FilingStatus } from '../../core/tax/tables.js';

export const dynamic = 'force-dynamic';

/**
 * The rules, editable without a shell.
 *
 * ⛔ **Every edit goes through the same validators the CLI uses.** Nothing here
 * re-implements a bound or a sanity check: a bad value throws inside
 * `setPolicy` / `setTaxProfile` and the stored config is untouched — the same
 * guarantee the engine gives the ledger.
 *
 * ⚠️ This page can change the RULES. It cannot record money: `ConfigWriter` has
 * no `commit` on it, at compile time and at runtime.
 */

function Field({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-neutral-300">{label}</span>
      {hint && <span className="ml-2 text-xs text-neutral-600">{hint}</span>}
      <input
        name={name}
        defaultValue={value}
        className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 outline-none focus:border-neutral-500"
      />
    </label>
  );
}

/** A refusal is a normal outcome here, and it must say which rule refused. */
function done(error: unknown): never {
  redirect(
    error === null
      ? '/settings?saved=1'
      : `/settings?error=${encodeURIComponent(String((error as Error).message ?? error))}`,
  );
}

async function saveMode(formData: FormData): Promise<void> {
  'use server';
  try {
    await withConfigStore((c) => {
      const current = c.policy();
      const existing = current.modes.BOOTSTRAP;
      c.setPolicy({
        ...current,
        // ⚠️ Bumping the version is the ONLY thing that makes divergence
        // detectable — `policy show` compares stored against code.
        version: `${current.version}+ui`,
        modes: {
          ...current.modes,
          BOOTSTRAP: {
            ...existing,
            minExpectedProfitCents: parseDollars(String(formData.get('minProfit') ?? '')),
            maxHoldDays: Number(formData.get('maxHold')),
            maxCapitalPerItemBps: Math.round(Number(formData.get('maxPerItemPct')) * 100),
          },
        },
      });
    });
  } catch (err) {
    done(err);
  }
  done(null);
}

async function saveTax(formData: FormData): Promise<void> {
  'use server';
  try {
    await withConfigStore((c) => {
      const current = c.taxProfileOrDefault().profile;
      c.setTaxProfile({
        ...current,
        configured: true,
        filingStatus: String(formData.get('filing') ?? '') as FilingStatus,
        expectedOtherIncomeCents: parseDollars(String(formData.get('otherIncome') ?? '')),
        expectedW2WagesCents: parseDollars(String(formData.get('w2') ?? '')),
      });
    });
  } catch (err) {
    done(err);
  }
  done(null);
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { policy, profile } = await withConfigStore((c) => ({
    policy: c.policy(),
    profile: c.taxProfileOrDefault().profile,
  }));
  const b = policy.modes.BOOTSTRAP;

  return (
    <main className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Rules</h1>
        <a href="/" className="text-sm text-neutral-500 underline">
          fund
        </a>
      </header>

      {params.saved && (
        <p className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">
          Saved.
        </p>
      )}
      {params.error && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Refused, and nothing was changed: {params.error}
        </p>
      )}

      <form
        action={saveMode}
        className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          BOOTSTRAP mode · policy {policy.version}
        </h2>
        <Field
          name="minProfit"
          label="Minimum profit per flip"
          value={toDollarsInput(b.minExpectedProfitCents)}
        />
        <Field name="maxHold" label="Maximum hold" hint="days" value={String(b.maxHoldDays)} />
        <Field
          name="maxPerItemPct"
          label="Max per item"
          hint="% of NAV"
          value={(b.maxCapitalPerItemBps / 100).toFixed(0)}
        />
        <button
          type="submit"
          className="w-full rounded-xl bg-neutral-100 px-4 py-3 font-medium text-neutral-900"
        >
          Save rules
        </button>
        <p className="text-xs text-neutral-600">
          ⚠️ A profit floor and a per-item cap multiply into a constraint neither one states.
          Check the fund screen afterwards — it warns when the floor is unreachable.
        </p>
      </form>

      <form
        action={saveTax}
        className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Tax profile
        </h2>
        <Field
          name="filing"
          label="Filing status"
          hint={FILING_STATUSES.join(' / ')}
          value={profile.filingStatus}
        />
        <Field
          name="otherIncome"
          label="Other income"
          value={toDollarsInput(profile.expectedOtherIncomeCents)}
        />
        <Field name="w2" label="W-2 wages" value={toDollarsInput(profile.expectedW2WagesCents)} />
        <button
          type="submit"
          className="w-full rounded-xl bg-neutral-100 px-4 py-3 font-medium text-neutral-900"
        >
          Save tax profile
        </button>
        <p className="text-xs text-neutral-600">
          State {(profile.stateIncomeTaxBps / 100).toFixed(2)}%
          {profile.stateJurisdiction
            ? ` · ${profile.stateJurisdiction.state} brackets + ${profile.stateJurisdiction.locality}`
            : ' · flat marginal rate'}
          . Change the jurisdiction from the CLI.
        </p>
      </form>

      <p className="px-1 text-xs text-neutral-600">
        This page changes rules, never money. Recording a purchase or a sale is still{' '}
        <code>cli buy</code> / <code>cli sell</code>.
      </p>
    </main>
  );
}
