/**
 * What a `Db` implementation must do, as DATA rather than as a test file.
 *
 * ⛔ **This is the control for the phone port, and it only works if both sides
 * run the same cases.** `node:sqlite` and `expo-sqlite` each passing their own
 * suite would prove nothing about each other — a check whose two sides come
 * from one source cannot fail, and this project has been bitten by that four
 * times. So the cases live here, once, and two thin runners execute them:
 *
 *   - `tests/driver-node.test.ts` wraps them in Vitest, against `node:sqlite`
 *   - `mobile/app/contract.tsx` runs them on a device, against `expo-sqlite`
 *
 * ⚠️ It lives in `src/` rather than `tests/` because the phone app has to
 * bundle it. It has no test-framework import for the same reason — Vitest does
 * not exist on a device.
 *
 * Every case corresponds to something `src/db` actually leans on: re-entrant
 * SAVEPOINTs, rollback leaving no partial write, integer cents that do not
 * drift, and NULL staying distinct from the empty string.
 */

import type { Db } from './db-types.js';

export interface ContractCase {
  readonly name: string;
  /** Throws on failure. The message is what a human reads. */
  readonly run: (db: Db) => void;
}

class ContractFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractFailure';
  }
}

function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new ContractFailure(`${what}: expected ${e}, got ${a}`);
}

function ok(condition: boolean, what: string): void {
  if (!condition) throw new ContractFailure(what);
}

function throws(fn: () => unknown, what: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new ContractFailure(`${what}: expected it to throw, and it did not`);
}

/** The table the cases operate on. Shaped like the ones the ledger uses. */
export const CONTRACT_SCHEMA = `
  CREATE TABLE t (
    id           INTEGER PRIMARY KEY,
    label        TEXT NULL,
    amount_cents INTEGER NOT NULL,
    flag         INTEGER NOT NULL DEFAULT 0 CHECK (flag IN (0,1))
  );
`;

interface Row {
  amount_cents: number;
  label: string | null;
  flag: number;
}

