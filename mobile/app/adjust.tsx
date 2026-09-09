import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { ACCOUNTS, type Account } from '../../src/core/ledger/accounts.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field, centsOrNothing } from '../src/ui/fields.js';

/**
 * Correcting the books.
 *
 * ⛔ **The escape hatch, and it is deliberately awkward.** Every other screen
 * records something that happened; this one records that the ledger was wrong.
 * It cannot be undone — an append-only ledger has no undo, only a further
 * adjustment — so it asks for a reason, shows the balance before and after, and
 * will not fire on a single tap.
 *
 * ⚠️ **Reversing an expense is NOT this.** A business expense lives in two
 * places, the ledger and the analytic `expenses` table, and a bare adjustment
 * moves only the first — after which operating profit and the category
 * breakdown quietly disagree. That path needs `reversesEventId`, which needs
 * the event id, which needs a ledger view. Until that exists (5.7), the CLI is
 * the place to do it, and this screen says so rather than offering a
 * half-version that corrupts a report.
 */
export default function Adjust() {
  const { state, commit } = useFund();
  const router = useRouter();

  const [account, setAccount] = useState<Account | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const amountCents = centsOrNothing(amount);
  const ready = account !== null && amountCents !== undefined && reason.trim().length >= 8;

  function record() {
    if (account === null || amountCents === undefined) return;
    setRefusal(null);
    const outcome = commit({
      type: 'ADJUSTMENT',
      account,
      amountCents,
      reason: reason.trim(),
      occurredAt: new Date().toISOString(),
    });
    if (outcome.ok) {
      router.replace('/');
      return;
    }
    setConfirming(false);
    setRefusal(outcome.hint ? `${outcome.refusal}\n${outcome.hint}` : outcome.refusal);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Adjust</H1>
          <Muted>
            For when the ledger is wrong. It is recorded like everything else and it cannot be
            undone — a correction to a correction is another adjustment, and both stay on the
            record.
          </Muted>

          <Text style={{ color: C.dim, fontSize: 13 }}>Which account</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ACCOUNTS.map((a) => (
              <Pressable
                key={a}
                onPress={() => {
                  setAccount(a);
                  setConfirming(false);
                }}
                style={({ pressed }) => ({
                  backgroundColor: a === account ? C.line : C.card,
                  borderWidth: 1,
                  borderColor: a === account ? C.good : C.line,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  minHeight: 44,
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: C.text, fontSize: 13 }}>{a}</Text>
              </Pressable>
            ))}
          </View>

          <Field
            label="By how much"
            value={amount}
            onChangeText={(t) => {
              setConfirming(false);
              setAmount(t);
            }}
            placeholder="-1.50"
            keyboardType="decimal-pad"
            hint="Signed, as a human reads the account: positive increases it."
            invalid={amount.trim() !== '' && amountCents === undefined}
          />

          <Field
            label="Why"
            value={reason}
            onChangeText={(t) => {
              setConfirming(false);
              setReason(t);
            }}
            placeholder="miscounted the float on 6 Sept"
            autoCapitalize="words"
            hint="This is the whole audit trail. In six months it is all there is."
          />

          {account !== null && amountCents !== undefined ? (
            <Card>
              <Row label={account} value={formatCents(state.balances[account])} tone="dim" />
              <Row
                label="becomes"
                value={formatCents(state.balances[account] + amountCents)}
                tone="warn"
              />
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

          {/* ⛔ Two taps, always. The first is a decision, the second is a
              confirmation, and the gap between them is where a mis-tap dies. */}
          {confirming ? (
            <View style={{ gap: 10 }}>
              <Muted>This writes to the ledger permanently. Once more to be sure.</Muted>
              <Button label="Yes, adjust the books" onPress={record} tone="danger" />
              <Button label="No" onPress={() => setConfirming(false)} />
            </View>
          ) : (
            <Button
              label="Adjust"
              onPress={() => setConfirming(true)}
              tone="danger"
              disabled={!ready}
            />
          )}

          <Muted>
            Reversing a business expense is a different command — it has to move the analytic
            expense row too, or operating profit and the category breakdown disagree. Do that from
            the desktop until the ledger view exists.
          </Muted>

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← cancel
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
