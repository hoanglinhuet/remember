import 'server-only';
import { MODES } from '@/lib/domain/modes';
import { isStorableHost, normalizeHost } from '@/lib/domain/host';
import type { StudyConfig, StudyMode } from '@/lib/domain/types';
import type { Database } from '@/lib/ports/db';

/**
 * USE CASE: đổi cài đặt học.
 *
 * Validate ở đây chứ không ở route handler: cùng một quy tắc phải áp dụng dù lời gọi
 * đến từ web, extension hay một client nào khác sau này.
 */
export async function updateSettings(
  db: Database,
  userId: string,
  patch: Partial<StudyConfig>,
): Promise<StudyConfig> {
  return db.uow.transaction(userId, (repos) => repos.settings.save(sanitize(patch)));
}

export function sanitize(patch: Partial<StudyConfig>): Partial<StudyConfig> {
  const out: Partial<StudyConfig> = {};
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

  const maxNew = num(patch.maxNew, 0, 9999); if (maxNew !== undefined) out.maxNew = maxNew;
  const maxRev = num(patch.maxReview, 0, 9999); if (maxRev !== undefined) out.maxReview = maxRev;
  const ahead = num(patch.learnAheadMin, 0, 120); if (ahead !== undefined) out.learnAheadMin = ahead;
  const leech = num(patch.leechThreshold, 2, 30); if (leech !== undefined) out.leechThreshold = leech;
  const hour = num(patch.dayStartHour, 0, 23); if (hour !== undefined) out.dayStartHour = hour;
  const ret = num(patch.retention, 0.7, 0.98); if (ret !== undefined) out.retention = ret;
  if (patch.leechAction === 'tag' || patch.leechAction === 'suspend') out.leechAction = patch.leechAction;

  // Mode: chỉ nhận id có thật, bỏ trùng, và KHÔNG cho lưu danh sách rỗng — rỗng thì
  // phiên học không biết hiện gì. Không có mode nào hợp lệ thì lùi về 'recognition'.
  if (Array.isArray(patch.modes)) {
    const valid = new Set(MODES.map((m) => m.id));
    const picked = [...new Set(patch.modes)].filter((m): m is StudyMode => valid.has(m as StudyMode));
    out.modes = picked.length ? picked : ['recognition'];
  }

  // Danh sách domain tắt highlight. Chuẩn hoá + bỏ trùng ở ĐÂY, không ở client:
  // extension, web và mọi client sau này phải cho ra cùng một danh sách, nếu không
  // "đã tắt" ở nơi này lại thành "đang bật" ở nơi khác.
  if (Array.isArray(patch.highlightOff)) {
    const hosts = patch.highlightOff
      .map((h) => normalizeHost(String(h)))
      .filter(isStorableHost);
    // Trần 500: đủ cho mọi người dùng thật, và giữ `users.settings` khỏi phình vì
    // một client lỗi gửi lên cả lịch sử duyệt web.
    out.highlightOff = [...new Set(hosts)].slice(0, 500);
  }

  return out;
}
