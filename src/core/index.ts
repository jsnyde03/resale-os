/**
 * The public surface of the deterministic financial core.
 *
 * Everything below this line is pure: no I/O, no clock, no randomness, no LLM.
 * Layers above (db, server, cli) may import from here. This module imports
 * nothing from them.
 */

export * from './math.js';
export * from './money.js';
export * from './fees.js';
export * from './velocity.js';
export * from './ledger/accounts.js';
export * from './ledger/types.js';
export * from './ledger/invariants.js';
export * from './capital/policy.js';
export * from './capital/tax.js';
export * from './tax/tables.js';
export * from './tax/profile.js';
export * from './tax/annual.js';
export * from './capital/state.js';
export * from './capital/commands.js';
export * from './capital/metrics.js';
export * from './capital/reachability.js';
export * from './capital/engine.js';
export * from './capital/constraints.js';
