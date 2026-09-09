/**
 * The engine scenario against node:sqlite — the baseline half.
 *
 * The same cases run on a device against expo-sqlite via the CI lane. Thin
 * adapter on purpose; the cases live in `src/db/engine-scenario.ts` so both
 * sides execute the identical array.
 */

import { describe, expect, it } from 'vitest';
import { ENGINE_SCENARIO } from '@/db/engine-scenario.js';
import { openDb } from '@/db/driver.js';

describe('engine scenario — node:sqlite', () => {
  for (const { name, run } of ENGINE_SCENARIO) {
    it(name, () => {
      const db = openDb(':memory:');
      try {
        expect(() => run(db, () => openDb(':memory:'))).not.toThrow();
      } finally {
        db.close();
      }
    });
  }
});
