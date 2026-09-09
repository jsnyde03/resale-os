import { Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { FundProvider } from '../src/fund/FundProvider.js';
import { Button, C, H1, Muted } from '../src/ui/theme.js';

/**
 * ⛔ **The provider is skipped when the contract lane is running.**
 *
 * Under `EXPO_PUBLIC_RUN_CONTRACT=1` the app exists to run the driver contract
 * against `:memory:` and write a verdict. Opening the real ledger here would
 * put the app shell — migrations, seeding, a store — *upstream* of the thing
 * under test, so a shell bug would surface as "no result file", which is the
 * lane's word for "the app never ran". Those are different failures and the
 * lane exists to keep them apart.
 */
const RUNNING_CONTRACT = process.env.EXPO_PUBLIC_RUN_CONTRACT === '1';

function LedgerWontOpen({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 24, paddingTop: 88, gap: 16 }}>
        <H1>The ledger did not open</H1>
        <Muted>
          Nothing has been changed. The fund is whatever it was the last time it was written, and
          the file is still on this device.
        </Muted>
        <Text selectable style={{ color: C.bad, fontSize: 13, lineHeight: 19 }}>
          {error.message}
        </Text>
        <Button label="Try again" onPress={retry} />
      </View>
    </ScrollView>
  );
}

export default function RootLayout() {
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  if (RUNNING_CONTRACT) return stack;
  return (
    <FundProvider fallback={(error, retry) => <LedgerWontOpen error={error} retry={retry} />}>
      {stack}
    </FundProvider>
  );
}
