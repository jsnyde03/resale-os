import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import {
  FILING_STATUSES,
  allocationEdit,
  allocationFieldsFrom,
  policyEdit,
  policyFieldsFrom,
  type AllocationFields,
  policyStatus,
  taxEdit,
  taxFieldsFrom,
  type FilingStatus,
  type PolicyFields,
  type TaxFields,
} from '../../src/ui/settings.js';
import { formatCents } from '../../src/core/money.js';
import {
  BANKROLL_MODES,
  DEFAULT_POLICY,
  type BankrollMode,
} from '../../src/core/capital/policy.js';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';
import { Field } from '../src/ui/fields.js';

/**
 * The fund's rules, on the device that holds the fund.
 *
 * ⛔ **This screen exists because deleting the desktop deleted a capability.**
 * `policy set`, `policy adopt-defaults` and `tax profile set` went with the CLI
 * and nothing replaced them, so the rules were frozen — and because policy lives
 * in the DATABASE, editing a default in `policy.ts` could not reach the live
 * fund by any route. Found by 5.11.3's reconciliation, not by anything failing.
 *
 * ⛔ **The arithmetic and the refusals are `src/ui/settings.ts`**, tested in
 * Node. This file is typography, a keyboard, and two buttons.
 */
export default function Settings() {
  const { state, metrics, setPolicy, setTaxProfile } = useFund();
  const stored = state.policy;

  // ⚡ **6.7.3: which mode's rules are being edited, not just the active one.**
  // `policyFieldsFrom` and `policyEdit` always took a mode; only this screen
  // was fixed to `metrics.mode`, so GROWTH's rules could not be set until the
  // fund had already reached GROWTH — the worst possible moment to think about
  // them. Defaults to the active mode, which is the old behaviour.
  const [mode, setMode] = useState<BankrollMode>(metrics.mode);

  const [fields, setFields] = useState<PolicyFields>(() => policyFieldsFrom(stored, mode));
  const [alloc, setAlloc] = useState<AllocationFields>(() => allocationFieldsFrom(stored));
  const [tax, setTax] = useState<TaxFields>(() => taxFieldsFrom(state.taxProfile));
  const [saved, setSaved] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const status = useMemo(() => policyStatus(stored), [stored]);
  const edit = useMemo(
    () => policyEdit(stored, mode, fields, metrics.navCents),
    [stored, mode, fields, metrics.navCents],
  );
  const taxResult = useMemo(() => taxEdit(tax), [tax]);
  const allocResult = useMemo(
    () => allocationEdit(stored, alloc, metrics.navCents),
    [stored, alloc, metrics.navCents],
  );

  /** Switching mode reloads that mode's stored rules, discarding an unsaved edit. */
  function pickMode(next: BankrollMode) {
    setMode(next);
    setFields(policyFieldsFrom(stored, next));
    setSaved(null);
    setRefusal(null);
  }

  function saveAllocation() {
    if (!allocResult.next) return;
    const out = setPolicy(allocResult.next);
    setRefusal(out.ok ? null : out.refusal);
    setSaved(out.ok ? 'Split saved.' : null);
  }

  function savePolicy() {
    if (!edit.next) return;
    const out = setPolicy(edit.next);
    setRefusal(out.ok ? null : out.refusal);
    setSaved(out.ok ? 'Rules saved.' : null);
  }

  function adoptDefaults() {
    const out = setPolicy(DEFAULT_POLICY);
    setRefusal(out.ok ? null : out.refusal);
    if (out.ok) {
      setFields(policyFieldsFrom(DEFAULT_POLICY, mode));
      setAlloc(allocationFieldsFrom(DEFAULT_POLICY));
      setSaved("Adopted the code's defaults.");
    }
  }

  function saveTax() {
    if (!taxResult.next) return;
    const out = setTaxProfile(taxResult.next);
    setRefusal(out.ok ? null : out.refusal);
    setSaved(out.ok ? 'Tax profile saved.' : null);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20, paddingTop: 76, paddingBottom: 64, gap: 16 }}>
          <H1>Rules</H1>
          <Muted>
            These are the fund&apos;s, not the app&apos;s. They live in the ledger database, so
            changing them here is the only thing that changes what the fund will buy.
          </Muted>

          {status.diverged ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              <Text style={{ color: C.warn, fontSize: 15, marginBottom: 6 }}>
                The stored rules are not the code&apos;s
              </Text>
              <Muted>
                Stored {status.storedVersion}, code {status.codeVersion}. A stored policy older
                than the code keeps running the old numbers silently — this line is the only thing
                that can tell you.
              </Muted>
              <View style={{ height: 10 }} />
              <Button label="Adopt the code's defaults" onPress={adoptDefaults} />
            </Card>
          ) : null}

          <Card>
            <Row label="Mode now" value={metrics.mode} />
            <Row label="Bankroll" value={formatCents(metrics.navCents)} tone="dim" />
            <Row label="Rules version" value={status.storedVersion} tone="dim" />
          </Card>

          {/* ⚡ 6.7.3. GROWTH's rules could not be set until the fund had already
              reached GROWTH — the worst possible moment to think about them. */}
          <View style={{ gap: 8 }}>
            <Text style={{ color: C.dim, fontSize: 13 }}>Editing the rules for</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {BANKROLL_MODES.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => pickMode(m)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: mode === m ? C.text : C.line,
                  }}
                >
                  <Text style={{ color: mode === m ? C.text : C.dim, fontSize: 13 }}>{m}</Text>
                </Pressable>
              ))}
            </View>
            {mode === metrics.mode ? null : (
              /* ⚠️ Editing a mode the fund is not in changes nothing today. Say
                 so, or a saved change reads as having had no effect. */
              <Muted>
                The fund is in {metrics.mode}. Changing {mode}&apos;s rules is allowed and takes
                effect when the fund gets there — it does not change what it will buy today.
              </Muted>
            )}
          </View>

          <Field
            label={`Max per item, as % of bankroll (${mode})`}
            value={fields.maxPerItemPercent}
            onChangeText={(v) => setFields({ ...fields, maxPerItemPercent: v })}
            placeholder="40"
            keyboardType="decimal-pad"
            hint={`Currently ${formatCents(metrics.maxCapitalPerItemCents)} at this bankroll.`}
          />
          <Field
            label="Minimum profit per flip"
            value={fields.minProfit}
            onChangeText={(v) => setFields({ ...fields, minProfit: v })}
            placeholder="8.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Maximum hold, in days"
            value={fields.maxHoldDays}
            onChangeText={(v) => setFields({ ...fields, maxHoldDays: v })}
            placeholder="21"
            keyboardType="number-pad"
            hint="The ceiling that decides most refusals. Sold-in-90 must be about 4.3 x (active + 1) to clear 21 days."
          />

          {/* ⚠️ The consequence of the two numbers TOGETHER, before it is saved.
              A profit floor and a per-item cap imply a required multiple that
              neither one states, and that is how a fund quietly stops being
              able to buy anything. */}
          {!edit.reachability.reachable ? (
            <Card style={{ borderWidth: 1, borderColor: C.bad }}>
              <Text style={{ color: C.bad, fontSize: 15, marginBottom: 6 }}>
                These two numbers cannot both hold
              </Text>
              <Muted>
                A {formatCents(edit.reachability.maxPerItemCents)} item would have to sell for{' '}
                {formatCents(edit.reachability.grossNeededCents)} gross to clear a{' '}
                {formatCents(edit.reachability.minProfitCents)} floor —{' '}
                {(edit.reachability.requiredMultipleBps / 10_000).toFixed(1)}× on every flip. Either
                fund it to about {formatCents(edit.reachability.impliedBankrollCents)}, or lower the
                floor.
              </Muted>
            </Card>
          ) : null}

          {edit.problems.length > 0 ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              {edit.problems.map((p) => (
                <Text key={p} style={{ color: C.warn, fontSize: 14, paddingVertical: 3 }}>
                  {p}
                </Text>
              ))}
            </Card>
          ) : null}

          <Button
            label={edit.changed ? 'Save the rules' : 'Nothing changed'}
            onPress={savePolicy}
            tone="primary"
            disabled={!edit.changed || edit.next === null}
          />

          <View style={{ height: 8 }} />
          <H1>The split</H1>
          <Muted>
            How profit is divided after tax, and the bankroll below which it is not divided at
            all. ⛔ These are the numbers D2 is decided against.
          </Muted>

          {/* ⚠️ Said before the fields, not after. The live fund is below the
              threshold, so a split edited here moves no money yet — an operator
              who does not know that concludes the numbers did nothing. */}
          {allocResult.consequence.splitIsDormant ? (
            <Card>
              <Muted>
                Nothing is set aside yet. Below{' '}
                {formatCents(allocResult.consequence.startsAtCents)} of bankroll the whole
                after-tax profit compounds, so this split starts applying when the fund gets
                there. Tax still accrues — that is an obligation, not a distribution.
              </Muted>
            </Card>
          ) : null}

          <Field
            label="Owner, as % of after-tax profit"
            value={alloc.ownerPercent}
            onChangeText={(v) => setAlloc({ ...alloc, ownerPercent: v })}
            placeholder="20"
            keyboardType="decimal-pad"
          />
          <Field
            label="Operating reserve, as %"
            value={alloc.operatingReservePercent}
            onChangeText={(v) => setAlloc({ ...alloc, operatingReservePercent: v })}
            placeholder="10"
            keyboardType="decimal-pad"
          />
          <Field
            label="Reinvested, as %"
            value={alloc.reinvestPercent}
            onChangeText={(v) => setAlloc({ ...alloc, reinvestPercent: v })}
            placeholder="70"
            keyboardType="decimal-pad"
            hint={`${(allocResult.consequence.reinvestBps / 100).toFixed(0)}% stays in the fund, ${(allocResult.consequence.withdrawnBps / 100).toFixed(0)}% leaves it.`}
          />
          <Field
            label="Start splitting at a bankroll of"
            value={alloc.setAsideMinNav}
            onChangeText={(v) => setAlloc({ ...alloc, setAsideMinNav: v })}
            placeholder="100.00"
            keyboardType="decimal-pad"
            hint="Below this, everything after tax compounds. Must sit below the GROWTH promotion."
          />

          {allocResult.problems.length > 0 ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              {allocResult.problems.map((p) => (
                <Text key={p} style={{ color: C.warn, fontSize: 14, paddingVertical: 3 }}>
                  {p}
                </Text>
              ))}
            </Card>
          ) : null}

          <Button
            label={allocResult.changed ? 'Save the split' : 'Nothing changed'}
            onPress={saveAllocation}
            tone="primary"
            disabled={!allocResult.changed || allocResult.next === null}
          />

          <View style={{ height: 8 }} />
          <H1>Tax</H1>
          <Muted>
            Income tax abstains until this is set, rather than guessing — a confident wrong number
            is worse than an honest gap.
          </Muted>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FILING_STATUSES.map((f: FilingStatus) => (
              <Pressable
                key={f}
                onPress={() => setTax({ ...tax, filingStatus: f })}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: tax.filingStatus === f ? C.text : C.line,
                }}
              >
                <Text style={{ color: tax.filingStatus === f ? C.text : C.dim, fontSize: 13 }}>
                  {f.replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
          </View>

          <Field
            label="Other income this year"
            value={tax.otherIncome}
            onChangeText={(v) => setTax({ ...tax, otherIncome: v })}
            placeholder="45000"
            keyboardType="decimal-pad"
            hint="What decides which bracket the business income lands in — it matters more than any other input."
          />
          <Field
            label="W-2 wages this year"
            value={tax.w2Wages}
            onChangeText={(v) => setTax({ ...tax, w2Wages: v })}
            placeholder="45000"
            keyboardType="decimal-pad"
            hint="They consume the Social Security wage base before self-employment income does."
          />
          <Field
            label="State + local rate, combined %"
            value={tax.stateRatePercent}
            onChangeText={(v) => setTax({ ...tax, stateRatePercent: v })}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <Field
            label="Where that rate came from"
            value={tax.stateRateBasis}
            onChangeText={(v) => setTax({ ...tax, stateRateBasis: v })}
            placeholder="state 4.75% + county 2.40%, published table, 2026"
            hint="Required for any non-zero rate. A bare rate is unexplainable in six months, and a wrong one is invisible."
          />

          {taxResult.problems.length > 0 ? (
            <Card style={{ borderWidth: 1, borderColor: C.warn }}>
              {taxResult.problems.map((p) => (
                <Text key={p} style={{ color: C.warn, fontSize: 14, paddingVertical: 3 }}>
                  {p}
                </Text>
              ))}
            </Card>
          ) : null}

          <Button
            label="Save the tax profile"
            onPress={saveTax}
            disabled={taxResult.next === null}
          />

          {refusal ? (
            <Card style={{ borderWidth: 1, borderColor: C.bad }}>
              <Text style={{ color: C.bad, fontSize: 15, marginBottom: 6 }}>Refused</Text>
              <Text selectable style={{ color: C.dim, fontSize: 13, lineHeight: 19 }}>
                {refusal}
              </Text>
              <View style={{ height: 8 }} />
              <Muted>Nothing was changed.</Muted>
            </Card>
          ) : null}

          {saved && !refusal ? <Muted>{saved}</Muted> : null}

          <Link href="/" style={{ color: C.faint, paddingTop: 8 }}>
            ← back
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
