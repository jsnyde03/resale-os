/**
 * The gate. One operator, one password, and no cleverness.
 *
 * ⛔ **There is no loopback exemption, and adding one would be a hole.** A
 * tunnel — Tailscale, Cloudflare, anything — terminates on this machine and
 * forwards to 127.0.0.1, so a remote request arrives looking exactly like a
 * local one. "Skip auth for localhost" reads as a convenience and is in fact
 * "skip auth for everyone who came through the tunnel". Every request is
 * checked, whatever it claims about where it came from.
 *
 * ⛔ **And no password means the app must not be reachable at all**, rather than
 * meaning "open". A default-open gate is the failure mode where someone starts
 * the server to look at something, forgets, and leaves a ledger on the network.
 *
 * The threat being defended against is narrow and worth stating: a single
 * operator's private financial position, reachable from their own phone over a
 * private mesh (A4, Tailscale, 2026-09-08). Not multi-user, not the public
 * internet. What matters is that the surface is read-only by type
 * (`LedgerReader`), so the worst case is disclosure and never loss.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'resale_session';

/** Long enough that a phone is not re-entering a password in a shop. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface AuthConfig {
  /** Absent when unset or blank — an empty password is not a password. */
  readonly password?: string;
  readonly secret: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Read the gate's configuration from the environment.
 *
 * The signing secret defaults to being derived from the password. That is
 * deliberate: a separate secret nobody sets is a secret with a known value, and
 * one required variable is likelier to be set correctly than two.
 */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const raw = (env.RESALE_PASSWORD ?? '').trim();
  const password = raw === '' ? undefined : raw;
  const secret = (env.RESALE_SESSION_SECRET ?? '').trim() || `derived:${raw}`;
  return password === undefined ? { secret } : { password, secret };
}

export function isConfigured(config: AuthConfig): boolean {
  return config.password !== undefined;
}

/**
 * Whether this host may be served given the configuration.
 *
 * ⚠️ Called at startup, not per request: the answer is about how the process
 * was launched. With no password the only permitted binding is loopback.
 */
export function bindingIsAllowed(config: AuthConfig, hostname: string): boolean {
  if (isConfigured(config)) return true;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
export function passwordMatches(config: AuthConfig, attempt: string): boolean {
  if (config.password === undefined) return false;
  const expected = Buffer.from(config.password, 'utf8');
  const actual = Buffer.from(attempt, 'utf8');
  if (expected.length !== actual.length) {
    // Still burn a comparison so a wrong LENGTH is not faster than a wrong
    // password. The lengths themselves are not secret; the timing is.
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, actual);
}

interface TokenParts {
  readonly expiresAt: number;
  readonly nonce: string;
  readonly signature: string;
}

function sign(config: AuthConfig, payload: string): string {
  return createHmac('sha256', config.secret).update(payload).digest('hex');
}

/**
 * A session token is `expiry.nonce.signature`. It carries no identity because
 * there is only one operator, and no state because there is nowhere to keep it
 * that survives a dev-server restart.
 */
export function issueSession(config: AuthConfig, nowMs: number): string {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const nonce = randomBytes(12).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${sign(config, payload)}`;
}

function parse(token: string): TokenParts | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawExpiry, nonce, signature] = parts as [string, string, string];
  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
  if (nonce === '' || signature === '') return null;
  return { expiresAt, nonce, signature };
}

export function sessionIsValid(config: AuthConfig, token: string | undefined, nowMs: number): boolean {
  // An unconfigured gate validates nothing. Combined with `bindingIsAllowed`,
  // that means loopback-only rather than open.
  if (!isConfigured(config) || token === undefined || token === '') return false;
  const parsed = parse(token);
  if (parsed === null) return false;
  if (parsed.expiresAt * 1000 <= nowMs) return false;

  const expected = sign(config, `${parsed.expiresAt}.${parsed.nonce}`);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Paths that must work before a session exists, and nothing else.
 *
 * ⚠️ A dot segment disqualifies a path outright. Next normalises URLs before
 * the middleware sees them, so `/_next/../` should never arrive — but a prefix
 * check that trusts that is one upstream change away from being an open door,
 * and the check is one comparison.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname.includes('..')) return false;
  return pathname === '/login' || pathname.startsWith('/_next/') || pathname === '/favicon.ico';
}
