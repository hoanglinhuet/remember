import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, initialOf } from '@/lib/server/auth/session';
import { IconChevron, IconPlug, IconSliders } from '../_components/Icons';

export const dynamic = 'force-dynamic';

/**
 * Tài khoản cũng là nơi chứa Cài đặt và Kết nối extension.
 *
 * Trước đây hai trang đó là link emoji trên topbar của mọi màn hình — vừa nhỏ hơn
 * ngưỡng chạm, vừa chiếm chỗ ở chỗ khó với nhất. Chúng là việc làm một lần rồi
 * quên, nên gom vào đây đúng hơn là để thường trực.
 */
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <>
      <div className="topbar">
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
          Dữ liệu học nằm trên server, nên bạn dùng được ở cả điện thoại và máy tính.
        </p>

        <Link className="navrow" href="/settings">
          <span className="tile" data-hue="violet" aria-hidden="true">
            <IconSliders size={20} />
          </span>
          Cài đặt
          <IconChevron size={20} className="chev" />
        </Link>

        <Link className="navrow" href="/connect">
          <span className="tile" data-hue="teal" aria-hidden="true">
            <IconPlug size={20} />
          </span>
          Kết nối extension
          <IconChevron size={20} className="chev" />
        </Link>

        {/* form POST: không cần JS ở client để đăng xuất */}
        <form action="/api/v1/auth/logout" method="post" style={{ marginTop: 4 }}>
          <button className="btn" type="submit" style={{ width: '100%', color: 'var(--again)' }}>
            Đăng xuất
          </button>
        </form>
      </div>
    </>
  );
}
