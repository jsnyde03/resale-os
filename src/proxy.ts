/**
 * The optimistic redirect. NOT the security boundary.
 *
 * ⛔ The real gate is in `withStore()` — the one door to the ledger — because
 * Next's own guidance is explicit that proxy "should not be used as a full
 * session management or authorization solution", and because a routing check
 * is default-open: it protects the paths someone remembered to match. Gating
 * the DATA means a screen that forgets to check cannot leak anything, since it
 * cannot read anything.
 *
 * So this file exists purely so an expired session lands on the login form
 * instead of an error. It runs in the Edge runtime and deliberately does no
 * crypto: it asks only whether a cookie is present, which is a question about
 * user experience rather than about trust.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'resale_session';

function isPublicPath(pathname: string): boolean {
  if (pathname.includes('..')) return false;
  return pathname === '/login' || pathname.startsWith('/_next/') || pathname === '/favicon.ico';
}

export function proxy(request: NextRequest) {
  // No password configured means the process is bound to loopback (enforced at
  // startup by scripts/check-binding.mjs), so there is nothing to redirect.
  if ((process.env.RESALE_PASSWORD ?? '').trim() === '') return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
