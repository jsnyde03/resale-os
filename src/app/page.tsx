import { withStore } from '../server/store.js';
import { dashboardView } from '../screens/views.js';
import { primaryScreen } from '../server/screens.js';
import type { ScreenBanner, ScreenRow, ScreenSection, Tone } from '../server/screens.js';

/**
 * The ledger is a file on local disk that the CLI writes to. Any caching here
 * would show numbers from before the last command, which on a money screen is
 * worse than showing nothing.
 */
export const dynamic = 'force-dynamic';

/**
 * This component makes no decisions. Which rows appear, in what order, and how
 * loud each one is are all settled in `src/server/screens.ts`, where they are
 * tested. Everything below is typography.
 */

const TONE: Record<Tone, string> = {
  normal: 'text-neutral-100',
  muted: 'text-neutral-500',
  notice: 'text-amber-300',
  alarm: 'text-red-300',
};

function Row({ row }: { row: ScreenRow }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={row.lead ? 'text-neutral-300' : TONE[row.tone]}>{row.label}</span>
      <span
        className={
          row.lead
            ? 'tabular text-2xl font-semibold text-neutral-50'
            : `tabular ${TONE[row.tone]}`
        }
      >
        {row.value}
      </span>
    </div>
  );
}

function Section({ section }: { section: ScreenSection }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {section.title}
      </h2>
      <div className="divide-y divide-neutral-800/60">
        {section.rows.map((r) => (
          <Row key={r.label} row={r} />
        ))}
      </div>
      {section.note && (
        <p className={`mt-3 text-xs ${TONE[section.noteTone ?? 'muted']}`}>{section.note}</p>
      )}
    </section>
  );
}

function Banner({ banner }: { banner: ScreenBanner }) {
  const alarm = banner.tone === 'alarm';
  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        alarm ? 'border-red-900 bg-red-950/40' : 'border-amber-900 bg-amber-950/30'
      }`}
    >
      <p className={`font-medium ${alarm ? 'text-red-300' : 'text-amber-200'}`}>
        {banner.headline}
      </p>
      <ul className={`mt-1 space-y-1 ${alarm ? 'text-red-200/80' : 'text-amber-200/75'}`}>
        {banner.detail.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function Page() {
  const screen = await withStore((store) => primaryScreen(dashboardView(store)));

  return (
    <main className="space-y-3">
      <header className="flex items-baseline justify-between pb-1">
        <h1 className="text-lg font-semibold">Resale OS</h1>
        {/* The reason to open this on a phone at all. */}
        <nav className="flex gap-3 text-sm text-neutral-400">
          <a href="/inventory" className="underline">
            holding
          </a>
          <a href="/feed" className="underline">
            feed
          </a>
          <a href="/performance" className="underline">
            how it is going
          </a>
          <a href="/settings" className="underline">
            rules
          </a>
          <a href="/sourcing" className="underline">
            can I buy this?
          </a>
        </nav>
      </header>

      {screen.banners.map((b) => (
        <Banner key={b.id} banner={b} />
      ))}

      {screen.sections.map((s) => (
        <Section key={s.id} section={s} />
      ))}

      <footer className="px-1 pt-2 text-xs text-neutral-600">{screen.footer}</footer>
    </main>
  );
}
