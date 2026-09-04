import 'server-only';
import type { Database } from '@/lib/ports/db';
import { postgresDatabase } from '@/lib/adapters/postgres';
import { memoryDatabase } from '@/lib/adapters/memory';
import { usingMemoryDb } from './env';

/**
 * Điểm ghép DUY NHẤT giữa ứng dụng và nhà cung cấp dữ liệu.
 *
 * Đây là chỗ duy nhất trong toàn bộ app biết có bao nhiêu adapter tồn tại.
 * Thêm nhà cung cấp mới = thêm một nhánh ở đây, không đụng `app/`, `lib/app/`,
 * `lib/domain/`.
 */
export function getDb(): Database {
  return usingMemoryDb ? memoryDatabase : postgresDatabase;
}
