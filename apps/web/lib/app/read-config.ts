import 'server-only';
import type { StudyConfig } from '@/lib/domain/types';
import type { Database } from '@/lib/ports/db';

/** Đọc cài đặt — dùng chung cho Server Component và route handler. */
export function readConfig(db: Database, userId: string): Promise<StudyConfig> {
  return db.uow.transaction(userId, (repos) => repos.settings.get());
}
