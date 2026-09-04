/** Mốc ngày theo giờ bắt đầu ngày kiểu Anki. Thuần, dùng chung cả hai phía. */

/** Mốc kết thúc "hôm nay": thẻ Review đến hạn trước mốc này là học được từ sáng. */
export function dayEnd(now: Date, hour: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

/** Mốc bắt đầu "hôm nay" - dùng để đếm số đã học trong ngày. */
export function dayStart(now: Date, hour: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

export function humanInterval(due: string | Date, from: Date = new Date()): string {
  const mins = Math.round((new Date(due).getTime() - from.getTime()) / 60000);
  if (mins < 1) return '<1 phút';
  if (mins < 60) return `${mins} phút`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ngày`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} tháng`;
  return `${(days / 365).toFixed(1)} năm`;
}

/** Chuẩn hoá để dedupe (FR-B3). Phải giống hệt ở client, server và extension. */
export function normalizeFront(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/**
 * Dạng chuẩn hoá của bộ nghĩa — một phần của khoá chống trùng (FR-B3).
 *
 * `back` là mảng, nên ["kiên cường","đàn hồi"] và ["đàn hồi","kiên cường"] phải cho
 * ra cùng một khoá: cùng bộ nghĩa, chỉ khác thứ tự tick trong panel.
 *
 * Sort mặc định của JS so theo code point — khớp với `collate "C"` dùng ở bước
 * backfill trong 004_dedupe_sense.sql, để dòng cũ và dòng mới không lệch nhau.
 */
export function senseKey(back: readonly string[]): string {
  return back
    .map((s) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort()
    .join('|');
}