export const DRIVER_CONTRACT: readonly ContractCase[] = [
  {
    name: 'round-trips a row through run/get/all',
    run: (db) => {
      const result = db.run('INSERT INTO t (label, amount_cents, flag) VALUES (?,?,?)', [
        'first',
        1_299,
        1,
      ]);
      eq(result.changes, 1, 'changes after insert');
      const row = db.get<Row>('SELECT * FROM t WHERE label = ?', ['first']);
      eq(row?.amount_cents, 1_299, 'amount round-trip');
      eq(row?.flag, 1, 'flag round-trip');
      eq(db.all<Row>('SELECT * FROM t').length, 1, 'row count');
    },
  },
  {
    name: 'returns undefined rather than throwing when nothing matches',
    run: (db) => {
      // `policy()` and `taxTablesAcceptance()` both rely on this exact shape.
      eq(db.get('SELECT * FROM t WHERE id = ?', [999]), undefined, 'missing get');
      eq(db.all('SELECT * FROM t WHERE id = ?', [999]), [], 'missing all');
    },
  },
  {
    name: 'keeps integers exact — money is integer cents and must not drift',
    run: (db) => {
      // Values chosen because they are where float arithmetic diverges.
      const values = [29, 57, 113, 201, 1_299, 18_450_000, 9_007_199_254_740_991];
      for (const cents of values) db.run('INSERT INTO t (amount_cents) VALUES (?)', [cents]);
      const back = db
        .all<Row>('SELECT amount_cents FROM t ORDER BY id')
        .map((r) => r.amount_cents);
      eq(back, values, 'integer round-trip');
      for (const v of back) ok(Number.isInteger(v), `${v} came back as a non-integer`);
    },
  },
  {
    name: 'stores and returns a negative amount unchanged',
    run: (db) => {
      // Credits are negative raw amounts throughout the ledger.
      db.run('INSERT INTO t (amount_cents) VALUES (?)', [-5_000]);
      eq(db.get<Row>('SELECT amount_cents FROM t')?.amount_cents, -5_000, 'negative amount');
    },
  },
  {
    name: 'distinguishes NULL from the empty string',
    run: (db) => {
      // `stateRateBasis` uses null to mean "deliberately not set"; collapsing
      // it to '' would change what the record means.
      db.run('INSERT INTO t (label, amount_cents) VALUES (?,?)', [null, 0]);
      db.run('INSERT INTO t (label, amount_cents) VALUES (?,?)', ['', 0]);
      const rows = db.all<Row>('SELECT label FROM t ORDER BY id');
      eq(rows[0]?.label, null, 'null label stays null');
      eq(rows[1]?.label, '', 'empty label stays empty');
    },
  },
  {
    name: 'enforces CHECK constraints and NOT NULL',
    run: (db) => {
      throws(
        () => db.run('INSERT INTO t (amount_cents, flag) VALUES (?,?)', [0, 7]),
        'CHECK flag IN (0,1)',
      );
      throws(() => db.run('INSERT INTO t (label) VALUES (?)', ['no amount']), 'NOT NULL amount');
    },
  },
  {
    name: 'enforces PRIMARY KEY uniqueness',
    run: (db) => {
      db.run('INSERT INTO t (id, amount_cents) VALUES (?,?)', [1, 100]);
      throws(
        () => db.run('INSERT INTO t (id, amount_cents) VALUES (?,?)', [1, 200]),
        'duplicate primary key',
      );
    },
  },
  {
    name: 'commits a transaction as one unit',
    run: (db) => {
      db.transaction(() => {
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [1]);
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [2]);
      });
      eq(db.all('SELECT * FROM t').length, 2, 'both rows committed');
    },
  },
  {
    name: 'rolls back a failed transaction completely, leaving no partial write',
    run: (db) => {
      // ⛔ The single most load-bearing behaviour. `FundStore.commit` writes the
      // item, the event, the postings and the expense rows in one transaction,
      // and the guarantee is that a rejected command leaves the database
      // exactly as it was.
      db.run('INSERT INTO t (amount_cents) VALUES (?)', [1]);
      throws(
        () =>
          db.transaction(() => {
            db.run('INSERT INTO t (amount_cents) VALUES (?)', [2]);
            db.run('INSERT INTO t (amount_cents) VALUES (?)', [3]);
            throw new Error('deliberate');
          }),
        'transaction propagates the error',
      );
      eq(
        db.all<Row>('SELECT amount_cents FROM t').map((r) => r.amount_cents),
        [1],
        'only the pre-transaction row survives',
      );
    },
  },
  {
    name: 'nests transactions re-entrantly',
    run: (db) => {
      // `autoBackup` and `commit` compose, so an inner transaction must not
      // commit the outer one early or fail on a nested BEGIN.
      db.transaction(() => {
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [1]);
        db.transaction(() => {
          db.run('INSERT INTO t (amount_cents) VALUES (?)', [2]);
        });
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [3]);
      });
      eq(db.all('SELECT * FROM t').length, 3, 'all three rows committed');
    },
  },
  {
    name: 'rolls the inner savepoint back without losing the outer work',
    run: (db) => {
      db.transaction(() => {
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [1]);
        throws(
          () =>
            db.transaction(() => {
              db.run('INSERT INTO t (amount_cents) VALUES (?)', [2]);
              throw new Error('inner');
            }),
          'inner transaction propagates',
        );
        db.run('INSERT INTO t (amount_cents) VALUES (?)', [3]);
      });
      eq(
        db.all<Row>('SELECT amount_cents FROM t ORDER BY id').map((r) => r.amount_cents),
        [1, 3],
        'outer work survives, inner is gone',
      );
    },
  },
  {
    name: 'returns the value the transaction produced',
    run: (db) => {
      eq(db.transaction(() => 42), 42, 'transaction return value');
    },
  },
  {
    name: 'runs multi-statement exec, which every migration needs',
    run: (db) => {
      db.exec(`
        CREATE TABLE a (x INTEGER);
        CREATE TABLE b (y INTEGER);
        INSERT INTO a (x) VALUES (1);
      `);
      eq(db.all('SELECT * FROM a').length, 1, 'first statement ran');
      eq(db.all('SELECT * FROM b'), [], 'second statement ran');
    },
  },
  {
    name: 'supports the PRAGMAs the schema depends on',
    run: (db) => {
      db.exec('PRAGMA foreign_keys = ON');
      eq(db.all('PRAGMA foreign_key_check'), [], 'foreign_key_check is clean');
      eq(db.all('PRAGMA integrity_check').length, 1, 'integrity_check returns a row');
    },
  },
  {
    name: 'enforces foreign keys when they are on',
    run: (db) => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER REFERENCES t(id))');
      throws(() => db.run('INSERT INTO child (t_id) VALUES (?)', [999]), 'foreign key violation');
    },
  },
  {
    name: 'reports changes accurately for update and delete',
    run: (db) => {
      for (const c of [1, 2, 3]) db.run('INSERT INTO t (amount_cents) VALUES (?)', [c]);
      eq(db.run('UPDATE t SET flag = 1 WHERE amount_cents > ?', [1]).changes, 2, 'update changes');
      eq(db.run('DELETE FROM t WHERE flag = ?', [1]).changes, 2, 'delete changes');
      eq(db.run('DELETE FROM t WHERE amount_cents = ?', [99]).changes, 0, 'no-op delete changes');
    },
  },
];

export interface CaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: string;
}

/**
 * Run every case against a driver, each on a fresh database.
 *
 * `open` must hand back an empty database each time — a case that leaked state
 * into the next would make the suite order-dependent, which is the one thing a
 * control must not be.
 */
export function runDriverContract(open: () => Db): CaseResult[] {
  return DRIVER_CONTRACT.map(({ name, run }) => {
    const db = open();
    try {
      db.exec(CONTRACT_SCHEMA);
      run(db);
      return { name, passed: true };
    } catch (err) {
      return { name, passed: false, error: (err as Error).message };
    } finally {
      try {
        db.close();
      } catch {
        // A close failure must not mask the case's own result.
      }
    }
  });
}
