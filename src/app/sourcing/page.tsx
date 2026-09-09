import { withStore } from '../../server/store.js';
import { evaluateForm, headline } from '../../server/sourcing.js';
import type { SourcingForm, SourcingVerdict } from '../../server/sourcing.js';

export const dynamic = 'force-dynamic';

/**
 * The aisle screen. You are holding an object; the answer has to survive being
 * read at arm's length in bad light, so the verdict is a sentence and the
 * ceiling is the biggest thing on the page.
 *
 * The form round-trips through the URL rather than client state: it means the
 * answer is a link you can keep, re-open, and hand to the CLI later, and it
 * means no JavaScript has to load before the thing works.
 */

function Field({
  name,
  label,
  hint,
  value,
  error,
  inputMode = 'decimal',
}: {
  name: keyof SourcingForm;
  label: string;
  hint?: string;
  value: string;
  error?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  return (
    <label className="block">
      <span className="text-sm text-neutral-300">{label}</span>
      {hint && <span className="ml-2 text-xs text-neutral-600">{hint}</span>}
      <input
        name={name}
        defaultValue={value}
        inputMode={inputMode}
        autoComplete="off"
        className={`mt-1 w-full rounded-xl border bg-neutral-900 px-4 py-3 text-lg text-neutral-100 outline-none focus:border-neutral-500 ${
          error ? 'border-red-800' : 'border-neutral-800'
        }`}
      />
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

function Verdict({ verdict }: { verdict: SourcingVerdict }) {
  const good = verdict.buy && !verdict.overPriced;
  return (
    <section
      className={`rounded-2xl border p-5 ${
        good ? 'border-emerald-800 bg-emerald-950/30' : 'border-amber-900 bg-amber-950/25'
      }`}
    >
      <p className={`text-xl font-semibold ${good ? 'text-emerald-300' : 'text-amber-200'}`}>
        {headline(verdict)}
      </p>
      <p className="mt-1 text-sm text-neutral-400">{verdict.primaryReason}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-neutral-500">Pay up to</div>
          <div className="tabular text-2xl font-semibold text-neutral-50">
            {verdict.maxPrice.text}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">They want</div>
          <div className="tabular text-2xl font-semibold text-neutral-300">
            {verdict.asking.text}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1 text-sm text-neutral-400">
        <div className="flex justify-between">
          <span>expected profit</span>
          <span className="tabular">
            {verdict.expectedProfit.text} ({(verdict.expectedRoiBps / 100).toFixed(0)}% ROI)
          </span>
        </div>
        <div className="flex justify-between">
          <span>expected hold</span>
          <span className="tabular">
            ~{verdict.expectedDaysToSale}d
            {verdict.velocityIsEstimate ? ' (your estimate, not comps)' : ''}
          </span>
        </div>
        <div className="flex justify-between">
          <span>sell-through</span>
          <span className="tabular">{(verdict.sellThroughBps / 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span>buy / risk / confidence</span>
          <span className="tabular">
            {verdict.buyScore} / {verdict.riskScore} / {(verdict.confidenceBps / 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {verdict.reasons.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-neutral-800/60 pt-3 text-sm text-neutral-400">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function Sourcing({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const form: SourcingForm = {
    name: get('name'),
    category: get('category'),
    price: get('price'),
    resale: get('resale'),
    sold90: get('sold90'),
    active: get('active'),
    comps: get('comps'),
  };

  // Nothing typed yet: show an empty form rather than a page of complaints.
  const touched = Object.values(form).some((v) => v !== '');
  const result = touched ? await withStore((store) => evaluateForm(form, store.state())) : null;
  const errors = new Map(result && !result.ok ? result.problems.map((p) => [p.field, p.message]) : []);

  return (
    <main className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Can I buy this?</h1>
        <a href="/" className="text-sm text-neutral-500 underline">
          fund
        </a>
      </header>

      {result?.ok && <Verdict verdict={result.verdict} />}

      <form method="GET" className="space-y-3">
        <Field name="name" label="What is it" value={form.name} error={errors.get('name')} inputMode="text" />
        <Field name="category" label="Category" hint="e.g. TOYS" value={form.category} error={errors.get('category')} inputMode="text" />
        <Field name="price" label="Price on the tag" value={form.price} error={errors.get('price')} />
        <Field name="resale" label="Sells for" hint="before fees" value={form.resale} error={errors.get('resale')} />
        <div className="grid grid-cols-2 gap-3">
          <Field name="sold90" label="Sold / 90d" value={form.sold90} error={errors.get('sold90')} inputMode="numeric" />
          <Field name="active" label="Listed now" value={form.active} error={errors.get('active')} inputMode="numeric" />
        </div>
        <Field name="comps" label="Sold prices" hint="optional, comma separated" value={form.comps ?? ''} error={errors.get('comps')} inputMode="text" />
        <button
          type="submit"
          className="w-full rounded-xl bg-neutral-100 px-4 py-4 text-lg font-medium text-neutral-900"
        >
          Score it
        </button>
      </form>

      <p className="px-1 text-xs text-neutral-600">
        Scoring only. Nothing here records a purchase — that is still{' '}
        <code>cli buy</code>.
      </p>
    </main>
  );
}
