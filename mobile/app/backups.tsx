import { useCallback, useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';

import { backupStaleness } from '../../src/db/backup-types.js';
import { useFund } from '../src/fund/FundProvider.js';
import { listDeviceBackups, writeDeviceBackup } from '../src/backup/deviceBackup.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * The second obligation: getting a copy OFF this device.
 *
 * ⛔ **A backup in the app's own folder is not a backup against the failures
 * that end a fund.** It survives a crash, a bad restore and a fat-fingered
 * adjustment. It does not survive deleting the app, losing the phone, or
 * replacing it — and this phone holds the only current ledger.
 *
 * ⚠️ **Nothing here can discharge that obligation on its own.** The share sheet
 * hands the file to iCloud, Files, Mail, AirDrop — whatever the operator picks
 * — and the app cannot see which, or whether they went through with it. So the
 * screen says what it knows and refuses to claim more: copies exist on the
 * device, and one has been OFFERED elsewhere. Whether it landed is not
 * observable from in here, and pretending otherwise would be the most
 * dangerous lie this app could tell.
 */
export default function Backups() {
  const { store, state, refresh, backup } = useFund();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const files = listDeviceBackups();
  const { behind, stale } = backupStaleness(store.backupState(), state.eventCount);

  const makeOne = useCallback(() => {
    setProblem(null);
    setNote(null);
    const result = writeDeviceBackup(store);
    refresh();
    if (result.ok) {
      // ⚠️ NOT `formatCents`. Bytes are not money, and borrowing a money
      // formatter for them is how a size ends up rendered as "$4.50".
      setNote(`Wrote ${result.events} events, ${Math.round((result.bytes ?? 0) / 1024)} KB.`);
    } else {
      setProblem(result.problem ?? 'the backup did not happen');
    }
  }, [store, refresh]);

  const share = useCallback(async (uri: string) => {
    setProblem(null);
    setNote(null);
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setProblem('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Send this ledger backup somewhere else',
        UTI: 'public.json',
      });
      // ⚠️ Deliberately not "sent". `shareAsync` resolves when the sheet
      // closes, not when the file arrives anywhere, and it resolves the same
      // way if the operator cancelled.
      setNote('Handed to the share sheet. If you picked iCloud or Mail, that copy is off the phone.');
    } catch (err) {
      setProblem(`The share sheet failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 14 }}>
        <H1>Backups</H1>

        <Card style={{ borderWidth: 1, borderColor: stale ? C.warn : C.good }}>
          <Row
            label="On this device"
            value={stale ? `${behind} event${behind === 1 ? '' : 's'} behind` : 'current'}
            tone={stale ? 'warn' : 'good'}
          />
          <Row label="Copies kept here" value={String(files.length)} tone="dim" />
          {backup.lastError ? (
            <Text style={{ color: C.bad, fontSize: 13, marginTop: 6 }}>{backup.lastError}</Text>
          ) : null}
        </Card>

        <Muted>
          A copy is written and verified by replay after every change. That protects you from a
          crash or a bad edit. It does not protect you from losing this phone — for that, send one
          somewhere else.
        </Muted>

        <Button label="Make one now" onPress={makeOne} />

        {note ? <Text style={{ color: C.good, fontSize: 13 }}>{note}</Text> : null}
        {problem ? <Text style={{ color: C.bad, fontSize: 13 }}>{problem}</Text> : null}

        {files.length === 0 ? (
          <Muted>No copies on the device yet.</Muted>
        ) : (
          files.map((f, i) => (
            <Card key={f.name}>
              <Text style={{ color: C.text, fontSize: 14 }}>
                {/* The filename carries the timestamp, colon-free so it survives
                    AirDrop to a Mac and the Files app. */}
                {f.name.replace('resale-ledger-', '').replace('.json', '')}
              </Text>
              <Text style={{ color: C.faint, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
                {(f.bytes / 1024).toFixed(0)} KB{i === 0 ? ' · newest' : ''}
              </Text>
              <Button
                label={busy ? 'Opening…' : 'Send it somewhere else'}
                onPress={() => void share(f.uri)}
                tone={i === 0 ? 'primary' : 'normal'}
                disabled={busy}
              />
            </Card>
          ))
        )}

        <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
          ← back
        </Link>
      </View>
    </ScrollView>
  );
}
