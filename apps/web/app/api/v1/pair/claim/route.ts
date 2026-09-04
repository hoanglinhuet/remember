import { fail, json, publicRoute, readJson } from '@/lib/server/api';
import { claimPairing } from '@/lib/app/pair-extension';
import { getDb } from '@/lib/server/db';

/**
 * Extension đổi mã lấy session token. KHÔNG cần đăng nhập — lúc này extension
 * chưa có phiên nào; chính cái mã là bằng chứng người dùng đã đăng nhập ở web.
 */
export const POST = publicRoute(async (req) => {
  const body = await readJson<{ code?: unknown; label?: unknown }>(req);
  if (body instanceof Response) return body;

  const code = String(body.code ?? '').trim();
  if (!code) return fail('invalid', 'Thiếu mã kết nối', 400);

  const res = await claimPairing(
    getDb(),
    code,
    typeof body.label === 'string' ? body.label.slice(0, 60) : null,
  );
  if (!res) return fail('not_found', 'Mã không đúng hoặc đã hết hạn', 404);
  return json(res);
});

export const OPTIONS = publicRoute(async () => new Response(null, { status: 204 }));
