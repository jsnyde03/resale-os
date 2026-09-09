const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// The engine lives in ../src and is imported unchanged. Metro has to be told
// the file tree extends beyond this package.
config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

// ⛔ The repo writes `import ... from './x.js'` for TypeScript sources — the
// Node ESM convention it was built with. Metro does not resolve that by
// default, exactly as Turbopack did not (Gate 4, B38). Teaching the bundler is
// the cheap side of the trade; rewriting the extension off every import in a
// financial core to suit a bundler is not.
// ⚠️ Kept for a web build, which is NOT a target. It was an attempt to execute
// the driver contract on a Windows machine with no iOS simulator, and it does
// not work: expo-sqlite's web backend is wa-sqlite, whose SYNCHRONOUS API runs
// through a worker and `Atomics.wait`, and it dies with "Sync operation
// timeout". Native iOS/Android sync is a direct JSI call and has no such
// worker, so the failure is specific to web. Left in place so nobody spends the
// afternoon rediscovering it.
if (!config.resolver.assetExts.includes('wasm')) config.resolver.assetExts.push('wasm');

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const asTs = moduleName.slice(0, -3);
    try {
      return context.resolveRequest(context, asTs, platform);
    } catch {
      // Fall through: it really was a .js file.
    }
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
