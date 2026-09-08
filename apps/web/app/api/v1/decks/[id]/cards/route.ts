import { json, route } from '@/lib/server/api';

type Params = { id: string };

/** Id đại diện nhóm "không có deck" — thẻ mồ côi sau khi xoá deck. */
const NO_DECK = 'none';

/**
 * Thẻ trong một deck, có phân trang và tìm kiếm — màn hình quản lý thẻ.
 *
 * Khác `/cards/list` (thẻ mới nhất của mọi deck, cho popup extension): ở đây phải
 * thấy ĐỦ, kể cả thẻ đang bị treo, vì đó là màn hình để sửa và xoá.
 */
export const GET = route<Params>(async (req, { user, db, params }) => {
  const sp = new URL(req.url).searchParams;
  const rawLimit = Number(sp.get('limit') ?? 50);
  const rawOffset = Number(sp.get('offset') ?? 0);

  const page = await db.queriesFor(user.id).deckCards({
    deckId: params.id === NO_DECK ? null : params.id,
    q: sp.get('q') ?? undefined,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 200) : 50,
    offset: Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0,
  });

  return json(page);
});

export const OPTIONS = route<Params>(async () => new Response(null, { status: 204 }));
