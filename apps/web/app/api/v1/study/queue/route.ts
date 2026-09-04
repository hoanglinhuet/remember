import { json, route } from '@/lib/server/api';
import type { StudyQueue } from '@/lib/domain/types';

export const GET = route(async (req, { user, db }) => {
  const deckId = new URL(req.url).searchParams.get('deck');
  // MỘT lời gọi, MỘT transaction. `buildQueue` trả kèm `room` và `config` vì nó đã
  // phải đọc cả hai để cắt hàng đợi theo hạn mức — gọi `dailyRoom()`/`readConfig()`
  // riêng chỉ để lấy lại đúng dữ liệu đó là thêm 2 transaction = 8 round trip.
  const queue = await db.queriesFor(user.id).buildQueue({ deckId });
  const body: StudyQueue = queue;
  return json(body);
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
