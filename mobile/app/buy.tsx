import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import {
  assessQuote,
  purchaseCommandFrom,
  type PurchaseQuoteInput,
} from '../../src/core/capital/quote.js';
import { formatCents } from '../../src/core/money.js';
import { itemIdFrom } from '../../src/core/ids.js';
import { refusalText, useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field, centsOrNothing, countOrNothing } from '../src/ui/fields.js';

/**
 * Recording a purchase, in the place where purchases happen.
 *
 * ⚡ **This is the screen the whole gate is for.** The desktop could not be
 * here; a snapshot carried from it would be "exact as of last sync", which is
 * the assuming that was rejected. Every gate below is evaluated against the
 * ledger on this phone at this instant.
 *
 * ⛔ **The arithmetic is `core/capital/quote.ts`, shared with the CLI.** None
 * of it is reimplemented here — this screen collects numbers, shows what the
 * shared code makes of them, and records the answer.
 */

export default function Buy() {
  const { state, commit } = useFund();
  const router = useRouter();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [resale, setResale] = useState('');
  const [sold, setSold] = useState('');
  const [active, setActive] = useState('');
  const [days, setDays] = useState('');
  const [shipping, setShipping] = useState('');
  const [detail, setDetail] = useState(false);

  const [reason, setReason] = useState('');
  const [askingReason, setAskingReason] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const priceCents = centsOrNothing(price);
  const soldCount = countOrNothing(sold);

  const priced = useMemo(() => {
    if (priceCents === undefined || category.trim() === '') return null;
    const input: PurchaseQuoteInput = {
      category: category.trim().toUpperCase(),
      purchasePriceCents: priceCents,
      ...(centsOrNothing(shipping) !== undefined
        ? { inboundShippingCents: centsOrNothing(shipping) }
        : {}),
      ...(centsOrNothing(resale) !== undefined
        ? { expectedGrossCents: centsOrNothing(resale) }
        : {}),
      ...(soldCount !== undefined
        ? { soldLast90Days: soldCount, activeListings: countOrNothing(active) ?? 0 }
        : { operatorDaysEstimate: countOrNothing(days) ?? 7 }),
    };
    return { input, ...assessQuote(state, input) };
  }, [state, category, priceCents, shipping, resale, soldCount, active, days]);

  function record(override: boolean) {
    if (!priced || priceCents === undefined) return;
    setRefusal(null);
    const failures = priced.assessment.failures.map((f) => f.code);
    // ⛔ The command is built by the same code the CLI uses. What the engine
    // hashes must not depend on which surface recorded the buy.
    const outcome = commit(
      purchaseCommandFrom(priced.input, priced.quote, {
        itemId: itemIdFrom(name || category, state.eventCount),
        name: name.trim() || category.trim().toUpperCase(),
        occurredAt: new Date().toISOString(),
        // D4: allowed, never silent, and recorded on the purchase itself so
        // nothing can separate the override from the buy it excuses.
        ...(override ? { override: { gates: failures, reason: reason.trim() } } : {}),
      }),
    );
    if (outcome.ok) {
      router.replace('/');
      return;
    }
    setRefusal(refusalText(outcome));
  }

  const passed = priced?.assessment.passed ?? false;
  const failures = priced?.assessment.failures ?? [];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Buy</H1>

          <Field label="What is it" value={name} onChangeText={setName} placeholder="Lego Millennium Falcon" autoCapitalize="words" />
          <Field
            label="Category"
            value={category}
            onChangeText={setCategory}
            placeholder="TOYS"
            hint="Concentration is capped per category, so this is a gate, not a label."
          />
          <Field
            label="Price"
            value={price}
            onChangeText={setPrice}
            placeholder="12.00"
            keyboardType="decimal-pad"
            invalid={price.trim() !== '' && priceCents === undefined}
          />
          <Field
            label="What you expect to sell it for"
            value={resale}
            onChangeText={setResale}
            placeholder={priceCents !== undefined ? formatCents(priceCents * 3) : '36.00'}
            keyboardType="decimal-pad"
            hint="Gross. Fees and postage come off before any gate sees a profit."
            invalid={resale.trim() !== '' && centsOrNothing(resale) === undefined}
          />

          {detail ? (
            <>
              <Field label="Inbound shipping" value={shipping} onChangeText={setShipping} placeholder="0.00" keyboardType="decimal-pad" />
              <Field
                label="Sold in 90 days"
                value={sold}
                onChangeText={setSold}
                placeholder="50"
                keyboardType="number-pad"
                hint="With comps the hold time and sell-through are derived. Without them the sell-through gate abstains rather than failing an unknown."
              />
              <Field label="Active listings" value={active} onChangeText={setActive} placeholder="8" keyboardType="number-pad" />
              <Field
                label="Or: your guess, in days"
                value={days}
                onChangeText={setDays}
                placeholder="7"
                keyboardType="number-pad"
                hint="Used only when there are no comps."
              />
            </>
          ) : (
            <Button label="More detail" onPress={() => setDetail(true)} />
          )}

          {priced ? (
            <Card>
              <Row label="Landed cost" value={formatCents(priced.quote.landedCostCents)} />
              <Row
                label={`Net on ${priced.quote.feeModel.marketplace}`}
                value={formatCents(priced.quote.estimate.netCents)}
                tone="dim"
              />
              <Row
                label="Expected profit"
                value={formatCents(priced.quote.expectedProfitCents)}
                tone={priced.quote.expectedProfitCents > 0 ? 'good' : 'bad'}
              />
              <Row
                label="ROI"
                value={`${(priced.quote.expectedRoiBps / 100).toFixed(0)}%`}
                tone="dim"
              />
              <Row
                label="Days to sell"
                value={`${priced.quote.velocity.expectedDaysToSale}d${
                  priced.quote.velocity.source === 'COMPS' ? '' : ' (your guess)'
                }`}
                tone="dim"
              />
              <Row
                label="If it has to be dumped"
                value={`-${formatCents(priced.quote.modeledDownsideCents)}`}
                tone="dim"
              />
              {priced.quote.grossWasAssumed ? (
                <Muted>No sale price given, so a 3× flip is assumed.</Muted>
              ) : null}
            </Card>
          ) : (
            <Muted>A category and a price are enough to see what the rules say.</Muted>
          )}

          {priced && !passed ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              <Text style={{ color: C.warn, fontSize: 15, marginBottom: 8 }}>
                This purchase fails the capital rules
              </Text>
              {failures.map((f) => (
                <View key={f.code} style={{ paddingVertical: 4 }}>
                  <Text style={{ color: C.text, fontSize: 14 }}>{f.code}</Text>
                  <Text style={{ color: C.dim, fontSize: 13, lineHeight: 18 }}>{f.message}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {refusal ? (
            <Card style={{ borderWidth: 1, borderColor: C.bad }}>
              <Text style={{ color: C.bad, fontSize: 15, marginBottom: 6 }}>Refused</Text>
              <Text selectable style={{ color: C.dim, fontSize: 13, lineHeight: 19 }}>
                {refusal}
              </Text>
              <View style={{ height: 8 }} />
              <Muted>Nothing was recorded.</Muted>
            </Card>
          ) : null}

          {priced && passed ? <Button label="Record it" onPress={() => record(false)} tone="primary" /> : null}

          {priced && !passed && !askingReason ? (
            <Button label="Buy it anyway" onPress={() => setAskingReason(true)} tone="danger" />
          ) : null}

          {priced && !passed && askingReason ? (
            <View style={{ gap: 12 }}>
              <Field
                label="Why are you overruling the rules"
                value={reason}
                onChangeText={setReason}
                placeholder="seller would not split the lot"
                autoCapitalize="words"
              />
              {/* ⛔ D4. The engine refuses an override with no reason, so this
                  button is disabled rather than letting the fund say no after
                  the fact — but the engine is still the one enforcing it. */}
              <Muted>
                This is recorded on the purchase, permanently, along with which gates it overruled:{' '}
                {failures.map((f) => f.code).join(', ')}.
              </Muted>
              <Button
                label="Record the override"
                onPress={() => record(true)}
                tone="danger"
                disabled={reason.trim() === ''}
              />
            </View>
          ) : null}

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← cancel
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
