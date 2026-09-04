import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { LEVELS } from '@/lib/domain/memory';

export const dynamic = 'force-dynamic';

/** Server Component: tổng hợp bằng SQL, không gửi một dòng JS nào cho việc này. */
export default async function StatsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/stats');

  const s = await getDb().queriesFor(user.id).stats();

  const tiles: [number, string][] = [
    [s.cards, 'tổng số thẻ'],
    [s.due, 'đến hạn'],
    [s.today, 'đã ôn hôm nay'],
    [s.learning, 'đang học'],
    [s.review, 'đã vào ôn tập'],
    [s.logs, 'tổng lượt ôn'],
    [s.leeches, 'thẻ leech'],
    [s.suspended, 'đang treo'],
  ];

  return (
    <>
      <div className="topbar">
        <Link className="icon ghost" href="/" aria-label="Quay lại">←</Link>
        <h1>Thống kê</h1>
      </div>

      <div className="stack" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0 }}>
          Bậc độ nhớ dựa trên <b>stability</b> của FSRS — nhớ được bao lâu mà không cần ôn.
          Chỉ để xem, không ảnh hưởng lịch ôn.
        </p>
        {LEVELS.map((l, i) => (
          <div className="lvlrow" key={l.level} data-level={l.level}>
            <span className="dot" />
            <span className="nm">
              {l.level}. {l.name}
              <small>{l.hint}</small>
            </span>
            <b>{s.levels[i]}</b>
          </div>
        ))}
      </div>

      <div className="stats">
        {tiles.map(([n, label]) => (
          <div className="stat" key={label}>
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
