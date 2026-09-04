import 'server-only';
import { grade } from '@/lib/domain/fsrs';
import type { AnswerResult, Rating } from '@/lib/domain/types';
import type { Database } from '@/lib/ports/db';

/**
 * USE CASE: chấm điểm một thẻ.
 *
 * Toàn bộ nằm trong MỘT transaction (Unit of Work). Trước khi tách ra, đường này có
 * lỗi thật: tiến độ + log ghi trong transaction, còn gắn tag leech là lời gọi thứ hai
 * bên ngoài — hỏng giữa chừng thì thẻ thành leech mà không có tag.
 *
 * Server tính FSRS (ADR-26): client chỉ gửi rating, không gửi được state bịa.
 */
export async function answerCard(
  db: Database,
  userId: string,
  input: { cardId: string; rating: Rating; answeredAt?: string },
): Promise<AnswerResult | { notFound: true }> {
  const at = trustedTime(input.answeredAt);

  return db.uow.transaction(userId, async (repos) => {
    if (!(await repos.cards.exists(input.cardId))) return { notFound: true } as const;

    const config = await repos.settings.get();
    const before = await repos.progress.get(input.cardId);
    const res = grade(input.cardId, before, input.rating, config, at);

    await repos.progress.save(res.progress);
    await repos.logs.append(input.cardId, res.log);
    if (res.leech) await repos.cards.addTag(input.cardId, 'leech');

    const backInMs = res.progress.due
      ? new Date(res.progress.due).getTime() - at.getTime()
      : null;
    const comesBack =
      !res.suspended && backInMs !== null && backInMs > 0 &&
      (res.progress.state === 'learning' || res.progress.state === 'relearning' ||
        backInMs <= config.learnAheadMin * 60_000);

    return {
      progress: res.progress,
      leech: res.leech,
      suspended: res.suspended,
      backInMs: comesBack ? backInMs : null,
    } satisfies AnswerResult;
  });
}

/**
 * Không tin thời điểm client gửi nếu lệch quá 5 phút: đồng hồ máy user sai sẽ
 * làm hỏng toàn bộ lịch ôn về sau, và sai đó không tự sửa được.
 */
function trustedTime(iso?: string): Date {
  const now = new Date();
  if (!iso) return now;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return now;
  return Math.abs(t.getTime() - now.getTime()) < 5 * 60_000 ? t : now;
}
