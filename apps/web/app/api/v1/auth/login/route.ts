import { redirect } from 'next/navigation';
import { authorizeUrl, newPkce, newState } from '@/lib/server/auth/google';
import { getDb } from '@/lib/server/db';
import { isConfigured, originOf } from '@/lib/server/env';

/**
 * Bắt đầu đăng nhập Google. Không qua nhà cung cấp auth nào — app tự làm OAuth.
 * State + code_verifier lưu ở DB (bảng oauth_states), sống 10 phút, dùng một lần.
 */
export async function GET(req: Request) {
  const origin = originOf(req);
  if (!isConfigured) redirect('/login?e=not_configured');

  const url = new URL(req.url);
  const rawNext = url.searchParams.get('next');
  const nextPath = rawNext?.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const state = newState();
  const { verifier, challenge } = newPkce();
  await getDb().identity.saveOAuthState({ state, codeVerifier: verifier, nextPath, ttlMs: 10 * 60_000 });

  redirect(authorizeUrl({
    redirectUri: `${origin}/api/v1/auth/callback`,
    state,
    challenge,
  }));
}
