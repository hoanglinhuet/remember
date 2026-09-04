import Link from 'next/link';
import { IconBack } from '../_components/Icons';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import { getDb } from '@/lib/server/db';
import { readConfig } from '@/lib/app/read-config';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/settings');

  const config = await readConfig(getDb(), user.id);

  return (
    <>
      <div className="topbar">
        <Link className="iconbtn" href="/account" aria-label="Quay lại"><IconBack size={22} /></Link>
        <h1>Cài đặt</h1>
      </div>
      <SettingsForm initial={config} />
    </>
  );
}
