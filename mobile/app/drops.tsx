import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { dropsScreen, type DropCandidate } from '../../src/screens/drops.js';
import { dropIdFrom, evidenceFromMarket, type Drop } from '../../src/core/drop.js';
import { lookUpMarket } from '../../src/adapters/soldcomps.js';
import { evaluateOpportunity } from '../../src/scoring/evaluate.js';
import { formatCents } from '../../src/core/money.js';
import { centsOrNothing, Field } from '../src/ui/fields.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * What is coming.
 *
 * 🎯 **Jason, 2026-09-11:** *"Most of my highest returns were not off the
 * clearance rack previously. They were online drops."*
 *
 * ⛔ **Every number here is about a DIFFERENT PRODUCT** — the thing has not been
 * sold, so it is priced off whatever came before it, and the evaluator ceilings
 * both halves of that evidence. The screen says so in words as well, because a
 * capped number still reads like a measured one.
 *
 * ⛔ **It buys nothing (D13).** Monitoring and alerting only.
 *
 * ⚠️ **The verdicts are RECOMPUTED, never stored.** A drop is in the future, so
 * the only useful answer is what today's rules say at today's bankroll — the
 * opposite of the feed, which reports the verdict a decision was actually made
 * under. See `008_drops.sql`.
 */
export default function DropsScreen() {
  const { store, state, metrics, refresh } = useFund();

  const [name, setName] = useState('');
  const [retailer, setRetailer] = useState('');
  const [date, setDate] = useState('');
  const [msrp, setMsrp] = useState('');
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [why, setWhy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stored = useMemo(() => store.dropReader().list(), [store, state]);

  const view = useMemo(() => {
    const candidates: DropCandidate[] = stored.map((s) => ({
      drop: s.drop,
      evidence: s.evidence,
      valuedAt: s.valuedAt,
    }));
    // ⚠️ `new Date()` at render, not a memoised constant: a screen left open
    // overnight would otherwise keep calling yesterday's drop "tomorrow".
    return dropsScreen(candidates, state, metrics.navCents, new Date(), evaluateOpportunity);
  }, [stored, state, metrics.navCents]);

  const msrpCents = centsOrNothing(msrp);
  // ⛔ Both or neither, the same rule the schema enforces. A keyword with no
  // stated reason is a guess with a number attached.
  const analogyOk = (keyword.trim() === '') === (why.trim() === '');
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  const canSave =
    name.trim() !== '' && retailer.trim() !== '' && dateOk && msrpCents !== undefined && analogyOk;

  function add() {
    if (!canSave || msrpCents === undefined) return;
    const drop: Drop = {
      dropId: dropIdFrom(name, date.trim()),
      name: name.trim(),
      retailer: retailer.trim(),
      dropDate: date.trim(),
      msrpCents,
      comparable:
        keyword.trim() === '' ? null : { keyword: keyword.trim(), why: why.trim() },
    };
    store.drops().save(drop, new Date().toISOString());
    setName('');
    setRetailer('');
    setDate('');
    setMsrp('');
    setKeyword('');
    setWhy('');
    setNote(`Added ${drop.name}.`);
    refresh();
  }

  /**
   * ⛔ **The network never gates.** A failed lookup leaves the row exactly as
   * usable as it was — the drop is still on the list with its date and its
   * price, and it simply has no verdict yet. Same rule as the aisle screen.
   */
  async function value(dropId: string, searchFor: string) {
    const apiKey = process.env['EXPO_PUBLIC_SOLDCOMPS_KEY'] ?? '';
    if (apiKey === '') {
      setNote('No market key set — add EXPO_PUBLIC_SOLDCOMPS_KEY to value a drop.');
      return;
    }
    if (category.trim() === '') {
      setNote('Set the category first — the exposure cap is computed per category.');
      return;
    }
    setBusy(true);
    setNote(`Looking up "${searchFor}"…`);
    try {
      // ⛔ `new`, always. A retail drop is sealed by definition, and B90
      // measured what mixed-condition comps do to the median: 234x spread.
      const result = await lookUpMarket(searchFor, { apiKey }, 'new');
      if (!result.ok) {
        setNote(`${result.detail} — the drop is unchanged.`);
        return;
      }
      store
        .drops()
        .value(dropId, evidenceFromMarket(result.reading, category.trim()), new Date().toISOString());
      setNote(`Valued against "${result.reading.provenance.keyword}".`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>What is coming</H1>

          <Card style={{ borderWidth: 1, borderColor: C.line }}>
            <Text style={{ color: C.text, fontSize: 16, lineHeight: 23 }}>{view.headline}</Text>
          </Card>

          {note ? <Muted>{note}</Muted> : null}

          {view.rows.map((r) => {
            const judged = r.status.kind === 'JUDGED' ? r.status.verdict : null;
            return (
              <Card key={r.dropId}>
                <Row
                  label={r.name}
                  value={judged ? judged.msrp.text : formatCents(0)}
                  tone={judged?.buyAtMsrp ? 'good' : 'dim'}
                />
                <Muted>{r.line}</Muted>
                {r.comparable ? (
                  // ⚠️ Always shown. The operator has to be able to disagree
                  // with the comparison, which means seeing it.
                  <Muted>
                    priced against “{r.comparable.keyword}” — {r.comparable.why}
                  </Muted>
                ) : null}
                {judged ? (
                  <Muted>
                    confidence {(judged.confidenceBps / 100).toFixed(0)}% · capped, because these
                    numbers describe last year's product
                    {r.valuationAgeDays === null
                      ? ''
                      : r.valuationAgeDays === 0
                        ? ' · market read today'
                        : ` · market read ${r.valuationAgeDays}d ago`}
                  </Muted>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10, paddingTop: 10 }}>
                  {r.comparable && !r.timing.passed ? (
                    <Button
                      label={r.status.kind === 'NOT_VALUED' ? 'Look up the market' : 'Re-check'}
                      onPress={() => void value(r.dropId, r.comparable!.keyword)}
                      disabled={busy}
                    />
                  ) : null}
                  <Button
                    label="Remove"
                    tone="danger"
                    onPress={() => {
                      store.drops().remove(r.dropId);
                      setNote(`Removed ${r.name}.`);
                      refresh();
                    }}
                  />
                </View>
              </Card>
            );
          })}

          <Card>
            <Text style={{ color: C.dim, fontSize: 13, paddingBottom: 10 }}>Add a drop</Text>
            <View style={{ gap: 12 }}>
              <Field label="What is it" value={name} onChangeText={setName} placeholder="LEGO UCS Millennium Falcon 2026" autoCapitalize="words" />
              <Field label="Where" value={retailer} onChangeText={setRetailer} placeholder="LEGO Store" autoCapitalize="words" />
              <Field
                label="When"
                value={date}
                onChangeText={setDate}
                placeholder="2026-10-01"
                keyboardType="numbers-and-punctuation"
                hint="YYYY-MM-DD. A drop with no date is a rumour."
                invalid={date.trim() !== '' && !dateOk}
              />
              <Field
                label="What it drops at"
                value={msrp}
                onChangeText={setMsrp}
                placeholder="849.99"
                keyboardType="decimal-pad"
                hint="MSRP. The only price that will be available on the day."
                invalid={msrp.trim() !== '' && msrpCents === undefined}
              />
              <Field
                label="Category"
                value={category}
                onChangeText={setCategory}
                placeholder="LEGO"
                hint="Concentration is capped per category, so this is a gate, not a label."
              />
              <Field
                label="Price it like"
                value={keyword}
                onChangeText={setKeyword}
                placeholder="lego ucs millennium falcon 75192"
                hint="The search that finds what came before it. Nothing has sold of the new one."
                invalid={!analogyOk}
              />
              <Field
                label="Because"
                value={why}
                onChangeText={setWhy}
                placeholder="last year's UCS set, same piece count"
                autoCapitalize="words"
                hint="Required with a comparable. An analogy nobody can inspect is a guess with a number attached."
                invalid={!analogyOk}
              />
              <Button label="Add" tone="primary" onPress={add} disabled={!canSave} />
            </View>
          </Card>

          <Muted>
            ⛔ This never buys anything. It says what is coming, what the fund would pay, and what
            the bankroll must reach by the date.
          </Muted>

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← back
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
