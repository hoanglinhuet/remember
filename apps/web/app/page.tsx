import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, initialOf } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { readConfig } from '@/lib/app/read-config';
import { listDeckSummaries } from '@/lib/app/decks';
import { LevelBar } from './_components/LevelBar';

export const dynamic = 'force-dynamic';

/**
 * Server Component: dữ liệu lấy thẳng trong server, không cần round-trip API từ browser.
 * Đây là điểm Next.js hơn hẳn SPA cho màn hình đầu tiên.
 */
export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const db = getDb();
  const q = db.queriesFor(user.id);
  const [decks, room, config] = await Promise.all([
    listDeckSummaries(db, user.id),
    q.dailyRoom(),
    readConfig(db, user.id),
  ]);

  const dueAll = decks.reduce((n, d) => n + d.due, 0);
  const freshAll = decks.reduce((n, d) => n + d.fresh, 0);
  const playable = Math.min(dueAll, room.reviewLeft) + Math.min(freshAll, room.newLeft);
  const totalCards = decks.reduce((n, d) => n + d.total, 0);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>Remember</h1>
          <div className="sub">{totalCards} thẻ · hôm nay đã ôn {room.reviewsToday}</div>
        </div>
        <Link className="icon ghost" href="/lookup" aria-label="Tra từ">🔍</Link>
        <Link className="icon ghost" href="/stats" aria-label="Thống kê">📊</Link>
        <Link className="icon ghost" href="/connect" aria-label="Kết nối extension">🧩</Link>
        <Link className="icon ghost" href="/settings" aria-label="Cài đặt">⚙</Link>
        <Link className="icon ghost who on" href="/account" title={`${user.name} · ${user.email}`}>
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            : initialOf(user.name)}
        </Link>
      </div>

      <div className="stack">
        {playable ? (
          <Link className="btn primary big" href="/study">Ôn ngay · {playable} thẻ</Link>
        ) : (
          <span className="btn primary big disabled">
            {dueAll + freshAll ? 'Hết hạn mức hôm nay' : 'Không có thẻ đến hạn'}
          </span>
        )}

        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          hôm nay: {room.newToday}/{config.maxNew} thẻ mới · {room.reviewsToday}/{config.maxReview} lượt ôn
        </p>

        {!decks.length && (
          <p className="empty">
            Chưa có thẻ nào.<br />Lưu thẻ từ extension, hoặc tra từ rồi lưu.
          </p>
        )}

        {decks.map((d) => (
          <Link key={d.id || 'orphan'} className="deck deck-col" href={`/study?deck=${d.id}`}>
            <span className="deck-top">
              <span className="deck-name">{d.name}</span>
              <span className={`pill ${d.due ? 'due' : 'zero'}`} title="đến hạn">{d.due}</span>
              <span className={`pill ${d.fresh ? 'fresh' : 'zero'}`} title="thẻ mới">{d.fresh}</span>
              {d.suspended > 0 && <span className="pill susp" title="đang treo">{d.suspended}</span>}
            </span>
            <LevelBar levels={d.levels} />
          </Link>
        ))}
      </div>
    </>
  );
}
