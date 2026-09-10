import { withStore } from '../../server/store.js';
import { dashboardView } from '../../screens/views.js';

export const dynamic = 'force-dynamic';

/**
 * How good the guesses were, and the three profit numbers.
 *
 * ⛔ The screen refuses to draw a trend below five scored sales. A confident
 * accuracy figure from one sale is worse than no figure at all: it invites a
 * policy change on the strength of a coin flip, and the engine already says so
 * in words (`accuracyVerdict`). This renders the same fact rather than a
 * second, more optimistic one.
 */

function Line({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={dim ? 'text-neutral-500' : 'text-neutral-400'}>{label}</span>
      <span className={`tabular ${dim ? 'text-neutral-400' : 'text-neutral-100'}`}>{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

export default async function Performance() {
  const { accuracy: a, profit: p } = await withStore(dashboardView);

  return (
    <main className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">How it is going</h1>
        <a href="/" className="text-sm text-neutral-500 underline">
          fund
        </a>
      </header>

      <Card title="Prediction accuracy">
        <p className="mb-2 text-sm text-neutral-300">{a.verdict}</p>
        {a.readable ? (
          <>
            <Line label="scored sales" value={String(a.n)} />
            <Line label="sold on time" value={pct(a.onTimeBps)} />
            <Line
              label="hold vs predicted"
              value={`${(a.daysRatioBps / 100).toFixed(0)}% (median error ${a.medianDaysError}d)`}
              dim
            />
            <Line label="netted at least predicted" value={pct(a.proceedsMetBps)} />
            <Line label="median proceeds error" value={a.medianProceedsError.text} dim />
            <div className="my-2 border-t border-neutral-800" />
            <Line label="predicted profit" value={a.totalExpectedProfit.text} dim />
            <Line label="actual profit" value={a.totalActualProfit.text} />
            <Line label="realisation" value={pct(a.profitRealisationBps)} />
          </>
        ) : (
          <p className="text-xs text-neutral-500">
            {a.n === 0
              ? 'Nothing has sold with a prediction against it yet.'
              : `${a.n} scored sale${a.n === 1 ? '' : 's'} — the numbers exist but a trend read from them would be noise.`}
            {a.unpredictedN > 0 && ` ${a.unpredictedN} sold without a prediction to compare against.`}
          </p>
        )}
      </Card>

      {/*
        Three numbers that are not the same, and conflating them is how a
        business spends its tax money on boxes.
      */}
      <Card title="The three profit figures">
        <Line label="Item profit" value={p.itemProfit.text} />
        <p className="mb-2 text-xs text-neutral-600">what the flips made</p>
        <Line label="Operating profit" value={p.operatingProfit.text} />
        <p className="mb-2 text-xs text-neutral-600">
          less {p.businessExpenses.text} of business expenses
        </p>
        <Line label="Owner distributable" value={p.ownerDistributable.text} />
        <p className="text-xs text-neutral-600">
          less {p.taxReserve.text} set aside for tax — not the owner&rsquo;s to take
        </p>
        <div className="my-3 border-t border-neutral-800" />
        <Line label="paid out to date" value={p.ownerPaid.text} dim />
        <Line label="allocated, still in the fund" value={p.ownerPayable.text} dim />
      </Card>

      <Card title="Closed positions">
        <Line label="sold" value={String(p.soldItems)} />
        <Line label="charged off" value={`${p.chargedOffItems} (${p.chargeOff.text})`} dim />
        <Line label="recovered" value={p.recovery.text} dim />
        <Line label="realised ROI" value={pct(p.realisedRoi)} />
      </Card>

      {p.expenses.length > 0 && (
        <Card title="Expenses">
          {p.expenses.map((e) => (
            <Line
              key={`${e.category}-${e.scope}-${String(e.capitalized)}`}
              label={`${e.category}${e.capitalized ? ' (capitalised)' : ''}`}
              value={`${e.total.text} · ${e.n}`}
              dim={e.capitalized}
            />
          ))}
          <p className="mt-2 text-xs text-neutral-600">
            Capitalised costs are already inside an item&rsquo;s book value and are not
            deducted again.
          </p>
        </Card>
      )}
    </main>
  );
}
