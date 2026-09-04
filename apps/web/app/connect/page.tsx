import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth/session';
import ConnectClient from './ConnectClient';

export const dynamic = 'force-dynamic';

export default async function ConnectPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/connect');

  return (
    <>
      <div className="topbar">
        <Link className="icon ghost" href="/" aria-label="Quay lại">←</Link>
        <h1>Kết nối extension</h1>
      </div>
      <p className="muted">
        Đang đăng nhập bằng <b>{user.email ?? user.name}</b>. Mã bên dưới sẽ nối extension vào
        đúng tài khoản này.
      </p>
      <ConnectClient />
    </>
  );
}
