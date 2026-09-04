import 'server-only';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/server/db';
import { hasDb } from '@/lib/server/env';
import type { User } from '@/lib/ports/db';

/**
 * Phiên đăng nhập của CHÍNH app này — không liên quan tới nhà cung cấp nào.
 *
 * Token đục (opaque) trong cookie httpOnly, chỉ hash SHA-256 nằm trong DB.
 * Vì sao không JWT: lợi thế của JWT là xác thực không cần chạm DB, nhưng mọi request
 * ở đây đều chạm DB rồi ⇒ đổi lấy thu hồi tức thì và không phải quản lý khoá ký.
 */

export const COOKIE = 'remember_session';
export const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

export async function startSession(userId: string, userAgent: string | null): Promise<void> {
  const s = await getDb().identity.createSession({ userId, ttlMs: TTL_MS, userAgent, kind: 'web' });
  const jar = await cookies();
  jar.set(COOKIE, s.token, {
    httpOnly: true,      // JS trong trang không đọc được ⇒ XSS không lấy được phiên
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',     // 'lax' để cookie còn gửi khi Google redirect quay về
    path: '/',
    expires: s.expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().identity.destroySession(token);
  jar.delete(COOKIE);
}

/** Người dùng của request hiện tại, hoặc null. Dùng trong Server Component và route handler. */
export async function currentUser(): Promise<User | null> {
  if (!hasDb) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    return await getDb().identity.resolveSession(token);
  } catch {
    // DB chết thì coi như chưa đăng nhập, đừng để cả trang vỡ bằng stack trace.
    return null;
  }
}

/** Bearer token cho extension — cookie không gửi được từ origin chrome-extension://. */
export async function userFromBearer(header: string | null): Promise<User | null> {
  if (!hasDb || !header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    return await getDb().identity.resolveSession(token);
  } catch {
    return null;
  }
}

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
