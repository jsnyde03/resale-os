import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../../src/core/capital/commands.js';
import { holdsCapital } from '../../src/core/capital/state.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field, centsOrNothing } from '../src/ui/fields.js';
import { ItemPicker } from '../src/ui/ItemPicker.js';

/**
 * Money leaving the fund that is not a purchase: a business expense, or the
 * owner taking what they are owed.
 *
 * ⚠️ **They share a screen because they are the same question — "where is this
 * going?" — and they are emphatically not the same event.** An expense reduces
 * profit and is deductible. A payout is the owner drawing down a liability the
 * fund already recognised, and changes NAV not at all. Conflating them is how a
 * sole trader ends up paying tax on money they spent on postage.
 */

function Choice({
  options,
  value,
  onSelect,
}: {
  options: readonly string[];
  value: string | null;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onSelect(option)}
          style={({ pressed }) => ({
            backgroundColor: option === value ? C.line : C.card,
            borderWidth: 1,
            borderColor: option === value ? C.good : C.line,
            borderRadius: 8,
            paddingHorizontal: 12,
            // 44pt, the smallest thing worth tapping.
            minHeight: 44,
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: C.text, fontSize: 14 }}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Spend() {
  const { state, metrics, commit } = useFund();
  const router = useRouter();

  const [kind, setKind] = useState<'EXPENSE' | 'PAYOUT'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [againstItem, setAgainstItem] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const amountCents = centsOrNothing(amount);
  const held = useMemo(
    () => Object.values(state.items).filter((i) => holdsCapital(i.state)),
    [state.items],
  );

  function record() {
    if (amountCents === undefined) return;
    setRefusal(null);
    const occurredAt = new Date().toISOString();
    const outcome =
      kind === 'PAYOUT'
        ? commit({ type: 'OWNER_PAYOUT', amountCents, occurredAt })
        : commit({
            type: 'BUSINESS_EXPENSE',
            amountCents,
            category: category ?? 'OTHER',
            // ⚠️ Only when the operator said so. An expense attached to the
            // wrong item quietly moves the cost between item profit and
            // operating profit, and both reports go on being plausible.
            ...(againstItem && itemId ? { itemId } : {}),
            occurredAt,
          });
    if (outcome.ok) {
      router.replace('/');
      return;
    }
    setRefusal(outcome.hint ? `${outcome.refusal}\n${outcome.hint}` : outcome.refusal);
  }

  const ready =
    amountCents !== undefined &&
    (kind === 'PAYOUT' || category !== null) &&
    (!againstItem || itemId !== null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Money out</H1>

          <Choice
            options={['EXPENSE', 'PAYOUT']}
            value={kind}
            onSelect={(v) => setKind(v as 'EXPENSE' | 'PAYOUT')}
          />

          <Field
            label="How much"
            value={amount}
            onChangeText={setAmount}
            placeholder="4.50"
            keyboardType="decimal-pad"
            invalid={amount.trim() !== '' && amountCents === undefined}
          />

          {kind === 'PAYOUT' ? (
            <>
              <Card>
                <Row label="Owner payable" value={formatCents(metrics.ownerPayableCents)} />
                <Row label="Unencumbered cash" value={formatCents(metrics.unencumberedCashCents)} tone="dim" />
              </Card>
              <Muted>
                A payout draws down what the fund already owes you. It does not change NAV and it is
                not an expense — the money stopped being the fund's when the profit was split.
                Paying out more than is payable is refused.
              </Muted>
            </>
          ) : (
            <>
              <Text style={{ color: C.dim, fontSize: 13 }}>What kind</Text>
              <Choice
                options={EXPENSE_CATEGORIES}
                value={category}
                onSelect={(v) => setCategory(v as ExpenseCategory)}
              />

              {held.length > 0 ? (
                <>
                  <Button
                    label={againstItem ? 'Against the business instead' : 'Against one item'}
                    onPress={() => setAgainstItem((v) => !v)}
                  />
                  {againstItem ? (
                    <ItemPicker
                      items={held}
                      selected={itemId}
                      onSelect={setItemId}
                      empty="Nothing on the shelf."
                    />
                  ) : null}
                </>
              ) : null}

              <Muted>
                An expense reduces profit and the tax reserve with it. Attaching it to an item moves
                the cost from operating profit to that item's profit — worth getting right, because
                both reports stay plausible either way.
              </Muted>
            </>
          )}

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
            label={kind === 'PAYOUT' ? 'Record the payout' : 'Record the expense'}
            onPress={record}
            tone="primary"
            disabled={!ready}
          />

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← cancel
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
