/**
 * The driver contract, run against the implementation we have today.
 *
 * ⚠️ This file is a thin adapter on purpose. The cases live in
 * `src/db/driver-contract.ts` so the phone can bundle and run the *same* ones
 * against `expo-sqlite` — two implementations, one contract. Copying them here
 * would give two suites that agree with themselves and prove nothing about each
 * other.
 */

import { describe, expect, it } from 'vitest';
import { DRIVER_CONTRACT, CONTRACT_SCHEMA } from '@/db/driver-contract.js';
import { openDb } from '@/db/driver.js';

describe('driver contract — node:sqlite', () => {
  for (const { name, run } of DRIVER_CONTRACT) {
    it(name, () => {
      const db = openDb(':memory:');
      try {
        db.exec(CONTRACT_SCHEMA);
        // A case throws with a human-readable message on failure.
        expect(() => run(db, () => openDb(':memory:'))).not.toThrow();
      } finally {
        db.close();
      }
    });
  }
});
