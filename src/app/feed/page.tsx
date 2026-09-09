import { withStore } from '../../server/store.js';
import { feedView } from '../../server/feed.js';
import { bindingGateView } from '../../server/binding.js';
import type { BindingView } from '../../server/binding.js';
import type { FeedRow } from '../../server/feed.js';
import type { OpportunityStatus } from '../../domain/opportunity.js';

export const dynamic = 'force-dynamic';

/** The filters `opp list` already supports, as links rather than a form. */
const FILTERS = [
  { label: 'all', query: '' },
  { label: 'buys', query: 'rec=BUY' },
  { label: 'new', query: 'status=NEW' },
  { label: 'score 65+', query: 'min=65' },
] as const;

function Row({ row }: { row: FeedRow }) {
  const good = row.recommendation === 'BUY' && !row.overPriced;
  return (
    <li className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-neutral-100">{row.name}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            good
              ? 'bg-emerald-950 text-emerald-300'
              : row.recommendation === 'BUY'
                ? 'bg-amber-950 text-amber-300'
                : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          {row.overPriced && row.recommendation === 'BUY' ? 'TOO DEAR' : (row.recommendation ?? 'UNSCORED')}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-400">
        <span className="tabular">
          {row.asking.text}
          {row.maxPrice && <span className="text-neutral-600"> / max {row.maxPrice.text}</span>}
        </span>
        <span className="tabular">{row.expectedProfit.text} profit</span>
        <span className="tabular">~{row.expectedDaysToSale}d</span>
        {row.buyScore !== null && (
          <span className="tabular">
            {row.buyScore}
            <span className="text-neutral-600"> buy</span> / {row.riskScore}
            <span className="text-neutral-600"> risk</span>
          </span>
        )}
      </div>

      {row.reason && <p className="mt-2 text-xs text-neutral-500">{row.reason}</p>}

      {row.stale && (
        <p className="mt-2 text-xs text-amber-300/80">
          Scored under policy {row.policyVersion}, which is no longer the one in force. The
          numbers above are what was decided then — re-score with <code>opp score</code>.
        </p>
      )}
    </li>
  );
}

/**
 * Risk R2: at a small bankroll the gates reject a lot, and that is correct. The
 * useful question is WHICH gate, because "add capital", "change a rule" and
 * "find better items" are three different responses.
 */
function Binding({ binding }: { binding: BindingView }) {
  const top = binding.binding!;
  const cause = binding.dominantCause!;
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
        What is binding
      </h2>
      {/*
        The CAUSE leads, not the code. A single rejected item trips several
        gates at once and BUY_SCORE_TOO_LOW is a composite, so the top code is
        often both unactionable and a small share of the total.
      */}
      <p className="text-sm text-neutral-200">
        Mostly <span className="font-medium">{cause.headline}</span> —{' '}
        {(cause.shareBps / 100).toFixed(0)}% of {binding.total} rejection
        {binding.total === 1 ? '' : 's'}.
      </p>
      <p className="mt-1 text-sm text-neutral-400">{cause.implication}</p>
      <p className="mt-2 text-xs text-neutral-500">
        Most common single gate: {top.label} ({top.n}).
      </p>
      <ul className="mt-3 space-y-1 text-xs text-neutral-500">
        {binding.rows.slice(1, 5).map((r) => (
          <li key={r.code} className="flex justify-between gap-3">
            <span>{r.label}</span>
            <span className="tabular">{r.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function Feed({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
  const min = one('min');

  const { view, binding } = await withStore((store) => ({
    binding: bindingGateView(store),
    view: feedView(store, {
      ...(one('status') ? { status: one('status') as OpportunityStatus } : {}),
      ...(one('rec') ? { recommendation: one('rec') } : {}),
      ...(one('category') ? { category: one('category') } : {}),
      ...(min && /^\d+$/.test(min) ? { minBuyScore: Number(min) } : {}),
    }),
  }));

  const active = `${one('rec') ?? ''}${one('status') ?? ''}${min ?? ''}`;

  return (
    <main className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Opportunities</h1>
        <a href="/" className="text-sm text-neutral-500 underline">
          fund
        </a>
      </header>

      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.query === '' ? active === '' : f.query.split('=')[1] === active;
          return (
            <a
              key={f.label}
              href={f.query === '' ? '/feed' : `/feed?${f.query}`}
              className={`rounded-full px-3 py-1 text-sm ${
                isActive ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-900 text-neutral-400'
              }`}
            >
              {f.label}
            </a>
          );
        })}
      </nav>

      {view.staleCount > 0 && (
        <p className="rounded-xl border border-amber-900 bg-amber-950/25 p-3 text-sm text-amber-200/85">
          {view.staleCount} of these were scored under an older policy. Their numbers are kept as
          recorded rather than quietly recomputed.
        </p>
      )}

      {view.empty && (
        <p className="text-sm text-neutral-500">
          Nothing scored yet. <a href="/sourcing" className="underline">Score something</a>.
        </p>
      )}
      {view.filteredToNothing && (
        <p className="text-sm text-neutral-500">
          Nothing matches that filter — there are opportunities, just not these.
        </p>
      )}

      {!binding.empty && <Binding binding={binding} />}

      <ul className="space-y-3">
        {view.rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
    </main>
  );
}
