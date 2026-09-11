import { Link, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { formatCents } from '../../src/core/money.js';
import { assessProfitFloor } from '../../src/core/capital/reachability.js';
import { feeModel } from '../../src/core/fees.js';
import Contract from './contract';
import { useFund } from '../src/fund/FundProvider.js';
import { Button, C, Card, H1, Muted, Row } from '../src/ui/theme.js';

/**
 * The position. What the CLI's `status` printed, on the device that holds the
 * ledger.
 *
 * ⛔ **Nothing here is a snapshot.** Jason's constraint on the whole gate was
 * *"the app should be smart enough to exactly know my current bankroll"* — so
 * every number below is derived from the ledger on this phone, at this instant,
 * with no network and nothing carried over from a desktop.
 */
function Position() {
  const { metrics: m, state, isEmpty, backup } = useFund();
  const router = useRouter();

  if (isEmpty) {
    return (
      <View style={{ gap: 16 }}>
        <H1>No ledger on this phone</H1>
        <Muted>
          The database was created and migrated, and it holds no events. Import a fund to start —
          the import replays every command and refuses anything whose hash it cannot reproduce.
        </Muted>
        <Button label="Import a fund" onPress={() => router.push('/import')} tone="primary" />
      </View>
    );
  }

  // Two facts that only matter when they bite, so they are shown only then.
  const reach = assessProfitFloor(m.navCents, m.modePolicy, feeModel(undefined));
  const setAsideOff = m.navCents < state.policy.allocation.setAsideMinNavCents;

  return (
    <View style={{ gap: 16 }}>
      <View>
        <H1>{formatCents(m.navCents)}</H1>
        <Muted>
          {m.mode} · {formatCents(m.maxCapitalPerItemCents)} max per item ·{' '}
          {m.modePolicy.maxHoldDays}d ceiling
        </Muted>
      </View>

      <Card>
        <Row label="Deployable now" value={formatCents(m.deployableCapitalCents)} tone="good" />
        <Row label="liquid cash" value={formatCents(m.liquidCents)} indent tone="dim" />
        <Row
          label="inventory at cost"
          value={formatCents(m.inventoryAtCostCents)}
          indent
          tone="dim"
        />
        <Row label="less earmarks" value={formatCents(-m.earmarkedCents)} indent tone="dim" />
      </Card>

      <Card>
        <Row label="Tax reserve" value={formatCents(m.taxReserveCents)} />
        <Row label="Operating reserve" value={formatCents(m.operatingReserveCents)} />
        <Row label="Owner payable" value={formatCents(m.ownerPayableCents)} />
        <Row label="Liquid floor" value={formatCents(m.minLiquidFloorCents)} tone="dim" />
      </Card>

      {setAsideOff ? (
        <Muted>
          Set-aside is OFF until {formatCents(state.policy.allocation.setAsideMinNavCents)} of NAV —
          profit compounds instead of paying the owner. Tax still accrues.
        </Muted>
      ) : null}

      {!reach.reachable ? (
        <Card style={{ borderWidth: 1, borderColor: C.warn }}>
          <Row
            label="Profit floor is unreachable"
            value={formatCents(reach.minProfitCents)}
            tone="warn"
          />
          <Muted>
            A {formatCents(reach.maxPerItemCents)} item must sell for{' '}
            {formatCents(reach.grossNeededCents)} gross to clear it —{' '}
            {(reach.requiredMultipleBps / 10_000).toFixed(1)}× on every flip. Either fund it to
            about {formatCents(reach.impliedBankrollCents)}, or lower the floor.
          </Muted>
        </Card>
      ) : null}

      <Card>
        <Row label="Active items" value={String(m.activeItemCount)} />
        <Row label="Events recorded" value={String(state.eventCount)} tone="dim" />
        {/* ⛔ Whether the fund is backed up is a fact about safety, so it is on
            the main screen rather than behind a menu nobody opens. The desktop
            put it on `status` for the same reason — and this phone holds the
            only current copy, which the desktop never did. */}
        <Row
          label="Backed up"
          value={
            backup.stale
              ? backup.behind === state.eventCount
                ? 'never'
                : `${backup.behind} event${backup.behind === 1 ? '' : 's'} behind`
              : 'current'
          }
          tone={backup.stale ? 'warn' : 'good'}
        />
      </Card>

      {backup.lastError ? (
        <Card style={{ borderWidth: 1, borderColor: C.bad }}>
          <Text style={{ color: C.bad, fontSize: 15, marginBottom: 6 }}>
            The last backup did not happen
          </Text>
          <Text selectable style={{ color: C.dim, fontSize: 13, lineHeight: 19 }}>
            {backup.lastError}
          </Text>
        </Card>
      ) : null}

      {/* ⚠️ The second obligation, and the one nothing here can discharge. A
          copy in this app's own folder dies with the app and with the phone. */}
      {/* ⚠️ The honest version: the app knows a copy exists HERE. It cannot
          know whether one ever left, so it says what it knows and points at
          the screen that can do something about it. */}
      <Muted>
        Copies are written here after every change. Getting one off this phone is a separate
        thing, and until you do it the fund exists on exactly one device.
      </Muted>
      <Button label="Backups" onPress={() => router.push('/backups')} />

      <View style={{ gap: 10 }}>
        {/* ⚡ Above Buy, and deliberately. The order on this screen is the order
            of the decision: work out whether to buy it, then record that you
            did. Twelve screens recorded; none decided. */}
        <Button label="Should I buy this" onPress={() => router.push('/sourcing')} tone="primary" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Buy" onPress={() => router.push('/buy')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Sell" onPress={() => router.push('/sell')} />
          </View>
        </View>
        {/* ⛔ B95: "Money in" did not exist, so the fund could not receive the
            contribution D3 decided. It sits beside its opposite on purpose. */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Money in" onPress={() => router.push('/contribute')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Money out" onPress={() => router.push('/spend')} />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Items" onPress={() => router.push('/items')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Reports" onPress={() => router.push('/reports')} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Waiting" onPress={() => router.push('/watchlist')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="What blocks me" onPress={() => router.push('/rejections')} />
        </View>
      </View>
      {/* 🎯 Jason, 2026-09-11: the highest returns were online drops, not the
          clearance rack. This is the half of sourcing that is planned rather
          than encountered. */}
      <Button label="What is coming" onPress={() => router.push('/drops')} />
      <Button label="Rules and tax" onPress={() => router.push('/settings')} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Link href="/ledger" style={{ color: C.faint, paddingTop: 4 }}>
          every event →
        </Link>
        <Link href="/adjust" style={{ color: C.faint, paddingTop: 4 }}>
          the books are wrong →
        </Link>
      </View>
    </View>
  );
}

export default function Index() {
  // ⚠️ CI builds with EXPO_PUBLIC_RUN_CONTRACT=1 so the driver contract runs on
  // launch and writes its verdict. A run that needed a tap would need a UI
  // driver, and the point of that lane is to need as little as possible.
  //
  // ⛔ This check must stay ABOVE any `useFund()`, and `_layout` does not mount
  // the provider in that mode — the contract lane must not depend on the shell
  // it exists to be independent of.
  if (process.env.EXPO_PUBLIC_RUN_CONTRACT === '1') return <Contract />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 20, paddingTop: 76, paddingBottom: 48, gap: 16 }}>
        <Position />
        <Link href="/contract" style={{ color: C.faint, paddingTop: 8 }}>
          run the driver contract →
        </Link>
      </View>
    </ScrollView>
  );
}
