import { json, route } from '@/lib/server/api';

/**
 * Mọi từ đã lưu, ở dạng chuẩn hoá — extension dùng để HIGHLIGHT từ đã có thẻ ngay
 * trên trang đang đọc.
 *
 * Vì sao không dùng `/cards/list`: cái đó trả 50 thẻ gần nhất kèm đủ nghĩa, IPA,
 * deck — highlight thì cần CẢ BỘ nhưng chỉ cần đúng một cột. Vài nghìn từ ở đây là
 * vài chục KB, còn `/cards/list` cùng số thẻ sẽ là vài MB.
 *
 * Không phân trang: extension cache lại theo TTL, và một bộ từ vựng cá nhân không
 * lớn tới mức phải chia trang.
 */
export const GET = route(async (_req, { user, db }) => {
  const fronts = await db.queriesFor(user.id).savedFronts();
  return json({ fronts, count: fronts.length });
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
