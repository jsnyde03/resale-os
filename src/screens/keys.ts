/**
 * The vendor keys: one place that says where they come from, and what is true
 * about them.
 *
 * ⛔ **They are NOT secret, and the app must stop implying otherwise.** Expo
 * inlines every `EXPO_PUBLIC_*` variable into the client bundle in plain text —
 * its own documentation says *"do not store sensitive info... these variables
 * will be visible in plain-text in your compiled application"*. So both keys
 * ship inside the `.ipa`. For a single-operator TestFlight build the blast
 * radius is one person's own binary, but the property is real and the wording
 * downstream has to match it.
 *
 * ⛔ **Which is why a key cannot be fixed on the device.** It is baked at build
 * time, so a refused key means a rebuild — and the failure message used to say
 * *"check it in Settings"*, advice no one could follow because there is no such
 * field. A screen that tells the operator to do an impossible thing is worse
 * than one that says nothing.
 *
 * ⚠️ **Storing them in `config` instead would be a DOWNGRADE, not a fix.**
 * `portable.ts` exports config wholesale — `SELECT key, value_json FROM config`,
 * no whitelist — so a key placed there travels in every backup and every
 * export, which are files that leave the phone. Giving a key a home the
 * operator can edit is therefore a storage decision, not a text field. Deferred
 * deliberately; see the backlog.
 *
 * Pure. The environment is read by the phone and passed in — nothing here
 * touches `process.env`, so this is testable where there is no bundler.
 */

/** A vendor the fund depends on, and the variable that carries its key. */
export interface VendorKey {
  readonly id: 'soldcomps' | 'upcitemdb';
  /** What it is called in the operator's language. */
  readonly label: string;
  /** The build-time variable. Named here so one file knows the string. */
  readonly envVar: string;
  /** What stops working without it. */
  readonly without: string;
}

export const VENDOR_KEYS: readonly VendorKey[] = [
  {
    id: 'soldcomps',
    label: 'Market data',
    envVar: 'EXPO_PUBLIC_SOLDCOMPS_KEY',
    // ⛔ D16: this is the ONLY automated route the fund has. Without it every
    // count and every comp is typed by hand.
    without: 'sold counts and comps are typed by hand',
  },
  {
    id: 'upcitemdb',
    label: 'Barcode lookup',
    envVar: 'EXPO_PUBLIC_UPCITEMDB_KEY',
    // ⚠️ The trial tier needs no key at all, so absence here is NORMAL and
    // must not be reported as a fault.
    without: 'scanning falls back to the keyless trial tier',
  },
];

export interface KeyStatus {
  readonly id: VendorKey['id'];
  readonly label: string;
  readonly envVar: string;
  readonly present: boolean;
  /** One line, true whether or not the key is there. */
  readonly detail: string;
}

/**
 * ⚠️ **Trimmed, because an empty-looking variable is an absent one.** A build
 * that sets `EXPO_PUBLIC_SOLDCOMPS_KEY=""` or to a stray space produces a key
 * the adapter would send and the vendor would refuse — reported as an AUTH
 * failure mid-decision rather than as "no key", which sends the operator
 * looking for the wrong problem.
 */
export function keyStatus(vendor: VendorKey, raw: string | undefined): KeyStatus {
  const present = (raw ?? '').trim() !== '';
  return {
    id: vendor.id,
    label: vendor.label,
    envVar: vendor.envVar,
    present,
    detail: present
      ? `Set in this build. Baked in at build time, so it cannot be changed here.`
      : `Not in this build — ${vendor.without}.`,
  };
}

export function keysStatus(values: Readonly<Record<string, string | undefined>>): KeyStatus[] {
  return VENDOR_KEYS.map((v) => keyStatus(v, values[v.id]));
}
