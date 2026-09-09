/**
 * Inputs, and the one rule that matters: **a half-typed number is not a
 * number.**
 *
 * ⛔ `parseDollars` throws on anything it cannot read, which is correct for a
 * command line where the whole string arrives at once. On a phone the string
 * arrives one character at a time, and `"1."` is a normal thing to be holding
 * mid-type — so these return `undefined` for "not a number yet" and let the
 * screen decide what that means. Throwing at every keystroke would be a red
 * screen between "1" and "12".
 */

import { Text, TextInput, View } from 'react-native';
import { C, NUM } from './theme.js';

// ⛔ Re-exported, not reimplemented. These live in `src/ui/forms.ts` where the
// desktop suite can assert them; a second copy here would be a second set of
// rules about what counts as a number, and only one of them would be tested.
export { centsOrNothing, countOrNothing } from '../../../src/ui/forms.js';

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType = 'default',
  autoCapitalize = 'none',
  invalid = false,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words';
  /** Something is typed and it does not parse — say so without shouting. */
  invalid?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: C.dim, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.faint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{
          color: C.text,
          backgroundColor: C.card,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: invalid ? C.bad : C.line,
          paddingHorizontal: 14,
          // ⚠️ 48pt again: this is filled in standing up, holding the thing.
          minHeight: 48,
          fontSize: 17,
          ...NUM,
        }}
      />
      {hint ? <Text style={{ color: C.faint, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}
