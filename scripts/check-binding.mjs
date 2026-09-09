#!/usr/bin/env node
/**
 * Refuse to start a reachable server with no password.
 *
 * ⛔ "No password configured" must mean UNREACHABLE, not OPEN. The failure this
 * prevents is the ordinary one: start the server to look at something, forget
 * it is running, and leave a complete financial position on the network.
 *
 * This runs before `next dev` / `next start`, because Next has no hook that
 * fires early enough to stop a bind it has already decided to do.
 */

const args = process.argv.slice(2);

function flag(name) {
  const withEquals = args.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const hostname = flag('hostname') ?? '127.0.0.1';
const password = (process.env.RESALE_PASSWORD ?? '').trim();

if (password === '' && !LOOPBACK.has(hostname)) {
  console.error(`REFUSING TO START: binding to ${hostname} with no RESALE_PASSWORD set.`);
  console.error('');
  console.error('That would publish the whole financial position to anything that can');
  console.error('reach this host. Either:');
  console.error('  - set RESALE_PASSWORD (in .env.local) and start again, or');
  console.error('  - drop --hostname and serve 127.0.0.1 only.');
  process.exit(1);
}

if (password !== '' && password.length < 12) {
  console.error(`REFUSING TO START: RESALE_PASSWORD is ${password.length} characters.`);
  console.error('This is the only thing between a phone and the ledger. Use 12 or more.');
  process.exit(1);
}

console.log(
  password === ''
    ? 'auth: no password set — serving 127.0.0.1 only'
    : `auth: password set — gate active on ${hostname}`,
);
