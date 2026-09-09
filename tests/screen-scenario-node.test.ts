/**
 * The screen scenario against `node:sqlite`.
 *
 * The same cases run on the device against `expo-sqlite` in the iOS lane. Two
 * runners, one set of cases — a copied suite would agree with itself.
 */

import { describe, expect, it } from 'vitest';
import { SCREEN_SCENARIO } from '@/db/screen-scenario.js';
import { openDb } from '@/db/driver.js';

describe('screen scenario — node:sqlite', () => {
  for (const scenarioCase of SCREEN_SCENARIO) {
    it(scenarioCase.name, () => {
      const db = openDb(':memory:');
      try {
        expect(() => scenarioCase.run(db, () => openDb(':memory:'))).not.toThrow();
      } finally {
        db.close();
      }
    });
  }
});
