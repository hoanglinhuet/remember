import 'server-only';
import type { Card } from '@/lib/domain/types';
import type { Database, NewCardInput } from '@/lib/ports/db';

/**
 * USE CASE: lưu một thẻ. Đây là đường extension gọi khi bấm "＋ Lưu thẻ".
 *
 * Idempotent: `id` do client sinh ⇒ retry sau lỗi mạng không nhân đôi thẻ.
 * Ném `DuplicateCard` (lỗi miền) nếu đụng dedupe — adapter đã dịch từ mã lỗi Postgres.
 */
export async function saveCard(
  db: Database,
  userId: string,
  input: NewCardInput,
): Promise<{ card: Card; deckName: string | null }> {
  return db.uow.transaction(userId, async (repos) => {
    const decks = await repos.decks.ensureAtLeastOne();
    // Deck mặc định là deck ĐẦU TIÊN; deckId lạ thì lùi về đó thay vì tạo thẻ mồ côi.
    const deck = decks.find((d) => d.id === input.deckId) ?? decks[0]!;

    const card = await repos.cards.create(input, deck.id);
    // Thẻ mới phải có tiến độ ngay, nếu không hàng đợi không thấy nó là "thẻ mới".
    await repos.progress.initIfMissing(card.id);

    return { card, deckName: deck.name };
  });
}
