import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { LEVELS } from '@/lib/domain/memory';

export const dynamic = 'force-dynamic';

/** Số mang màu CHỈ ở chỗ màu có nghĩa; số trung tính giữ màu mực. */
type Tone = 'due' | 'good' | 'bad' | undefined;

/** Server Component: tổng hợp bằng SQL, không gửi một dòng JS nào cho việc này. */
export default async function StatsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/stats');

  const s = await getDb().queriesFor(user.id).stats();

  const tiles: [number, string, Tone][] = [
    [s.cards, 'tổng số thẻ', undefined],
    [s.due, 'đến hạn', 'due'],
    [s.today, 'đã ôn hôm nay', 'good'],
    [s.learning, 'đang học', undefined],
    [s.review, 'đã vào ôn tập', undefined],
    [s.logs, 'tổng lượt ôn', undefined],
    [s.leeches, 'thẻ leech', 'bad'],
    [s.suspended, 'đang treo', undefined],
  ];

  return (
    <>
      <div className="topbar">
        <h1>Thống kê</h1>
      </div>

      <div className="stack" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0 }}>
          Bậc độ nhớ dựa trên <b>stability</b> của FSRS — nhớ được bao lâu mà không cần ôn.
          Chỉ để xem, không ảnh hưởng lịch ôn.
        </p>
        {/* Chú giải tự mã hoá thứ tự: thanh dài dần VÀ màu đậm dần. */}
        {LEVELS.map((l, i) => (
          <div className="lvlrow" key={l.level} data-level={l.level}>
            <span className="gauge" aria-hidden="true">
              <i />
            </span>
            <span className="nm">
              {l.name}
              <small>{l.hint}</small>
            </span>
            <b>{s.levels[i]}</b>
          </div>
        ))}
      </div>

      <div className="stats">
        {tiles.map(([n, label, tone]) => (
          <div className="stat" key={label}>
            <b data-tone={tone}>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
