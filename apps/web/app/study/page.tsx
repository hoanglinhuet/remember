import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import StudySession from './StudySession';

export const dynamic = 'force-dynamic';

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login?next=/study');
  const { deck } = await searchParams;

  return (
    <>
      <noscript>
        <p className="err">Phiên ôn tập cần JavaScript.</p>
        <Link href="/">Về trang chính</Link>
      </noscript>
      <StudySession deckId={deck ?? null} />
    </>
  );
}
