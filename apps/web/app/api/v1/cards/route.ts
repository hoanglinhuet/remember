import { fail, json, readJson, route } from '@/lib/server/api';
import { saveCard } from '@/lib/app/save-card';
import { DuplicateCard } from '@/lib/ports/db';

/** Endpoint extension gọi khi bấm "＋ Lưu thẻ". */
export const POST = route(async (req, { user, db }) => {
  const body = await readJson<Record<string, unknown>>(req);
  if (body instanceof Response) return body;

  const front = String(body.front ?? '').trim();
  if (!front) return fail('invalid', 'Thiếu nội dung thẻ', 400);
  if (front.length > 200) return fail('invalid', 'Quá 200 ký tự', 400);

  const readingType =
    body.readingType === 'ipa' || body.readingType === 'translit' ? body.readingType : null;

  try {
    const { card, deckName } = await saveCard(db, user.id, {
      id: typeof body.id === 'string' ? body.id : undefined,
      deckId: typeof body.deckId === 'string' ? body.deckId : null,
      front,
      back: Array.isArray(body.back) ? body.back.map(String) : [],
      reading: typeof body.reading === 'string' ? body.reading : null,
      readingType,
      pos: typeof body.pos === 'string' ? body.pos : null,
      langFrom: typeof body.langFrom === 'string' ? body.langFrom : 'auto',
      langTo: typeof body.langTo === 'string' ? body.langTo : 'vi',
      contextSentence: typeof body.contextSentence === 'string' ? body.contextSentence : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      sourceTitle: typeof body.sourceTitle === 'string' ? body.sourceTitle : null,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    });
    return json({ id: card.id, deckId: card.deckId, deckName }, { status: 201 });
  } catch (e) {
    // Lỗi MIỀN, không phải mã lỗi Postgres — adapter đã dịch.
    if (e instanceof DuplicateCard) {
      return fail('duplicate', 'Thẻ đã có sẵn', 409, { cardId: e.cardId, deckName: e.deckName });
    }
    throw e;
  }
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
