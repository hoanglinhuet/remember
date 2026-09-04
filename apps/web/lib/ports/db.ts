import type { IdentityRepository } from './identity';
import type { StudyQueries } from './queries';
import type { UnitOfWork } from './repositories';

/**
 * COMPOSITION ROOT — thứ duy nhất tầng ứng dụng nhận được.
 *
 * Đổi nhà cung cấp dữ liệu = viết một `Database` mới trong `lib/adapters/`,
 * rồi sửa đúng một dòng trong `lib/server/db.ts`. Không đụng `app/`, `lib/domain/`,
 * `lib/app/`.
 */
export interface Database {
  identity: IdentityRepository;
  /** Ranh giới transaction — use case gọi để gom nhiều thao tác ghi thành nguyên tử. */
  uow: UnitOfWork;
  /** Truy vấn đọc của một user. Không ghi, nên không cần transaction. */
  queriesFor(userId: string): StudyQueries;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export type { IdentityRepository, PairingCode, Session, User } from './identity';
export type { ExistingCard, QueueResult, RecentCard, StudyQueries } from './queries';
export {
  DuplicateCard,
} from './repositories';
export type {
  CardRepository, DeckRepository, DedupeKey, NewCardInput, ProgressRepository, Repos,
  ReviewLogInput, ReviewLogRepository, SettingsRepository, UnitOfWork,
} from './repositories';
