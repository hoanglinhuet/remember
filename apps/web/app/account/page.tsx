import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, initialOf } from '@/lib/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <>
      <div className="topbar">
        <Link className="icon ghost" href="/" aria-label="Quay lại">←</Link>
        <h1>Tài khoản</h1>
      </div>

      <div className="stack">
        <div className="account">
          {user.avatarUrl
            ? <img className="avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            : <span className="avatar avatar-txt">{initialOf(user.name)}</span>}
          <span style={{ flex: 1, minWidth: 0 }}>
            <b className="acc-name">{user.name}</b>
            <small className="muted acc-mail">{user.email}</small>
          </span>
        </div>

        <p className="muted">
          Dữ liệu học nằm trên server nên dùng được ở cả điện thoại và máy tính.
        </p>

        {/* form POST: không cần JS ở client để đăng xuất */}
        <form action="/api/v1/auth/logout" method="post">
          <button className="btn" type="submit" style={{ width: '100%' }}>Đăng xuất</button>
        </form>
      </div>
    </>
  );
}
