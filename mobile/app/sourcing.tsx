import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { evaluateForm, headline, type SourcingForm } from '../../src/screens/sourcing.js';
import { opportunityIdFrom } from '../../src/core/ids.js';
import {
  CONDITIONS,
  CONDITION_LABELS,
  DEFAULT_CONDITION,
  DEFAULT_HASSLE,
  HASSLES,
  HASSLE_LABELS,
  type Condition,
  type Hassle,
} from '../../src/screens/condition.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field } from '../src/ui/fields.js';

/**
 * The aisle question: **should I buy this, and at what price?**
 *
 * ⚡ **This is the screen the phone was missing.** Twelve screens recorded what
 * had already been decided; `buy` assesses a price somebody had already agreed
 * to. Nothing answered the question you ask while holding the object, and D11
 * says the fund does not start buying until the phone can *decide*.
 *
 * ⛔ **It computes nothing.** `src/screens/sourcing.ts` is the model — the same
 * one the desktop rendered — and it goes through the same `evaluateOpportunity`
 * the buy screen now gates with (D14). This file is typography and a keyboard.
 *
 * ⚠️ The headline is the ceiling and the rule that set it, in that order. "Max
 * price $12.40" alone is not actionable; "the per-item cap" is something you can
 * argue with, wait out, or fund.
 */
