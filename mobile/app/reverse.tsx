import { useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { formatCents, toDollarsInput } from '../../src/core/money.js';
import { reverseModel } from '../../src/ui/forms.js';
import { refusalText, useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field, centsOrNothing } from '../src/ui/fields.js';

/**
 * An expense that came back.
 *
 * ⛔ **Withheld from the adjust screen on purpose, and this is why it took a
 * ledger view to build.** A business expense lives in two places — the ledger
 * and the analytic `expenses` table operating profit is read from — and only
 * an `ADJUSTMENT` carrying `reversesEventId` moves both. A bare adjustment
 * moves the ledger alone, after which the two reports disagree forever while
 * each goes on looking plausible.
 *
 * The link needs the event id. The event id needed somewhere to come from.
 */
export default function Reverse() {
  const { store, state, commit } = useFund();
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const event = store.events().find((e) => e.event_id === eventId);
  const outstandingCents = event ? store.outstandingExpense(event.event_id) : 0;

  const [amount, setAmount] = useState(() =>
    // Reversing all of it is the common case by a wide margin — the seller
    // refunded the postage, the supply went back. Pre-filled, and editable.
    outstandingCents > 0 ? toDollarsInput(outstandingCents) : '',
  );
  const [reason, setReason] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!event) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ padding: 20, paddingTop: 76, gap: 16 }}>
          <H1>No such event</H1>
          <Muted>Nothing here matches {String(eventId)}.</Muted>
          <Link href="/ledger" style={{ color: C.faint }}>
            ← the ledger
          </Link>
        </View>
      </ScrollView>
    );
  }

  const model = reverseModel({
    eventId: event.event_id,
    outstandingCents,
    amount,
    reason,
  });

  function record() {
    const command = model.command(new Date().toISOString());
    if (!command) return;
    setRefusal(null);
    const outcome = commit(command);
    if (outcome.ok) {
      router.replace('/ledger');
      return;
    }
    setRefusal(refusalText(outcome));
  }

  const notAnExpense = event.type !== 'BUSINESS_EXPENSE';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Money came back</H1>
          <Muted>
            For an expense that was refunded or returned. It puts the cash back and takes the
            deduction back with it, so profit and the category breakdown stay in step.
          </Muted>

          <Card>
            <Row label={event.type} value={event.occurred_at.slice(0, 10)} tone="dim" />
            <Text selectable style={{ color: C.faint, fontSize: 12 }}>
              {event.event_id}
            </Text>
            <View style={{ height: 6 }} />
            <Row
              label="Still standing"
              value={formatCents(outstandingCents)}
              tone={outstandingCents > 0 ? 'normal' : 'dim'}
            />
          </Card>

          {notAnExpense ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              <Text style={{ color: C.warn, fontSize: 15, marginBottom: 6 }}>
                That is not a business expense
              </Text>
              <Muted>
                Only a BUSINESS_EXPENSE can be reversed this way. Anything else that needs
                correcting is an adjustment.
              </Muted>
            </Card>
          ) : outstandingCents === 0 ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              <Text style={{ color: C.warn, fontSize: 15, marginBottom: 6 }}>
                Nothing left to reverse
              </Text>
              <Muted>This expense has already been reversed in full.</Muted>
            </Card>
          ) : (
            <>
              <Field
                label="How much came back"
                value={amount}
                onChangeText={(t) => {
                  setRefusal(null);
                  setAmount(t);
                }}
                placeholder={toDollarsInput(outstandingCents)}
                keyboardType="decimal-pad"
                hint="Part of it is fine. More than is standing is not."
                invalid={
                  (amount.trim() !== '' && centsOrNothing(amount) === undefined) ||
                  model.problem !== null
                }
              />

              {model.problem ? (
                <Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>{model.problem}</Text>
              ) : null}

              <Field
                label="Why"
                value={reason}
                onChangeText={(t) => {
                  setRefusal(null);
                  setReason(t);
                }}
                placeholder="the seller refunded the postage"
                autoCapitalize="words"
                hint="This is the whole audit trail. In six months it is all there is."
              />

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
                label="Record the reversal"
                onPress={record}
                tone="primary"
                disabled={!model.ready}
              />
            </>
          )}

          <Link href="/ledger" style={{ color: C.faint, paddingTop: 8 }}>
            ← the ledger
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
