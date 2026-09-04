import type { CardProgress, StudyConfig } from './types';

/**
 * Bậc độ nhớ 1-5 - dữ liệu DẪN XUẤT, chỉ để hiển thị và lọc.
 *
 * Quan hệ một chiều: rating -> FSRS -> stability -> memoryLevel(). Bậc KHÔNG bao giờ
 * là input của việc tính lịch và KHÔNG tham gia sắp xếp hàng đợi.
 *
 * Dựa vào `stability` (nhớ được BAO LÂU) chứ không phải retrievability (nhớ NGAY LÚC NÀY):
 * retrievability bật về ~100% sau mỗi lần ôn nên xếp bậc theo nó là vô nghĩa.
 * Không trộn `difficulty`: đã đo, quên 1 lần đẩy 2.10 -> 7.39 rồi 6 lần đúng chỉ hạ về 7.30,
 * nên một thẻ stability 308 ngày vẫn bị đóng đinh ở bậc thấp.
 */
export type MemoryLevel = 1 | 2 | 3 | 4 | 5;

export const LEVELS: { level: MemoryLevel; name: string; hint: string }[] = [
  { level: 1, name: 'Chưa nhớ', hint: 'chưa ôn lần nào' },
  { level: 2, name: 'Mới thuộc', hint: 'nhớ được trong tuần' },
  { level: 3, name: 'Nhớ ngắn hạn', hint: 'nhớ được trong tháng' },
  { level: 4, name: 'Nhớ vững', hint: 'nhớ được nửa năm' },
  { level: 5, name: 'Nhớ lâu dài', hint: 'nhớ từ nửa năm trở lên' },
];

export function memoryLevel(
  p: Pick<CardProgress, 'state' | 'reps' | 'stability'> | null | undefined,
  thresholds: StudyConfig['levelThresholds'] = [7, 30, 180],
): MemoryLevel {
  if (!p || p.state === 'new' || !(p.reps > 0)) return 1;
  const s = p.stability;
  if (s == null || !Number.isFinite(s) || s <= 0) return 1;

  const [t2, t3, t4] = thresholds;
  if (s < t2) return 2;
  if (s < t3) return 3;
  if (s < t4) return 4;
  return 5;
}

export function levelInfo(level: MemoryLevel) {
  return LEVELS[level - 1]!;
}

export function levelCounts(
  list: (CardProgress | null)[],
  thresholds: StudyConfig['levelThresholds'] = [7, 30, 180],
): [number, number, number, number, number] {
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const p of list) {
    if (p?.suspended) continue;
    // Chỉ số tường minh: noUncheckedIndexedAccess không suy ra được 1..5 là an toàn.
    const i = (memoryLevel(p, thresholds) - 1) as 0 | 1 | 2 | 3 | 4;
    out[i] += 1;
  }
  return out;
}

export function stabilityText(p: Pick<CardProgress, 'stability'> | null): string | null {
  const s = p?.stability;
  if (s == null || !Number.isFinite(s) || s <= 0) return null;
  if (s < 1) return '≈ dưới 1 ngày';
  if (s < 30) return `≈ ${Math.round(s)} ngày`;
  if (s < 365) return `≈ ${(s / 30).toFixed(1)} tháng`;
  return `≈ ${(s / 365).toFixed(1)} năm`;
}
