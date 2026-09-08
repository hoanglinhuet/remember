import { fail, json, readJson, route } from '@/lib/server/api';
import { readCardPatch } from '@/lib/server/card-input';
import { deleteCard, updateCard } from '@/lib/app/manage-card';
import { DuplicateCard } from '@/lib/ports/db';

type Params = { id: string };

/** Sửa thẻ. Chỉ những field có mặt trong body bị ghi — xem `readCardPatch()`. */
export const PATCH = route<Params>(async (req, { user, db, params }) => {
  const body = await readJson<Record<string, unknown>>(req);
  if (body instanceof Response) return body;

  const patch = readCardPatch(body);
  if (patch instanceof Response) return patch;
  if (!Object.keys(patch).length) return fail('invalid', 'Không có gì để sửa', 400);

  try {
    const card = await updateCard(db, user.id, params.id, patch);
    if (!card) return fail('not_found', 'Không tìm thấy thẻ', 404);
    return json({ card });
  } catch (e) {
    // Bản sửa đụng một thẻ khác theo khoá dedupe (từ + loại từ + nghĩa + ngôn ngữ).
    if (e instanceof DuplicateCard) {
      return fail('duplicate', 'Đã có thẻ y hệt', 409, {
        cardId: e.cardId,
        deckName: e.deckName,
      });
    }
    throw e;
  }
});

export const DELETE = route<Params>(async (_req, { user, db, params }) => {
  const ok = await deleteCard(db, user.id, params.id);
  return ok ? json({ deleted: true }) : fail('not_found', 'Không tìm thấy thẻ', 404);
});

export const OPTIONS = route<Params>(async () => new Response(null, { status: 204 }));
