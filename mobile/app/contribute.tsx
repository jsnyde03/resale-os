import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { contributionModel } from '../../src/ui/forms.js';
import { refusalText, useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field } from '../src/ui/fields.js';

/**
 * Money coming INTO the fund from its owner.
 *
 * ⛔ **B95: this screen did not exist, and nobody noticed for a day.** The
 * CLI's contribution command went with the rest of the desktop at 5.10, and
 * nothing replaced it — so D3's $25, recorded everywhere as *"a ledger event on
 * the phone, no code ships with this"*, could not be recorded at all. Import
 * needs an empty ledger, and an ADJUSTMENT would book owner money as a
 * correction rather than as capital. It sat under "waiting on Jason" when
 * Jason could not have done it.
 *
 * ⚠️ **Contributed capital, not income.** It raises the bankroll, and every cap
 * that scales with the bankroll scales with it — but it is not profit, and the
 * tax model must never see it as profit.
 *
 * ⛔ **Permanent.** The ledger is append-only over a hash chain, so a wrong
 * amount is corrected by a second event, never erased. That is why the screen
 * shows what the bankroll BECOMES before the button — and says so loudly when
 * the amount would change the fund's rules.
 */
export default function Contribute() {
  const { state, metrics, commit } = useFund();
  const router = useRouter();

  const [amount, setAmount] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  // ⛔ Every rule — zero refused, the after-figure, the crossing into GROWTH —
  // is in `contributionModel`, which is pure and tested. This file renders it.
  const model = contributionModel(
    { amount },
    { navCents: metrics.navCents, promoteAtCents: state.policy.thresholds.promoteAtCents },
  );

  function record() {
    const command = model.command(new Date().toISOString());
    if (!command) return;
    setRefusal(null);
    const outcome = commit(command);
    if (outcome.ok) {
      router.replace('/');
      return;
    }
    setRefusal(refusalText(outcome));
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Money in</H1>

          <Field
            label="How much"
            value={amount}
            onChangeText={setAmount}
            placeholder="25.00"
            keyboardType="decimal-pad"
            invalid={amount.trim() !== '' && model.amountCents === undefined}
          />

          <Card>
            <Row label="Bankroll now" value={formatCents(metrics.navCents)} tone="dim" />
            <Row
              label="After this"
              value={model.navAfterCents === undefined ? '—' : formatCents(model.navAfterCents)}
              tone={model.navAfterCents === undefined ? 'dim' : 'good'}
            />
          </Card>

          {model.crossesIntoGrowth ? (
            // ⚠️ The one amount that is not just a bigger number. Crossing the
            // line moves BOOTSTRAP to GROWTH: a higher minimum profit and a
            // smaller per-item share, applied to every verdict from here on.
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              <Text style={{ color: C.warn, fontSize: 15, marginBottom: 6 }}>
                This changes the rules
              </Text>
              <Muted>
                It takes the bankroll past {formatCents(state.policy.thresholds.promoteAtCents)}, so
                the fund moves from BOOTSTRAP to GROWTH — a higher minimum profit per flip and a
                smaller share per item. If that is not what you meant, check the amount.
              </Muted>
            </Card>
          ) : null}

          <Muted>
            Money you are putting in, not money the fund earned. It raises the bankroll and every
            cap that scales with it, and it is never counted as profit. It cannot be deleted
            afterwards — a wrong amount is corrected by a second entry.
          </Muted>

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
            label="Record the contribution"
            onPress={record}
            tone="primary"
            disabled={!model.ready}
          />

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← cancel
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
