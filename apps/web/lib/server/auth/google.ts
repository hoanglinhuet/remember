import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '@/lib/server/env';

/**
 * Google OAuth 2.0 (Authorization Code + PKCE) — tự làm, không qua nhà cung cấp auth nào.
 *
 * Người dùng chỉ thấy hai domain: app của bạn và accounts.google.com.
 *
 * `redirect_uri` đăng ký ở Google Cloud Console trỏ THẲNG về app này, nên không còn
 * bước redirect trung gian và không còn chỗ cấu hình "Redirect URLs" thứ hai để dán nhầm.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  /** `sub` — định danh ổn định, KHÔNG đổi khi user đổi email. Đây là khoá để nối tài khoản. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function newState(): string {
  return b64url(randomBytes(24));
}

export function authorizeUrl(input: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    // Chỉ scope cơ bản: không cần Google review, và không xin thứ mình không dùng.
    scope: 'openid email profile',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    // Không xin refresh token của Google: mình chỉ cần danh tính một lần,
    // phiên đăng nhập là của mình (bảng sessions).
    access_type: 'online',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/**
 * Đổi code lấy id_token rồi đọc hồ sơ.
 *
 * Không cần xác minh chữ ký JWKS: id_token nhận TRỰC TIẾP từ endpoint token của Google
 * qua TLS, kèm client_secret — đây là luồng "code" chứ không phải "implicit", nên
 * token không đi qua trình duyệt và không thể bị thay. Vẫn kiểm `aud` và `iss` để chắc.
 */
export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => null)) as
    | { id_token?: string; error?: string; error_description?: string }
    | null;

  if (!res.ok || !body?.id_token) {
    throw new Error(body?.error_description ?? body?.error ?? `Google trả về ${res.status}`);
  }

  const claims = decodeIdToken(body.id_token);

  if (claims.aud !== env.googleClientId) throw new Error('id_token sai client_id');
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') {
    throw new Error('id_token sai issuer');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('id_token đã hết hạn');
  }
  if (!claims.sub) throw new Error('id_token thiếu sub');

  return {
    sub: claims.sub,
    email: claims.email ?? null,
    emailVerified: claims.email_verified === true,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

interface IdTokenClaims {
  sub?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function decodeIdToken(token: string): IdTokenClaims {
  const part = token.split('.')[1];
  if (!part) throw new Error('id_token không hợp lệ');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as IdTokenClaims;
}
