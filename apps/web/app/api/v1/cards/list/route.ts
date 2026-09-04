import { json, route } from '@/lib/server/api';

/**
 * Danh sách thẻ gần nhất — popup extension dùng để hiển thị thay vì đọc bản local.
 * Giới hạn cứng để một extension lỗi không kéo cả bộ thẻ về.
 */
export const GET = route(async (req, { user, db }) => {
  const raw = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 100) : 50;
  return json({ cards: await db.queriesFor(user.id).recentCards(limit) });
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
