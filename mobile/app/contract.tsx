import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';

import { runDriverContract } from '../../src/db/driver-contract.js';
import { runEngineScenario, runScenario } from '../../src/db/engine-scenario.js';
import { SCREEN_SCENARIO } from '../../src/db/screen-scenario.js';
import { openExpoDb } from '../src/db/expo-driver.js';

/**
 * The driver contract, executed on the device against `expo-sqlite`.
 *
 * ⛔ These are the SAME cases `tests/driver-node.test.ts` runs against
 * `node:sqlite` — imported from `src/db/driver-contract.ts`, not copied. Two
 * implementations held to one contract is the only arrangement that can
 * actually fail; two suites would agree with themselves and prove nothing.
 *
 * ⚠️ Runs against `:memory:`, so it never touches a real ledger.
 */
export default function Contract() {
  const results = useMemo(() => {
    // Both halves of the port's control: the five driver methods, and the
    // store built on top of them.
    const driver = runDriverContract(() => openExpoDb(':memory:'));
    const engine = runEngineScenario(() => openExpoDb(':memory:'));
    // The third: a day's work driven through the same pure form models the
    // write screens are made of. Not a rendering test — everything after the
    // form is here, on Apple's SQLite, in Hermes, in order.
    const screens = runScenario(SCREEN_SCENARIO, () => openExpoDb(':memory:'));
    const r = [
      ...driver.map((x) => ({ ...x, name: `driver: ${x.name}` })),
      ...engine.map((x) => ({ ...x, name: `engine: ${x.name}` })),
      ...screens.map((x) => ({ ...x, name: `screen: ${x.name}` })),
    ];
    const bad = r.filter((x) => !x.passed);
    const summary = {
      passed: r.length - bad.length,
      total: r.length,
      allPass: bad.length === 0,
      cases: r,
    };

    // ⛔ Written to a FILE, not logged and not stored through the driver.
    //
    // Two reasons, both learned rather than guessed. RN's `console.log` lines
    // **do not survive a Release build** — measured in debt-app-v1's native-e2e
    // lane, zero matches across 3,590 log lines — so CI cannot read a verdict
    // from the log. And storing it through `openExpoDb` would make the
    // reporting mechanism the thing under test: a broken driver would produce
    // no result, which is indistinguishable from an app that never launched.
    try {
      new File(Paths.document, 'driver-contract-result.json').write(
        JSON.stringify(summary, null, 2),
      );
    } catch (err) {
      // Never let the reporter take down the run it is reporting on.
      console.log('contract result write failed', String(err));
    }
    return r;
  }, []);

  const failed = results.filter((r) => !r.passed);
  const allPassed = failed.length === 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <View style={{ padding: 24, paddingTop: 72 }}>
        <Text style={{ color: '#fafafa', fontSize: 20, fontWeight: '600' }}>Driver contract</Text>
        <Text style={{ color: '#737373', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
          expo-sqlite, on device. The same cases node:sqlite runs.
        </Text>

        <View
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: allPassed ? '#14532d' : '#7f1d1d',
            backgroundColor: allPassed ? '#052e1622' : '#450a0a33',
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: allPassed ? '#86efac' : '#fca5a5', fontSize: 16, fontWeight: '600' }}>
            {allPassed
              ? `All ${results.length} passed`
              : `${failed.length} of ${results.length} FAILED`}
          </Text>
        </View>

        {results.map((r) => (
          <View key={r.name} style={{ paddingVertical: 7 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: r.passed ? '#4ade80' : '#f87171', width: 18 }}>
                {r.passed ? '✓' : '✗'}
              </Text>
              <Text style={{ color: r.passed ? '#d4d4d4' : '#fca5a5', flex: 1 }}>{r.name}</Text>
            </View>
            {r.error && (
              <Text style={{ color: '#f87171', fontSize: 12, marginLeft: 26, marginTop: 2 }}>
                {r.error}
              </Text>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
