import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env, hasDb, hasGoogle, isConfigured, usingMemoryDb } from '@/lib/server/env';
import { currentUser } from '@/lib/server/auth/session';

export const dynamic = 'force-dynamic';

const GOOGLE_G = (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.5l7.8 6.1C12.3 13.6 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24c0-1.6-.2-3.2-.5-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.4z" />
    <path fill="#FBBC05" d="M10.4 28.4a14.6 14.6 0 0 1 0-8.8l-7.8-6.1a24 24 0 0 0 0 21l7.8-6.1z" />
    <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.5-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.4 0-11.7-4.1-13.6-9.9l-7.8 6.1C6.5 42.2 14.6 47.5 24 47.5z" />
  </svg>
);

/** `.env.local` mẫu. CSS của .block đặt white-space: pre-wrap nên xuống dòng giữ nguyên. */
const ENV_EXAMPLE = [
  'GOOGLE_CLIENT_ID=…apps.googleusercontent.com',
  'GOOGLE_CLIENT_SECRET=…',
  '',
  '# Tuỳ chọn — bỏ trống thì dev dùng bộ nhớ tạm',
  '# DATABASE_URL=postgres://user:pass@host:5432/db',
].join('\n');

/** Lỗi OAuth thường khó hiểu — dịch những cái hay gặp sang tiếng người. */
function explain(code: string): string {
  if (code === 'not_configured') return 'Server chưa có GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET';
  if (code === 'missing_code') return 'Google không trả về mã xác thực';
  if (code === 'oauth_failed') return 'Không khởi tạo được đăng nhập';
  if (code === 'state_expired') return 'Yêu cầu đăng nhập đã hết hạn hoặc đã dùng — bấm lại nút đăng nhập';
  if (/redirect_uri_mismatch/i.test(code)) return 'redirect_uri chưa khai ở Google Cloud Console (xem bên dưới)';
  return code;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; next?: string }>;
}) {
  const { e, next } = await searchParams;
  if (await currentUser()) redirect('/');

  // Dựng đúng URL để người dùng copy-paste, khỏi phải đoán.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = env.appOrigin || `${proto}://${host}`;
  const redirectUri = `${origin}/api/v1/auth/callback`;

  const nextParam = next?.startsWith('/') ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <>
      <div className="topbar">
        <h1>Đăng nhập</h1>
      </div>

      {isConfigured ? (
        <div className="stack">
          <p className="muted">
            Dữ liệu học nằm trên server nên cần đăng nhập. Tài khoản được tạo tự động ở lần
            đăng nhập đầu.
          </p>

          <a className="gbtn" href={`/api/v1/auth/login${nextParam}`}>
            {GOOGLE_G}
            <span>Đăng nhập bằng Google</span>
          </a>

          {e && <p className="err">✕ {explain(e)}</p>}

          {usingMemoryDb && (
            <p className="note-box">
              Đang chạy <b>không có database</b> — dữ liệu giữ trong bộ nhớ server và{' '}
              <b>mất khi restart</b>. Đủ để thử đăng nhập Google. Thêm{' '}
              <code>DATABASE_URL</code> khi cần lưu thật.
            </p>
          )}

          <details className="setup">
            <summary>URL cần khai ở Google Cloud Console</summary>
            <p className="muted">
              APIs &amp; Services → Credentials → OAuth client →{' '}
              <b>Authorized redirect URIs</b>, dán đúng chuỗi này:
            </p>
            <code className="copyable">{redirectUri}</code>
            <p className="muted">
              Chỉ một chỗ duy nhất — app tự làm OAuth nên không còn cấu hình redirect ở đâu khác.
            </p>
          </details>
        </div>
      ) : (
        <div className="stack">
          <p className="err">
            ✕ Server chưa cấu hình
            {!hasGoogle && ' — thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET'}
            {hasGoogle && !hasDb && ' — thiếu DATABASE_URL (và không ở chế độ dev)'}
          </p>

          <ol className="steps">
            <li>
              Tạo <code>apps/web/.env.local</code>:
              <code className="block">{ENV_EXAMPLE}</code>
              Chưa cần database: ở dev, thiếu <code>DATABASE_URL</code> thì app dùng bộ nhớ tạm.
            </li>
            <li>
              Google Cloud Console → Credentials → OAuth client (Web) →{' '}
              <b>Authorized redirect URIs</b>:
              <code className="block">{redirectUri}</code>
            </li>
            <li>
              Khởi động lại <code>npm run dev</code> — Next.js chỉ đọc env lúc start. Kiểm tra
              bằng <code>/api/v1/health</code>.
            </li>
          </ol>

          <p className="muted">
            Trên Vercel: <b>Project → Settings → Environment Variables</b>, cùng tên biến.
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        <Link href="/api/v1/health">Kiểm tra cấu hình</Link>
      </p>
    </>
  );
}
