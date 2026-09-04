import 'server-only';
import type { Database } from '@/lib/ports/db';
import type { DeckSummary } from '@/lib/domain/types';

/**
 * USE CASE: danh sách deck kèm số liệu.
 *
 * Phải ĐẢM BẢO có deck mặc định trước khi đọc. Tầng đọc (`StudyQueries`) không ghi
 * được — đó là chủ đích của việc tách read/write — nên việc "tạo nếu chưa có" thuộc
 * use case, không thuộc query.
 *
 * Không có bước này thì user mới thấy danh sách deck rỗng và extension không có
 * deck nào để chọn.
 */
export async function listDeckSummaries(db: Database, userId: string): Promise<DeckSummary[]> {
  await db.uow.transaction(userId, (repos) => repos.decks.ensureAtLeastOne());
  return db.queriesFor(userId).deckSummaries();
}
