import 'server-only';
import type { Deck } from '@/lib/domain/types';
import type { Database } from '@/lib/ports/db';

/** USE CASE: tạo deck. Trùng tên thì trả deck cũ — người dùng muốn "vào deck tên X". */
export async function createDeck(
  db: Database,
  userId: string,
  name: string,
): Promise<{ deck: Deck; existed: boolean }> {
  return db.uow.transaction(userId, async (repos) => {
    const decks = await repos.decks.ensureAtLeastOne();
    const existing = decks.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (existing) return { deck: existing, existed: true };
    return { deck: await repos.decks.create(name, decks.length), existed: false };
  });
}

/** Danh sách deck, đảm bảo luôn có ít nhất một. */
export function listDecks(db: Database, userId: string): Promise<Deck[]> {
  return db.uow.transaction(userId, (repos) => repos.decks.ensureAtLeastOne());
}

/**
 * USE CASE: đổi tên deck.
 *
 * Trùng tên là LỖI ở đây, khác với `createDeck` (ở đó trùng tên nghĩa là "mở deck
 * sẵn có"). Đổi tên deck A thành tên deck B mà im lặng gộp lại thì người dùng mất
 * một deck mà không hề được hỏi.
 */
export async function renameDeck(
  db: Database,
  userId: string,
  deckId: string,
  name: string,
): Promise<{ deck: Deck } | { error: 'not_found' | 'duplicate' }> {
  return db.uow.transaction(userId, async (repos) => {
    const decks = await repos.decks.list();
    if (!decks.some((d) => d.id === deckId)) return { error: 'not_found' as const };
    const clash = decks.some(
      (d) => d.id !== deckId && d.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) return { error: 'duplicate' as const };

    const deck = await repos.decks.rename(deckId, name);
    return deck ? { deck } : { error: 'not_found' as const };
  });
}

/** Thẻ trong deck bị xoá đi đâu: dồn sang deck khác, hay xoá luôn. */
export type DeckDeleteMode = 'move' | 'delete';

export interface DeckDeleted {
  /** Số thẻ bị chuyển hoặc bị xoá. */
  cards: number;
  /** Deck nhận thẻ khi `mode = 'move'`; null nghĩa là thẻ thành "không có deck". */
  movedTo: Deck | null;
}

/**
 * USE CASE: xoá deck.
 *
 * Xoá deck KHÔNG được ngầm xoá thẻ: thẻ mang theo cả tiến độ FSRS và lịch sử ôn,
 * mất chúng thì không dựng lại được. Nên người gọi phải nói rõ muốn gì, và mặc
 * định (`move`) là phương án không mất dữ liệu.
 *
 * Cả hai việc nằm trong MỘT transaction: nếu xoá deck xong mà chuyển thẻ hỏng thì
 * thẻ trỏ vào một deck không còn tồn tại.
 */
export async function deleteDeck(
  db: Database,
  userId: string,
  deckId: string,
  mode: DeckDeleteMode,
): Promise<DeckDeleted | null> {
  return db.uow.transaction(userId, async (repos) => {
    const decks = await repos.decks.list();
    if (!decks.some((d) => d.id === deckId)) return null;

    // Deck nhận thẻ là deck kế tiếp theo thứ tự hiển thị. Xoá deck CUỐI CÙNG thì
    // không còn chỗ nào để dồn — thẻ về nhóm "không có deck", và lần đọc sau
    // `ensureAtLeastOne()` sẽ dựng lại một deck mặc định rỗng.
    const movedTo = mode === 'move' ? (decks.find((d) => d.id !== deckId) ?? null) : null;

    const cards = mode === 'delete'
      ? await repos.cards.softDeleteAllInDeck(deckId)
      : await repos.cards.moveAll(deckId, movedTo?.id ?? null);

    await repos.decks.softDelete(deckId);
    return { cards, movedTo };
  });
}
