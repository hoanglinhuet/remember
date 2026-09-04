import type { Card, GlossOption, StudyMode } from './types';

/**
 * Các chế độ ôn tập.
 *
 * QUYẾT ĐỊNH: mode là **cách xem**, không phải thẻ con riêng.
 * Một thẻ có MỘT tiến độ FSRS bất kể ôn bằng mode nào. Đổi lại thì lịch ôn là
 * "trung bình" của nhiều kỹ năng (nhận biết ≠ nghe-chính-tả), nhưng không phải
 * đổi schema và không nhân số lượt ôn lên. Muốn tách theo mode thì `card_states`
 * phải khoá theo `(card_id, mode)` — việc của sau, xem ADR-31.
 *
 * QUYẾT ĐỊNH: gõ xong CHỈ kiểm đúng/sai và hiện diff. Rating cho FSRS vẫn do
 * người dùng chọn — máy không đoán được "khó" hay "dễ" từ việc gõ đúng.
 */

export const MODES: {
  id: StudyMode;
  name: string;
  hint: string;
  /** Câu mô tả để hiện trong màn học, cho biết đang phải làm gì. */
  task: string;
}[] = [
  { id: 'recognition', name: 'Nhận biết', hint: 'thấy từ → tự nhớ nghĩa → mở đáp án', task: 'Nhớ nghĩa của từ' },
  { id: 'typeVi', name: 'Gõ nghĩa Việt', hint: 'thấy từ → gõ nghĩa tiếng Việt', task: 'Gõ nghĩa tiếng Việt' },
  { id: 'dictation', name: 'Nghe rồi gõ', hint: 'nghe phát âm → gõ lại từ tiếng Anh', task: 'Nghe và gõ lại từ' },
  { id: 'typeEn', name: 'Gõ ngược', hint: 'thấy nghĩa Việt → gõ từ tiếng Anh', task: 'Gõ từ tiếng Anh' },
  { id: 'cloze', name: 'Điền vào câu', hint: 'câu có chỗ trống → gõ từ còn thiếu', task: 'Điền từ còn thiếu' },
  { id: 'choice', name: 'Trắc nghiệm', hint: 'chọn nghĩa đúng trong 4 đáp án', task: 'Chọn nghĩa đúng' },
];

export const DEFAULT_MODES: StudyMode[] = ['recognition'];

export function modeInfo(id: StudyMode) {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}

// ------------------------------------------------------- chuẩn hoá & so khớp

/**
 * Bỏ dấu tiếng Việt để so sánh: gõ "kien cuong" vẫn tính đúng với "kiên cường".
 * Người học từ vựng không nên bị chấm sai vì bàn phím không có bộ gõ tiếng Việt.
 * Đáp án hiển thị vẫn giữ nguyên dấu.
 */
export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // dấu tổ hợp
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Dạng để so khớp: bỏ dấu, lowercase, gộp khoảng trắng, bỏ dấu câu hai đầu. */
export function normalizeAnswer(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/** Khoảng cách Levenshtein — dùng để phân biệt "gõ sai một chữ" với "sai hẳn". */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

export type AnswerResultKind = 'exact' | 'near' | 'wrong';

export interface AnswerCheck {
  kind: AnswerResultKind;
  /** Đáp án khớp gần nhất — để hiện dạng đúng (có dấu). */
  best: string;
  distance: number;
}

/**
 * Kiểm câu trả lời gõ vào. `accepted` là TẤT CẢ đáp án hợp lệ:
 * với mode gõ nghĩa Việt thì mọi nghĩa của thẻ đều tính đúng — người học nhớ
 * được một nghĩa là đã nhớ từ đó.
 */
export function checkAnswer(input: string, accepted: readonly string[]): AnswerCheck {
  const got = normalizeAnswer(input);
  let best = accepted[0] ?? '';
  let bestDist = Infinity;

  for (const candidate of accepted) {
    const want = normalizeAnswer(candidate);
    if (!want) continue;
    if (got === want) return { kind: 'exact', best: candidate, distance: 0 };
    const d = editDistance(got, want);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }

  // Từ dài thì cho phép sai nhiều hơn một chút; từ ngắn thì sai 1 ký tự đã là từ khác.
  const target = normalizeAnswer(best);
  const tolerance = target.length >= 8 ? 2 : 1;
  const kind: AnswerResultKind = got && bestDist <= tolerance ? 'near' : 'wrong';
  return { kind, best, distance: bestDist === Infinity ? -1 : bestDist };
}

// --------------------------------------------------------------------- cloze

export interface ClozeParts {
  before: string;
  after: string;
  /** Đúng dạng từ xuất hiện trong câu (có thể khác `front` về hoa/thường). */
  hidden: string;
}

/**
 * Cắt câu ngữ cảnh thành trước/sau chỗ trống.
 * Trả null nếu câu không chứa từ đó — lúc đó mode cloze không dùng được cho thẻ này.
 */
export function clozeParts(sentence: string | null, front: string): ClozeParts | null {
  if (!sentence || !front) return null;
  const at = sentence.toLowerCase().indexOf(front.toLowerCase());
  if (at < 0) return null;
  return {
    before: sentence.slice(0, at),
    after: sentence.slice(at + front.length),
    hidden: sentence.slice(at, at + front.length),
  };
}

// ----------------------------------------------------- mode nào dùng được

/**
 * Mode nào dùng được với thẻ này. Mỗi mode cần dữ liệu khác nhau, nên không phải
 * thẻ nào cũng ôn được bằng mọi mode — bắt buộc kiểm trước khi chọn ngẫu nhiên.
 */
export function availableModes(card: Card, distractorCount: number): StudyMode[] {
  const hasBack = card.back.length > 0;
  const out: StudyMode[] = ['recognition', 'dictation']; // luôn dùng được
  if (hasBack) out.push('typeVi', 'typeEn');
  if (clozeParts(card.contextSentence, card.front)) out.push('cloze');
  if (hasBack && distractorCount >= 3) out.push('choice');
  return out;
}

/**
 * Chọn mode cho một thẻ: ngẫu nhiên trong (đã bật ∩ dùng được).
 * Không có mode nào khớp thì lùi về 'recognition' — luôn dùng được, không bao giờ
 * để người dùng mắc kẹt vì cấu hình.
 */
export function pickMode(
  enabled: readonly StudyMode[],
  card: Card,
  distractorCount: number,
  rng: () => number = Math.random,
): StudyMode {
  const usable = availableModes(card, distractorCount).filter((m) => enabled.includes(m));
  if (!usable.length) return 'recognition';
  return usable[Math.floor(rng() * usable.length)]!;
}

/**
 * Lấy 3 nghĩa của thẻ KHÁC làm đáp án nhiễu cho trắc nghiệm.
 * Ưu tiên thẻ cùng loại từ — nhiễu cùng từ loại thì bài tập mới thật sự khó.
 */
export function distractors(card: Card, pool: readonly GlossOption[], count = 3): string[] {
  const own = new Set(card.back.map(normalizeAnswer));
  const samePos: string[] = [];
  const other: string[] = [];

  for (const { gloss, pos } of pool) {
    if (!gloss || own.has(normalizeAnswer(gloss))) continue;
    (pos && pos === card.pos ? samePos : other).push(gloss);
  }

  const seen = new Set<string>();
  const picked: string[] = [];
  for (const gloss of [...shuffle(samePos), ...shuffle(other)]) {
    const key = normalizeAnswer(gloss);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(gloss);
    if (picked.length >= count) break;
  }
  return picked;
}

export function shuffle<T>(list: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
