import { redirect } from 'next/navigation';
import { exchangeCode } from '@/lib/server/auth/google';
import { startSession } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { originOf } from '@/lib/server/env';

/**
 * Google gọi thẳng về đây — không qua domain trung gian nào.
 * URL này phải khai ở Google Cloud Console → Authorized redirect URIs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = originOf(req);
  const err = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (err) redirect(`/login?e=${encodeURIComponent(err)}`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) redirect('/login?e=missing_code');

  const db = getDb();
  // State dùng MỘT lần: takeOAuthState vừa lấy vừa xoá. Thiếu bước này thì
  // một link callback cũ có thể bị phát lại.
  const saved = await db.identity.takeOAuthState(state);
  if (!saved) redirect('/login?e=state_expired');

  let userId: string;
  let nextPath: string;
  try {
    const profile = await exchangeCode({
      code: code!,
      redirectUri: `${origin}/api/v1/auth/callback`,
      verifier: saved.codeVerifier,
    });
    // Email chưa xác minh thì không dùng để nối tài khoản — tránh chiếm tài khoản
    // bằng cách đăng ký email của người khác ở một provider dễ dãi.
    const user = await db.identity.upsertOAuthUser({
      provider: 'google',
      providerUid: profile.sub,
      email: profile.emailVerified ? profile.email : null,
      name: profile.name,
      avatarUrl: profile.picture,
    });
    userId = user.id;
    nextPath = saved.nextPath;
  } catch (e) {
    console.error('[auth] google callback', e);
    redirect(`/login?e=${encodeURIComponent((e as Error).message ?? 'oauth_failed')}`);
  }

  await startSession(userId, req.headers.get('user-agent'));
  redirect(nextPath);
}
