import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { readConfig } from '@/lib/app/read-config';
import { listDeckSummaries } from '@/lib/app/decks';
import { LevelBar } from './_components/LevelBar';

export const dynamic = 'force-dynamic';

/** Hạn mức trong ngày, vẽ ra thành thanh thay vì nhét vào một dòng chữ. */
function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <b>{label}</b>
        <span>
          {used}/{cap}
        </span>
      </div>
      <div className="meter-track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

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
          <div className="sub">
            {totalCards} thẻ trong {decks.length || 0} bộ
          </div>
        </div>
      </div>

      <div className="stack">
        {/* Toàn bộ độ mạnh của màn hình dồn vào đúng khối này; phần dưới để yên. */}
        <section className="hero">
          <div>
            <div className="hero-label">Hôm nay</div>
            <p className="hero-fig" style={{ margin: 0 }}>
              <b>{playable}</b>
              <span>thẻ để ôn</span>
            </p>
          </div>

          <div className="hero-meters">
            <Meter label="Thẻ mới" used={room.newToday} cap={config.maxNew} />
            <Meter label="Lượt ôn" used={room.reviewsToday} cap={config.maxReview} />
          </div>

          {playable ? (
            <Link className="btn" href="/study">
              Ôn ngay
            </Link>
          ) : (
            <span className="btn disabled">
              {dueAll + freshAll ? 'Hết hạn mức hôm nay' : 'Không có thẻ đến hạn'}
            </span>
          )}
        </section>

        {/* Trạng thái trống là lời mời hành động, không phải một câu thông báo. */}
        {!decks.length && (
          <div className="emptybox">
            <span className="ramp-empty" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <h2>Chưa có thẻ nào</h2>
            <p>Lưu thẻ ngay khi đang đọc bằng extension, hoặc tra một từ rồi chọn nghĩa bạn muốn nhớ.</p>
            <div className="stack">
              <Link className="btn primary" href="/lookup">
                Tra từ đầu tiên
              </Link>
              <Link className="btn" href="/connect">
                Kết nối extension
              </Link>
            </div>
          </div>
        )}

        {decks.map((d) => (
          <Link key={d.id || 'orphan'} className="deckrow" href={`/study?deck=${d.id}`}>
            <span className="deckrow-top">
              <span className="deck-tile" aria-hidden="true">
                {d.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="deck-main">
                <b>{d.name}</b>
                {/* Số đếm mang luôn danh từ nên không cần chú giải riêng. */}
                <span className="deck-counts">
                  <span className={d.due ? 'n-due' : 'n-zero'}>{d.due} đến hạn</span>
                  <span className={d.fresh ? 'n-new' : 'n-zero'}>{d.fresh} mới</span>
                  {d.suspended > 0 && <span className="n-susp">{d.suspended} treo</span>}
                </span>
              </span>
            </span>
            <LevelBar levels={d.levels} />
          </Link>
        ))}
      </div>
    </>
  );
}
