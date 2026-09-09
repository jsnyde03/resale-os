import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { daysBetween } from '../../src/core/ids.js';
import { estimateNetProceeds, feeModel } from '../../src/core/fees.js';
import { holdsCapital } from '../../src/core/capital/state.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field, centsOrNothing } from '../src/ui/fields.js';
import { ItemPicker } from '../src/ui/ItemPicker.js';

/**
 * Recording a sale.
 *
 * ⚡ **The fees are suggested, never assumed.** The marketplace model knows what
 * eBay usually charges, and what eBay usually charges is not what this sale
 * charged. So the model pre-fills the boxes and the operator corrects them —
 * the recorded numbers are always the ones they saw on the payout, and the
 * suggestion just saves typing the common case.
 *
 * ⛔ **Hold time is derived, not typed.** The CLI took `--days`, so a real hold
 * was recorded as whatever the operator remembered, or as nothing. Both
 * timestamps are already on the record.
 */
export default function Sell() {
  const { state, commit } = useFund();
  const router = useRouter();

  const [itemId, setItemId] = useState<string | null>(null);
  const [gross, setGross] = useState('');
  const [fee, setFee] = useState('');
  const [postage, setPostage] = useState('');
  const [packaging, setPackaging] = useState('');
  const [touched, setTouched] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const sellable = useMemo(
    () => Object.values(state.items).filter((i) => holdsCapital(i.state)),
    [state.items],
  );
  const item = itemId ? state.items[itemId] : undefined;
  const grossCents = centsOrNothing(gross);

  // The suggestion, recomputed as the gross changes — until the operator edits
  // a box, after which their number stands and nothing overwrites it.
  const suggested = useMemo(() => {
    if (grossCents === undefined || !item) return null;
    return estimateNetProceeds(grossCents, feeModel(item.marketplace));
  }, [grossCents, item]);

  function useSuggestion() {
    if (!suggested) return;
    setFee((suggested.marketplaceFeeCents / 100).toFixed(2));
    setPostage((suggested.postageCents / 100).toFixed(2));
    setPackaging((suggested.packagingCents / 100).toFixed(2));
    setTouched(true);
  }

  const feeCents = centsOrNothing(fee) ?? 0;
  const postageCents = centsOrNothing(postage) ?? 0;
  const packagingCents = centsOrNothing(packaging) ?? 0;
  const netCents =
    grossCents === undefined ? undefined : grossCents - feeCents - postageCents - packagingCents;
  const profitCents =
    netCents === undefined || !item ? undefined : netCents - item.bookValueCents;

  function record() {
    if (!item || grossCents === undefined) return;
    setRefusal(null);
    const occurredAt = new Date().toISOString();
    const outcome = commit({
      type: 'SALE',
      itemId: item.itemId,
      grossProceedsCents: grossCents,
      marketplaceFeeCents: feeCents,
      outboundShippingCents: postageCents,
      packagingCents: packagingCents,
      // ⛔ From the two timestamps, not from memory.
      daysToSale: daysBetween(item.acquiredAt, occurredAt),
      occurredAt,
    });
    if (outcome.ok) {
      router.replace('/');
      return;
    }
    setRefusal(outcome.hint ? `${outcome.refusal}\n${outcome.hint}` : outcome.refusal);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Sell</H1>

          <ItemPicker
            items={sellable}
            selected={itemId}
            onSelect={setItemId}
            empty="Nothing on the shelf. A charged-off item sells through a passive recovery, not here."
          />

          {item ? (
            <>
              <Field
                label="What it sold for"
                value={gross}
                onChangeText={setGross}
                placeholder="36.00"
                keyboardType="decimal-pad"
                hint="Gross, including anything the buyer paid for shipping."
                invalid={gross.trim() !== '' && grossCents === undefined}
              />

              {suggested && !touched ? (
                <Card>
                  <Muted>
                    {feeModel(item.marketplace).marketplace} usually takes{' '}
                    {formatCents(suggested.marketplaceFeeCents)}, with{' '}
                    {formatCents(suggested.postageCents)} postage and{' '}
                    {formatCents(suggested.packagingCents)} packaging. Fill those in, then correct
                    them against the payout.
                  </Muted>
                  <View style={{ height: 10 }} />
                  <Button label="Use those, then correct them" onPress={useSuggestion} />
                </Card>
              ) : null}

              <Field label="Marketplace fee" value={fee} onChangeText={(t) => { setTouched(true); setFee(t); }} placeholder="0.00" keyboardType="decimal-pad" invalid={fee.trim() !== '' && centsOrNothing(fee) === undefined} />
              <Field label="Postage you paid" value={postage} onChangeText={(t) => { setTouched(true); setPostage(t); }} placeholder="0.00" keyboardType="decimal-pad" invalid={postage.trim() !== '' && centsOrNothing(postage) === undefined} />
              <Field label="Packaging" value={packaging} onChangeText={(t) => { setTouched(true); setPackaging(t); }} placeholder="0.00" keyboardType="decimal-pad" invalid={packaging.trim() !== '' && centsOrNothing(packaging) === undefined} />

              <Card>
                <Row label="Held" value={`${daysBetween(item.acquiredAt, new Date().toISOString())}d`} tone="dim" />
                <Row label="What it cost" value={formatCents(item.bookValueCents)} tone="dim" />
                {netCents !== undefined ? (
                  <Row label="Net to the fund" value={formatCents(netCents)} />
                ) : null}
                {profitCents !== undefined ? (
                  <Row
                    label="Profit"
                    value={formatCents(profitCents)}
                    tone={profitCents >= 0 ? 'good' : 'bad'}
                  />
                ) : null}
                {item.expectedProfitCents !== undefined && profitCents !== undefined ? (
                  <Row
                    label="You expected"
                    value={formatCents(item.expectedProfitCents)}
                    tone="dim"
                  />
                ) : null}
              </Card>

              {profitCents !== undefined && profitCents < 0 ? (
                <Muted>
                  A loss is recorded exactly like a gain — the fund is made whole first, and what is
                  missing comes out of retained earnings. Nothing is hidden by it.
                </Muted>
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

              <Button
                label="Record the sale"
                onPress={record}
                tone="primary"
                disabled={grossCents === undefined}
              />
            </>
          ) : null}

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← cancel
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
