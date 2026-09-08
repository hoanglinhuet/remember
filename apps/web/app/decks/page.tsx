import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { listDeckSummaries } from '@/lib/app/decks';
import DeckManager from './DeckManager';

export const dynamic = 'force-dynamic';

/**
 * Quản lý bộ thẻ. Tách khỏi trang chính có chủ đích: trang chính là để BẮT ĐẦU ÔN,
 * nên mỗi hàng ở đó là một nút "học bộ này". Thêm nút sửa/xoá vào từng hàng sẽ đặt
 * hai việc rất khác nhau — và một trong hai là xoá dữ liệu — cạnh nhau ở cùng một
 * vùng ngón tay.
 */
export default async function DecksPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/decks');

  const decks = await listDeckSummaries(getDb(), user.id);

  return (
    <>
      {/* Không có mũi tên quay lại: đây là một tab, không phải trang con. */}
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>Bộ thẻ</h1>
          <div className="sub">{decks.length} bộ</div>
        </div>
      </div>

      <DeckManager initial={decks} />
    </>
  );
}
