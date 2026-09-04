'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconBars, IconCards, IconPerson, IconSearch } from './Icons';

/**
 * Điều hướng đáy, nằm trong vùng ngón tay.
 *
 * Thay 5 link emoji chen chúc trên topbar cũ — ở đó chúng vừa nhỏ hơn ngưỡng
 * chạm 48px, vừa nằm mép trên là chỗ khó với nhất khi cầm một tay.
 *
 * Mỗi đích có một sắc riêng và icon GIỮ NGUYÊN màu ở cả trạng thái tắt: tab đang
 * chọn được đánh dấu bằng viên nền pha nhạt cộng nhãn đậm hơn, chứ không phải
 * bằng cách rút màu của ba tab kia.
 *
 * Client component vì cần `usePathname` để biết tab nào đang mở.
 */

const TABS = [
  { href: '/', label: 'Học', hue: 'violet', Icon: IconCards },
  { href: '/lookup', label: 'Tra từ', hue: 'teal', Icon: IconSearch },
  { href: '/stats', label: 'Thống kê', hue: 'rose', Icon: IconBars },
  { href: '/account', label: 'Tài khoản', hue: 'blue', Icon: IconPerson },
] as const;

/**
 * Các route toàn màn hình: phiên ôn cần đúng một việc, và trang đăng nhập thì
 * chưa có gì để điều hướng tới.
 */
const HIDDEN = ['/study', '/login'];

export function TabBar() {
  const pathname = usePathname();
  if (HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  // /settings và /connect nằm dưới Tài khoản, nên tab đó sáng khi đang ở trong chúng
  const activeHref =
    pathname === '/settings' || pathname === '/connect' ? '/account' : pathname;

  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      {TABS.map(({ href, label, hue, Icon }) => {
        const on = activeHref === href;
        return (
          <Link
            key={href}
            href={href}
            className="tab"
            data-hue={hue}
            data-on={on ? '1' : undefined}
            aria-current={on ? 'page' : undefined}
          >
            <span className="tab-pill">
              <Icon size={22} />
            </span>
            <span className="tab-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
