import { redirect } from 'next/navigation';
import { signIn, SignInError } from '@/lib/auth';
import { Button, Notice } from '@/components/atoms';

/**
 * The sign-in surface.
 *
 * One card, one action, no chrome — the product's seriousness starts here. It lives outside the
 * `(app)` group, so nothing on this page has ever been near a session.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  async function attempt(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '/');

    try {
      await signIn(email, password);
    } catch (error) {
      const reason = error instanceof SignInError ? error.reason : 'credentials';
      redirect(`/sign-in?error=${reason}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);
    }
    redirect(next);
  }

  const message = {
    credentials: 'That email and password do not match an account.',
    unavailable: 'The identity service could not be reached. Try again in a moment.',
    'not-configured': 'Sign-in is not configured for this deployment.',
  }[params.error ?? ''];

  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <div className="flex w-full max-w-[372px] flex-col gap-4">
        <div className="font-mono text-base font-semibold tracking-[-0.01em]">maestro</div>

        {message ? (
          <Notice tone="hard" title="Sign-in failed">
            {message}
          </Notice>
        ) : null}

        <form action={attempt} className="flex flex-col gap-2.5">
          <input type="hidden" name="next" value={params.next ?? '/'} />
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="you@example.com"
            aria-label="Email"
            className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm text-ink"
          />
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm text-ink"
          />
          <Button type="submit" variant="primary" className="py-2">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
