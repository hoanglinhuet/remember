import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { IconBack } from '../../_components/Icons';
import CardManager from './CardManager';

export const dynamic = 'force-dynamic';

/** Thẻ mồ côi (bộ thẻ chứa chúng đã bị xoá) không có id thật, nên có id riêng ở URL. */
const NO_DECK = 'none';

const PAGE = 50;

export default async function DeckCardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/decks/${id}`);

  const db = getDb();
  const q = db.queriesFor(user.id);
  const orphan = id === NO_DECK;

  const [deck, page] = await Promise.all([
    orphan ? Promise.resolve(null) : q.deck(id),
    q.deckCards({ deckId: orphan ? null : id, limit: PAGE, offset: 0 }),
  ]);
  if (!orphan && !deck) notFound();

  const name = deck?.name ?? 'Không có bộ';

  return (
    <>
      <div className="topbar">
        <Link className="iconbtn" href="/decks" aria-label="Quay lại">
          <IconBack size={22} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </h1>
          <div className="sub">{page.total} thẻ</div>
        </div>
        {!orphan && page.total > 0 && (
          <Link className="btn" href={`/study?deck=${id}`} style={{ minHeight: 40, padding: '0 14px' }}>
            Ôn
          </Link>
        )}
      </div>

      <CardManager deckId={orphan ? null : id} initial={page} pageSize={PAGE} />
    </>
  );
}
