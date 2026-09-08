import 'server-only';
import { fail } from './api';
import type { CardPatch } from '@/lib/ports/db';

/**
 * Đọc phần sửa được của một thẻ từ body JSON.
 *
 * Quy tắc: khoá KHÔNG có mặt trong body thì không có mặt trong patch. Đó là khác
 * biệt giữa "đừng đụng tới IPA" và "xoá IPA đi", và nếu gộp hai thứ đó thì mỗi lần
 * sửa nghĩa sẽ âm thầm xoá mọi field mà form không gửi lên.
 *
 * Trả `Response` khi dữ liệu sai — route chỉ việc trả thẳng ra.
 */
export function readCardPatch(body: Record<string, unknown>): CardPatch | Response {
  const patch: CardPatch = {};

  if ('front' in body) {
    const front = String(body.front ?? '').trim();
    if (!front) return fail('invalid', 'Từ không được để trống', 400);
    if (front.length > 200) return fail('invalid', 'Từ tối đa 200 ký tự', 400);
    patch.front = front;
  }

  if ('back' in body) {
    if (!Array.isArray(body.back)) return fail('invalid', 'Nghĩa phải là danh sách', 400);
    const back = body.back.map((x) => String(x).trim()).filter(Boolean);
    if (!back.length) return fail('invalid', 'Thẻ phải có ít nhất một nghĩa', 400);
    if (back.length > 20) return fail('invalid', 'Tối đa 20 nghĩa cho một thẻ', 400);
    patch.back = back;
  }

  if ('deckId' in body) {
    patch.deckId = typeof body.deckId === 'string' && body.deckId ? body.deckId : null;
  }

  if ('readingType' in body) {
    patch.readingType =
      body.readingType === 'ipa' || body.readingType === 'translit' ? body.readingType : null;
  }

  for (const key of ['reading', 'pos', 'contextSentence', 'note'] as const) {
    if (!(key in body)) continue;
    const raw = body[key];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length > 2000) return fail('invalid', 'Nội dung quá dài', 400);
    // Chuỗi rỗng = xoá field, nên chuẩn hoá về null thay vì lưu '' (hai giá trị
    // cùng nghĩa "không có" thì mọi chỗ đọc phải kiểm tra cả hai).
    patch[key] = text || null;
  }

  return patch;
}
