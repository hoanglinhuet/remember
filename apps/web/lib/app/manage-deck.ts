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
