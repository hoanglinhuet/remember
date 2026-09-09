import 'server-only';
import type { Database } from '@/lib/ports/db';
import { TTL_MS } from '@/lib/server/auth/session';

/** Mã sống ngắn: đủ để copy-paste, không đủ để rò rỉ rồi dùng sau. */
const CODE_TTL_MS = 10 * 60_000;

/**
 * USE CASE: web tạo mã ghép nối cho extension.
 *
 * Một tài khoản chỉ giữ một mã đang chờ (adapter xoá mã cũ khi tạo mã mới), nên
 * bấm "tạo mã" lần nữa là mã trước hết tác dụng.
 */
export async function createPairing(db: Database, userId: string, label: string) {
  const { code, expiresAt } = await db.identity.createPairingCode({
    userId,
    ttlMs: CODE_TTL_MS,
    label,
  });
  return { code, expiresAt: expiresAt.toISOString(), ttlMinutes: CODE_TTL_MS / 60_000 };
}

/**
 * USE CASE: extension đổi mã lấy session của riêng nó (`kind: 'extension'`).
 *
 * Mã dùng MỘT lần — adapter xoá khi đổi. Session của extension độc lập với phiên
 * web, nên thu hồi được riêng mà không làm người dùng bị đăng xuất khỏi web.
 */
export async function claimPairing(db: Database, code: string, label: string | null) {
  const userId = await db.identity.claimPairingCode(code);
  if (!userId) return null;

  const session = await db.identity.createSession({
    userId,
    ttlMs: TTL_MS,
    userAgent: label,
    kind: 'extension',
  });
  const user = await db.identity.getUser(userId);

  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    // `id` là thứ extension dùng để gắn cache vào đúng tài khoản (xem `cacheScope()`
    // ở extension/src/background/sync.js). Thiếu nó thì extension chỉ biết "đã kết
    // nối" mà không biết với AI, và cache của tài khoản cũ sẽ trôi sang tài khoản mới.
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
  };
}
