import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { listDecks } from '@/lib/app/manage-deck';
import LookupClient from './LookupClient';

export const dynamic = 'force-dynamic';

export default async function LookupPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/lookup');

  // Danh sách deck lấy ở server: client khỏi phải gọi thêm một round-trip.
  // Danh sách deck lấy ở server: client khỏi phải gọi thêm một round-trip.
  const decks = (await listDecks(getDb(), user.id)).map((d) => ({ id: d.id, name: d.name }));

  return (
    <>
      <div className="topbar">
        <Link className="icon ghost" href="/" aria-label="Quay lại">←</Link>
        <h1>Tra từ</h1>
      </div>
      <LookupClient decks={decks} />
    </>
  );
}
