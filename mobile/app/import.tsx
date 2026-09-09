import { useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { File } from 'expo-file-system';

import { importLedger, LEDGER_EXPORT_VERSION, type LedgerExport } from '../../src/db/portable.js';
import { systemClock } from '../../src/db/store.js';
import { formatCents } from '../../src/core/money.js';
import { computeMetrics } from '../../src/core/capital/metrics.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * Moving the fund onto this phone.
 *
 * ⛔ **A ledger travels as its COMMANDS, and this machine replays them.** Every
 * regenerated hash is compared against the exported one, so if this build's
 * engine disagrees with the one that wrote them — by a rounding change, a key
 * order, a platform quirk — the import **refuses** and nothing lands. Copying
 * the `.db` file would move the bytes without ever asking whether this device
 * agrees with them, and the phone is a different SQLite.
 *
 * ⚠️ That makes this the strongest single test of the whole port. If the same
 * commands produce the same hashes on Apple's SQLite, the engine is identical
 * where it counts.
 */

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'done'; readonly events: number; readonly navCents: number };

function looksLikeExport(v: unknown): v is LedgerExport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.version === 'number' && Array.isArray(o.events) && typeof o.config === 'object';
}

export default function Import() {
  const { store, isEmpty, refresh } = useFund();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function pickAndImport() {
    setPhase({ kind: 'working' });
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain'] });
      if (picked.canceled) {
        setPhase({ kind: 'idle' });
        return;
      }

      const raw = picked.result.textSync();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setPhase({ kind: 'refused', message: 'That file is not JSON.' });
        return;
      }
      if (!looksLikeExport(parsed)) {
        setPhase({
          kind: 'refused',
          message: 'That JSON is not a ledger export — it has no version, events and config.',
        });
        return;
      }

      const report = importLedger(store.db, parsed, systemClock);

      // ⛔ The import replayed through a store of its OWN, so this one is still
      // holding the cache it had before — an empty fund. Without this the
      // screen would report a successful import and the app would show $0.00.
      store.invalidate();
      refresh();
      setPhase({
        kind: 'done',
        events: report.events,
        navCents: computeMetrics(store.state()).navCents,
      });
    } catch (err) {
      // `LedgerTransferError` is the expected failure and it is a refusal, not
      // a crash: the destination is left unusable rather than half-populated,
      // and saying so is the whole point of the mechanism.
      setPhase({ kind: 'refused', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 16 }}>
        <H1>Import a fund</H1>
        <Muted>
          Export from the desktop with `cli export`, put the JSON somewhere this phone can reach —
          iCloud Drive, AirDrop, a message to yourself — then choose it here. Format version{' '}
          {LEDGER_EXPORT_VERSION}.
        </Muted>

        {!isEmpty ? (
          <Card style={{ borderWidth: 1, borderColor: C.warn }}>
            <Row label="This phone already has a ledger" value="" tone="warn" />
            <Muted>
              An import needs an empty one. Two ledgers interleaved would break the hash chain, and
              there is no defensible order for the result — so this refuses rather than merges.
            </Muted>
          </Card>
        ) : (
          <Button
            label={phase.kind === 'working' ? 'Importing…' : 'Choose a file'}
            onPress={pickAndImport}
            tone="primary"
            disabled={phase.kind === 'working'}
          />
        )}

        {phase.kind === 'refused' ? (
          <Card style={{ borderWidth: 1, borderColor: C.bad }}>
            <Text style={{ color: C.bad, fontSize: 15, marginBottom: 6 }}>Import refused</Text>
            <Text selectable style={{ color: C.dim, fontSize: 13, lineHeight: 19 }}>
              {phase.message}
            </Text>
            <View style={{ height: 8 }} />
            <Muted>Nothing was imported. This ledger is unchanged.</Muted>
          </Card>
        ) : null}

        {phase.kind === 'done' ? (
          <Card style={{ borderWidth: 1, borderColor: C.good }}>
            <Row label="Imported" value={`${phase.events} events`} tone="good" />
            <Row label="Bankroll" value={formatCents(phase.navCents)} />
            <View style={{ height: 8 }} />
            <Muted>
              Every hash reproduced, the chain verifies, and the postings scan agrees with an engine
              replay. This phone now holds the fund.
            </Muted>
          </Card>
        ) : null}

        <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