/** A row of single-choice chips. Local, because only this screen has any. */
function Chips<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: C.dim, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: value === o ? C.text : C.line,
            }}
          >
            <Text style={{ color: value === o ? C.text : C.dim, fontSize: 13 }}>{labels[o]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function Sourcing() {
  const { state, saveOpportunity } = useFund();
  const router = useRouter();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [resale, setResale] = useState('');
  const [sold, setSold] = useState('');
  const [active, setActive] = useState('');
  const [comps, setComps] = useState('');
  const [condition, setCondition] = useState<Condition>(DEFAULT_CONDITION);
  const [hassle, setHassle] = useState<Hassle>(DEFAULT_HASSLE);
  const [result, setResult] = useState<ReturnType<typeof evaluateForm> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form: SourcingForm = useMemo(
    () => ({
      name,
      category,
      price,
      resale,
      sold90: sold,
      active,
      ...(comps.trim() === '' ? {} : { comps }),
      condition,
      hassle,
    }),
    [name, category, price, resale, sold, active, comps, condition, hassle],
  );

  // ⚠️ Nothing is evaluated until it is asked for, and the answer is HELD
  // rather than recomputed. A verdict that re-ran on every keystroke would
  // flicker "Walk away" at somebody halfway through typing the resale price,
  // and that is the one word this screen must not say by accident.
  //
  // ⚡ B68: checking is also RECORDING. The decision is the thing worth keeping
  // — the walk-aways most of all, since they are most of the decisions and
  // nothing else will ever see them.
  function check() {
    const r = evaluateForm(form, state);
    setResult(r);
    if (r.ok) {
      const out = saveOpportunity(r.input, r.evaluation);
      setSaveError(out.ok ? null : out.refusal);
    }
  }

  const verdict = result?.ok === true ? result.verdict : null;
  const problems = result?.ok === false ? result.problems : [];

  const problemFor = (field: keyof SourcingForm) =>
    problems.find((p) => p.field === field)?.message;

  /** Editing anything retracts the answer, so a stale verdict cannot be read. */
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setResult(null);
    };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Should I buy this</H1>

          <Field
            label="What is it"
            value={name}
            onChangeText={edit(setName)}
            placeholder="Lego Millennium Falcon"
            autoCapitalize="words"
            invalid={problemFor('name') !== undefined}
          />
          <Field
            label="Category"
            value={category}
            onChangeText={edit(setCategory)}
            placeholder="TOYS"
            hint="Concentration is capped per category, so this is a gate, not a label."
            invalid={problemFor('category') !== undefined}
          />
          <Field
            label="What they want for it"
            value={price}
            onChangeText={edit(setPrice)}
            placeholder="12.00"
            keyboardType="decimal-pad"
            invalid={problemFor('price') !== undefined}
          />
          <Field
            label="What it sells for"
            value={resale}
            onChangeText={edit(setResale)}
            placeholder="60.00"
            keyboardType="decimal-pad"
            hint="Gross, before fees and postage."
            invalid={problemFor('resale') !== undefined}
          />
          <Field
            label="Sold in 90 days"
            value={sold}
            onChangeText={edit(setSold)}
            placeholder="40"
            keyboardType="number-pad"
            hint="From an eBay sold search. The hold time is DERIVED from this — it is not something you can type."
            invalid={problemFor('sold90') !== undefined}
          />
          <Field
            label="Listed right now"
            value={active}
            onChangeText={edit(setActive)}
            placeholder="10"
            keyboardType="number-pad"
            invalid={problemFor('active') !== undefined}
          />
          <Field
            label="Sold prices"
            value={comps}
            onChangeText={edit(setComps)}
            placeholder="58.00, 61.00, 60.00"
            keyboardType="decimal-pad"
            hint="Comma separated, optional. The biggest single term in confidence — and confidence caps the score."
            invalid={problemFor('comps') !== undefined}
          />

          {/* ⚡ B71. Words, not basis points — and "Not sure" is the default, so
              the operator who skips this gets exactly the old behaviour. */}
          <Chips
            label="Condition"
            options={CONDITIONS}
            labels={CONDITION_LABELS}
            value={condition}
            onChange={edit(setCondition)}
          />
          <Chips
            label="Shipping it"
            options={HASSLES}
            labels={HASSLE_LABELS}
            value={hassle}
            onChange={edit(setHassle)}
          />

          <Button label="Check it" onPress={check} tone="primary" />

          {problems.length > 0 ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              {/* ⚠️ Every problem at once. Someone standing in a shop should not
                  discover a second bad field after fixing the first. */}
              {problems.map((p) => (
                <Text key={`${p.field}:${p.message}`} style={{ color: C.warn, fontSize: 14, paddingVertical: 3 }}>
                  {p.message}
                </Text>
              ))}
            </Card>
          ) : null}

          {verdict ? (
            <>
              <Card
                style={{
                  borderWidth: 1,
                  borderColor: verdict.buy ? C.good : verdict.priceFixable ? C.warn : C.bad,
                }}
              >
                <Text
                  style={{
                    color: verdict.buy ? C.good : verdict.priceFixable ? C.warn : C.bad,
                    fontSize: 22,
                    fontWeight: '600',
                    marginBottom: 8,
                  }}
                >
                  {headline(verdict)}
                </Text>
                <Text style={{ color: C.dim, fontSize: 14, lineHeight: 20 }}>
                  {verdict.primaryReason}
                </Text>
              </Card>

              <Card>
                <Row label="Pay no more than" value={verdict.maxPrice.text} tone={verdict.overPriced ? 'warn' : 'good'} />
                <Row label="They are asking" value={verdict.asking.text} tone="dim" />
                <Row label="Expected profit" value={verdict.expectedProfit.text} tone={verdict.expectedProfit.cents > 0 ? 'good' : 'bad'} />
                <Row label="ROI" value={`${(verdict.expectedRoiBps / 100).toFixed(0)}%`} tone="dim" />
                <Row
                  label="Days to sell"
                  value={`${verdict.expectedDaysToSale}d${verdict.velocityIsEstimate ? ' (your guess)' : ''}`}
                  tone="dim"
                />
                <Row label="Sell-through" value={`${(verdict.sellThroughBps / 100).toFixed(0)}%`} tone="dim" />
                <Row label="Confidence" value={`${(verdict.confidenceBps / 100).toFixed(0)}%`} tone="dim" />
                <Row label="Buy / risk" value={`${verdict.buyScore} / ${verdict.riskScore}`} tone="dim" />
              </Card>

              <Card>
                {/* ⚡ Ordered, and the first is the headline. Straight from the
                    recommender — a screen that re-ranked them would be a second
                    opinion about its own advice. */}
                {verdict.reasons.map((r, i) => (
                  <Text
                    key={r}
                    style={{
                      color: i === 0 ? C.text : C.dim,
                      fontSize: i === 0 ? 15 : 13,
                      lineHeight: i === 0 ? 21 : 19,
                      paddingVertical: 3,
                    }}
                  >
                    {r}
                  </Text>
                ))}
              </Card>

              {verdict.failedGates.length > 0 ? (
                <Card style={{ borderWidth: 1, borderColor: C.warn }}>
                  <Text style={{ color: C.warn, fontSize: 15, marginBottom: 8 }}>
                    {verdict.failedGates.length === 1
                      ? 'It fails a capital rule'
                      : `It fails ${verdict.failedGates.length} capital rules`}
                  </Text>
                  {verdict.failedGates.map((g) => (
                    <View key={g.code} style={{ paddingVertical: 4 }}>
                      <Text style={{ color: C.text, fontSize: 14 }}>{g.code}</Text>
                      <Text style={{ color: C.dim, fontSize: 13, lineHeight: 18 }}>{g.message}</Text>
                    </View>
                  ))}
                  {/* ⚡ B70. Naming the gate is not the same as naming the way
                      out, and the hold is the gate that refuses most real
                      candidates. It inverts exactly, so say the number. */}
                  {verdict.failedGates.some((g) => g.code === 'HOLD_TOO_LONG') ? (
                    <View style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, marginTop: 6 }}>
                      <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>
                        Against {verdict.holdFix.againstActiveListings} listed, you need{' '}
                        <Text style={{ color: C.good }}>
                          {verdict.holdFix.soldNeededIn90Days} sold in 90 days
                        </Text>{' '}
                        to clear the {verdict.holdFix.ceilingDays}-day ceiling.
                      </Text>
                      <Muted>
                        That is the number to look for before anything else — margin rarely
                        refuses a flip at this bankroll, hold time does.
                      </Muted>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {/* ⚡ 5.9c.2. The whole point of scoring in the aisle is that the
                  purchase you then record is the one that was scored — it lands
                  in the accuracy report as SCORED rather than QUOTED, and that
                  is the difference between measuring the system and measuring
                  the operator's guesswork.

                  ⚠️ It hands over the ASKING price, not the ceiling. What gets
                  recorded is what was actually paid, which is the number the
                  operator walks out having agreed to — the ceiling travels as
                  the thing to negotiate against, and nothing more. */}
              <Button
                label={verdict.buy ? 'I bought it' : 'I bought it anyway'}
                tone={verdict.buy ? 'primary' : 'danger'}
                onPress={() =>
                  router.push({
                    pathname: '/buy',
                    params: {
                      name: verdict.name,
                      category: form.category.trim().toUpperCase(),
                      price: form.price,
                      resale: form.resale,
                      sold: form.sold90,
                      active: form.active,
                      comps: form.comps ?? '',
                      opp: opportunityIdFrom(verdict.name, state.eventCount),
                      ceiling: verdict.maxPrice.text,
                    },
                  })
                }
              />

              <Muted>
                Scored against policy {verdict.policyVersion}, and against the ledger on this phone
                as it stands right now.
              </Muted>
            </>
          ) : null}

          {/* ⚡ B3, reachable from where the question is asked. */}
          <Link href="/rejections" style={{ color: C.faint, paddingTop: 8 }}>
            what is stopping me buying anything? →
          </Link>
          <Link href="/" style={{ color: C.faint }}>
            ← back
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
