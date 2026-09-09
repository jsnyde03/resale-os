/**
 * The whole visual vocabulary, in one file.
 *
 * Deliberately small. This is an operator's tool used in a shop with one hand,
 * not a product — the Gate 4 dashboard was signed off as *"a basic screen"* and
 * this is the same bar. What matters is that a number is legible at arm's
 * length and that a refusal is impossible to mistake for a success.
 */

import { Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

export const C = {
  bg: '#0a0a0a',
  card: '#161616',
  line: '#262626',
  text: '#fafafa',
  dim: '#a3a3a3',
  faint: '#737373',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
} as const;

/** Money and counts are tabular so columns line up as digits change. */
export const NUM: TextStyle = { fontVariant: ['tabular-nums'] };

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        { backgroundColor: C.card, borderRadius: 12, padding: 16, gap: 2 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({
  label,
  value,
  tone = 'normal',
  indent = false,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'good' | 'warn' | 'bad' | 'dim';
  indent?: boolean;
}) {
  const color =
    tone === 'good' ? C.good : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : tone === 'dim' ? C.dim : C.text;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingVertical: 5,
        gap: 12,
      }}
    >
      <Text style={{ color: C.dim, fontSize: 14, paddingLeft: indent ? 14 : 0, flexShrink: 1 }}>
        {label}
      </Text>
      <Text style={{ color, fontSize: 15, ...NUM }}>{value}</Text>
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: C.text, fontSize: 22, fontWeight: '600', marginBottom: 2 }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: C.faint, fontSize: 13, lineHeight: 18 }}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = 'normal',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'normal' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const bg = tone === 'primary' ? '#1d4ed8' : tone === 'danger' ? '#7f1d1d' : C.line;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // ⚠️ 48pt. This is used one-handed, standing up, holding something else.
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        borderRadius: 10,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 18,
      })}
    >
      <Text style={{ color: C.text, fontSize: 16, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}
