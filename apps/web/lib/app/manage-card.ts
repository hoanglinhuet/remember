import 'server-only';
import type { Card } from '@/lib/domain/types';
import type { CardPatch, Database } from '@/lib/ports/db';

/**
 * USE CASE: sửa một thẻ.
 *
 * Chỉ những field CÓ MẶT trong patch bị ghi; `null` là xoá giá trị, `undefined` là
 * không đụng tới. Đổi `deckId` sang deck lạ thì lùi về deck hiện tại thay vì tạo
 * thẻ mồ côi — cùng quy tắc với `saveCard()`.
 *
 * Ném `DuplicateCard` nếu bản sửa đụng một thẻ khác theo khoá dedupe (từ + loại từ
 * + bộ nghĩa + cặp ngôn ngữ), vì lúc đó hai thẻ sẽ không phân biệt được nữa.
 */
export async function updateCard(
  db: Database,
  userId: string,
  cardId: string,
  patch: CardPatch,
): Promise<Card | null> {
  return db.uow.transaction(userId, async (repos) => {
    const current = await repos.cards.get(cardId);
    if (!current) return null;

    let deckId = patch.deckId;
    if (deckId !== undefined && deckId !== null) {
      const decks = await repos.decks.list();
      if (!decks.some((d) => d.id === deckId)) deckId = current.deckId;
    }

    return repos.cards.update(cardId, { ...patch, ...(deckId !== undefined ? { deckId } : {}) });
  });
}

/**
 * USE CASE: xoá một thẻ. Xoá MỀM — xem `CardRepository.softDelete()` để biết vì sao
 * (giữ lịch sử ôn, và không chặn việc lưu lại đúng từ đó sau này).
 */
export function deleteCard(db: Database, userId: string, cardId: string): Promise<boolean> {
  return db.uow.transaction(userId, (repos) => repos.cards.softDelete(cardId));
}
