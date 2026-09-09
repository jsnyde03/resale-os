import { withStore } from '../../server/store.js';
import { inventoryView } from '../../server/inventory.js';

export const dynamic = 'force-dynamic';

export default async function Inventory() {
  const view = await withStore((store) => inventoryView(store, Date.now()));

  return (
    <main className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Holding</h1>
        <a href="/" className="text-sm text-neutral-500 underline">
          fund
        </a>
      </header>

      {view.empty ? (
        <p className="text-sm text-neutral-500">
          Nothing in inventory. <a href="/sourcing" className="underline">Score something</a>.
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-neutral-400">
                {view.count} item{view.count === 1 ? '' : 's'}
              </span>
              <span className="tabular text-2xl font-semibold">{view.totalBookValue.text}</span>
            </div>
            {view.overdueCount > 0 && (
              <p className="mt-2 text-sm text-amber-300/85">
                {view.overdueCount} past its expected hold — {view.overdueBookValue.text} of
                capital not working.
              </p>
            )}
          </section>

          <ul className="space-y-3">
            {view.rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-2xl border p-4 ${
                  r.overdue ? 'border-amber-900/70 bg-amber-950/20' : 'border-neutral-800 bg-neutral-900/40'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium text-neutral-100">{r.name}</span>
                  <span className="tabular shrink-0 text-neutral-300">{r.bookValue.text}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-neutral-500">
                  <span className="tabular">
                    day {r.daysHeld} of ~{r.expectedDaysToSale}
                    {r.overdue && (
                      <span className="text-amber-300/85"> · {r.daysOverdue}d over</span>
                    )}
                  </span>
                  <span>{r.category}</span>
                  <span>{r.state}</span>
                  {!r.listingLive && <span className="text-amber-300/85">not listed</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
