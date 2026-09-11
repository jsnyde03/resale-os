import { useState } from 'react';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Pressable, Text, View } from 'react-native';

import { scanOutcome, type ScanOutcome } from '../../src/screens/scan.js';
import { lookUpProduct } from '../../src/adapters/upcitemdb.js';
import { UPCITEMDB_KEY } from '../src/config/keys.js';
import { Button, C, Card, H1, Muted } from '../src/ui/theme.js';

/**
 * Point the camera at a barcode.
 *
 * ⛔ **It decides nothing.** This screen turns a barcode into a name and a
 * proposed search, hands them to the aisle screen, and stops. `Check it` still
 * runs the same evaluator against the same gates — a scan is a way of not
 * typing, not a way of being told what to buy.
 *
 * ⚠️ **The title is shown before anything else, and that is the whole safety
 * story.** `000000000000` resolves, with HTTP 200, to "ORGANIC BLUE CORN
 * TORTILLA CHIPS" — so a mis-scan does not fail, it succeeds with the wrong
 * product. Nothing in software can catch that. The operator holding the object
 * can, and only if the title is in front of them.
 *
 * ⛔ **`src/screens/scan.ts` holds the decisions** — which fields a scan may
 * fill, what each failure says, whether a retry is offered. This file is a
 * camera and typography, and B39 still applies: nothing asserts how it looks.
 */
export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const apiKey = UPCITEMDB_KEY;

  /**
   * ⚠️ **Guarded against the camera's firehose.** `onBarcodeScanned` fires many
   * times a second while a code is in frame; without `busy` a single barcode
   * would spend a dozen lookups out of a metered daily allowance.
   */
  async function onScanned(r: BarcodeScanningResult) {
    if (busy || outcome !== null) return;
    setBusy(true);
    try {
      const result = await lookUpProduct(r.data, apiKey === '' ? {} : { apiKey });
      setOutcome(scanOutcome(r.data, result));
    } finally {
      setBusy(false);
    }
  }

  function useIt(keyword: string) {
    if (outcome === null || outcome.kind !== 'IDENTIFIED') return;
    // ⛔ Handed over as parameters rather than written anywhere. The aisle
    // screen owns the form; this screen has no business mutating it.
    router.push({
      pathname: '/sourcing',
      params: { scanTitle: outcome.title, scanBrand: outcome.brand ?? '', scanCategoryPath: outcome.categoryPath ?? '', scanKeyword: keyword },
    });
  }

  if (permission === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 76 }}>
        <Muted>Checking the camera…</Muted>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 76, gap: 16 }}>
        <H1>Scan a barcode</H1>
        {/* ⛔ A refused camera is not an error. Typing was the only way until
            today and it still works exactly as well. */}
        <Muted>
          Resale OS needs the camera to read barcodes. Without it, type the name on the aisle
          screen — everything else works the same.
        </Muted>
        <Button label="Allow the camera" onPress={() => void requestPermission()} tone="primary" />
        <Button label="Type it instead" onPress={() => router.push('/sourcing')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <CameraView
        style={{ flex: 1 }}
        // ⚠️ Retail symbologies only. A QR code on a shelf label is not a product.
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={outcome === null ? (r) => void onScanned(r) : undefined}
      />

      <View style={{ padding: 20, paddingBottom: 40, gap: 12 }}>
        {busy ? <Muted>Looking it up…</Muted> : null}

        {outcome?.kind === 'IDENTIFIED' ? (
          <Card>
            {/* ⛔ The title FIRST and largest. It is the only check on a
                mis-scan, and it only works if it is read. */}
            <Text style={{ color: C.text, fontSize: 17, marginBottom: 8 }}>{outcome.title}</Text>
            <Muted>Is that what you are holding?</Muted>
            <View style={{ height: 12 }} />
            <Muted>Search eBay for:</Muted>
            <Button label={outcome.keyword} onPress={() => useIt(outcome.keyword)} tone="primary" />
            {outcome.alternativeKeyword === null ? null : (
              <>
                {/* ⚠️ B89: on one real product these two searches gave sold
                    medians 68% apart, and that median becomes the resale price.
                    Neither is obviously right, so both are offered. */}
                <View style={{ height: 8 }} />
                <Muted>or, narrower:</Muted>
                <Button
                  label={outcome.alternativeKeyword}
                  onPress={() => useIt(outcome.alternativeKeyword as string)}
                />
              </>
            )}
            <View style={{ height: 8 }} />
            <Pressable onPress={() => setOutcome(null)}>
              <Text style={{ color: C.dim, fontSize: 13, paddingVertical: 8 }}>
                Not it — scan again
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {outcome?.kind === 'UNIDENTIFIED' ? (
          <Card style={{ borderWidth: 1, borderColor: C.warn }}>
            <Text style={{ color: C.warn, fontSize: 15 }}>{outcome.message}</Text>
            <View style={{ height: 10 }} />
            {outcome.canRetry ? (
              <Button label="Try again" onPress={() => setOutcome(null)} />
            ) : null}
            <Button label="Type it instead" onPress={() => router.push('/sourcing')} tone="primary" />
          </Card>
        ) : null}
      </View>
    </View>
  );
}
