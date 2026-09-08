import { fail, json, readJson, route } from '@/lib/server/api';
import { deleteDeck, renameDeck, type DeckDeleteMode } from '@/lib/app/manage-deck';

type Params = { id: string };

/** Đổi tên deck. */
export const PATCH = route<Params>(async (req, { user, db, params }) => {
  const body = await readJson<{ name?: unknown }>(req);
  if (body instanceof Response) return body;

  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return fail('invalid', 'Tên deck không được để trống', 400);
  if (name.length > 60) return fail('invalid', 'Tên deck tối đa 60 ký tự', 400);

  const r = await renameDeck(db, user.id, params.id, name);
  if ('error' in r) {
    return r.error === 'not_found'
      ? fail('not_found', 'Không tìm thấy deck', 404)
      : fail('duplicate', `Đã có deck tên "${name}"`, 409);
  }
  return json({ deck: r.deck });
});

/**
 * Xoá deck. `?cards=move` (mặc định) dồn thẻ sang deck khác, `?cards=delete` xoá
 * luôn thẻ. Mặc định là phương án KHÔNG mất dữ liệu — xem `deleteDeck()`.
 */
export const DELETE = route<Params>(async (req, { user, db, params }) => {
  const raw = new URL(req.url).searchParams.get('cards') ?? 'move';
  if (raw !== 'move' && raw !== 'delete') {
    return fail('invalid', 'cards phải là move hoặc delete', 400);
  }

  const r = await deleteDeck(db, user.id, params.id, raw as DeckDeleteMode);
  if (!r) return fail('not_found', 'Không tìm thấy deck', 404);
  return json({ cards: r.cards, movedTo: r.movedTo });
});

export const OPTIONS = route<Params>(async () => new Response(null, { status: 204 }));
