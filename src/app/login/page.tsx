import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  authConfigFromEnv,
  isConfigured,
  issueSession,
  passwordMatches,
} from '../../server/auth.js';

export const dynamic = 'force-dynamic';

/**
 * One field. There is one operator, so there is nothing to identify — only
 * something to prove.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; bad?: string }>;
}) {
  const params = await searchParams;
  const failed = params.bad === '1';
  const next = params.next ?? '/';

  async function submit(formData: FormData) {
    'use server';
    const config = authConfigFromEnv();
    const attempt = String(formData.get('password') ?? '');
    const target = String(formData.get('next') ?? '/');

    // ⚠️ Only ever redirect to a path on this app. Taking the raw value would
    // make the login form an open redirect.
    const safeTarget = target.startsWith('/') && !target.startsWith('//') ? target : '/';

    if (!isConfigured(config) || !passwordMatches(config, attempt)) {
      redirect(`/login?bad=1&next=${encodeURIComponent(safeTarget)}`);
    }

    const jar = await cookies();
    jar.set(SESSION_COOKIE, issueSession(config, Date.now()), {
      httpOnly: true,
      sameSite: 'strict',
      // Tailscale serves this over plain HTTP inside the mesh, so requiring
      // Secure would lock the operator out of their own dashboard.
      secure: false,
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    redirect(safeTarget);
  }

  return (
    <main className="mx-auto max-w-sm pt-24">
      <h1 className="mb-1 text-lg font-semibold">Resale OS</h1>
      <p className="mb-6 text-sm text-neutral-500">This fund is private.</p>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-neutral-100 outline-none focus:border-neutral-600"
        />
        {failed && <p className="text-sm text-red-400">That is not the password.</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-neutral-100 px-4 py-3 font-medium text-neutral-900"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
