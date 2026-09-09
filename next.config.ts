import type { NextConfig } from 'next';

/**
 * The dashboard is a read-only view of a local SQLite ledger. Two things follow.
 *
 * `node:sqlite` must not be bundled — it is a Node builtin the bundler has no
 * business rewriting, and `src/db/driver.ts` is the only file that imports it.
 *
 * Nothing here is a financial setting. If a number needs changing, it changes in
 * `src/core`, and this file never learns about it.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ['node:sqlite'],

  /**
   * ⛔ Point Next at the WEB tsconfig, or it edits the root one.
   * It rewrote `tsconfig.json` on the first build — adding `jsx`, `allowJs`
   * and its own plugin — which is exactly the split this project keeps: the
   * node half must never compile against a browser lib.
   */
  typescript: { tsconfigPath: 'tsconfig.web.json' },

  /**
   * ⛔ `next dev` appends a block to CLAUDE.md and re-adds it on every run.
   * CLAUDE.md is this project's start-here document, hand-curated, and the
   * point of truth a new session reads first. A build tool does not get to
   * write to it.
   */
  agentRules: false,
  typedRoutes: true,

  /**
   * The rest of the repo writes `import ... from './x.js'` for TypeScript
   * sources — the Node ESM convention it was built with. Bundlers do not
   * resolve that by default.
   *
   * Teaching the bundler is the cheap side of this trade. The alternative was
   * rewriting the extension off every import in a financial codebase to suit a
   * dashboard, which is a lot of churn in files that have nothing to do with
   * the dashboard.
   */
  // ⚠️ MEASURED: Turbopack does NOT honour `extensionAlias`, so it cannot
  // resolve this repo's `.js`-for-`.ts` imports and `next dev` 500s on every
  // page. webpack does. That is why both `dev` and `build` pass `--webpack`.
  // Revisit when Turbopack supports it (backlog B38).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
