import { fail, json, route } from '@/lib/server/api';

/**
 * Thẻ đã có của một từ — client gọi ngay sau khi tra từ, để hiện "đã lưu" trên
 * từng nghĩa mà không cần người dùng bấm Lưu rồi mới biết bị trùng.
 */
export const GET = route(async (req, { user, db }) => {
  const q = new URL(req.url).searchParams;
  const front = (q.get('front') ?? '').trim();
  if (!front) return fail('invalid', 'Thiếu tham số front', 400);

  const cards = await db.queriesFor(user.id).cardsByFront(
    front,
    q.get('langFrom') || 'auto',
    q.get('langTo') || 'vi',
  );
  return json({ cards });
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
