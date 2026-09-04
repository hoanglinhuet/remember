import 'server-only';

/**
 * Biến môi trường CHỈ server. Không có tiền tố NEXT_PUBLIC_ nên không vào bundle client.
 * `import 'server-only'` làm BUILD FAIL nếu client component lỡ import.
 *
 * Không còn biến nào của Supabase: DATABASE_URL là chuẩn Postgres, chạy với bất kỳ
 * nhà cung cấp nào; Google OAuth do app tự làm.
 */
export const env = {
  databaseUrl: process.env.DATABASE_URL?.trim() ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
  appOrigin: process.env.APP_ORIGIN?.trim() ?? '',
  allowedExtensionIds: (process.env.ALLOWED_EXTENSION_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

export const hasDb = Boolean(env.databaseUrl);
export const hasGoogle = Boolean(env.googleClientId && env.googleClientSecret);

/**
 * Chưa có DATABASE_URL thì ở DEV dùng adapter bộ nhớ, để thử được luồng đăng nhập
 * Google trước khi dựng database. CHẶN ở production: bộ nhớ không sống qua các
 * instance serverless, đăng nhập sẽ mất ngay ở request sau.
 */
export const usingMemoryDb = !hasDb && process.env.NODE_ENV !== 'production';

/** Đăng nhập chỉ cần Google + một chỗ lưu (thật hoặc tạm). */
export const isConfigured = hasGoogle && (hasDb || usingMemoryDb);

export function originOf(req: Request): string {
  if (env.appOrigin) return env.appOrigin.replace(/\/$/, '');
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  return `${proto}://${host}`;
}
