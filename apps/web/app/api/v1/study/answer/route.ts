import { fail, json, readJson, route } from '@/lib/server/api';
import { answerCard } from '@/lib/app/answer-card';
import type { Rating } from '@/lib/domain/types';

/** Mỏng có chủ ý: parse, gọi use case, map sang HTTP. Nghiệp vụ ở `lib/app/answer-card.ts`. */
export const POST = route(async (req, { user, db }) => {
  const body = await readJson<{ cardId?: unknown; rating?: unknown; answeredAt?: unknown }>(req);
  if (body instanceof Response) return body;

  const cardId = typeof body.cardId === 'string' ? body.cardId : '';
  const rating = body.rating;
  if (!cardId) return fail('invalid', 'Thiếu cardId', 400);
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
    return fail('invalid', 'rating phải là 1..4', 400);
  }

  const res = await answerCard(db, user.id, {
    cardId,
    rating: rating as Rating,
    answeredAt: typeof body.answeredAt === 'string' ? body.answeredAt : undefined,
  });
  if ('notFound' in res) return fail('not_found', 'Không tìm thấy thẻ', 404);
  return json(res);
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
