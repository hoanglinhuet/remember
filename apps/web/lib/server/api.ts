import 'server-only';
import { env, isConfigured } from './env';
import { currentUser, userFromBearer } from './auth/session';
import { getDb } from './db';
import type { Database, User } from '@/lib/ports/db';
import type { ApiError, ApiErrorCode } from '@/lib/domain/types';

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  detail?: Record<string, unknown>,
): Response {
  const body: ApiError = detail ? { error: code, message, detail } : { error: code, message };
  return Response.json(body, { status });
}

function corsOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  if (!origin?.startsWith('chrome-extension://')) return null;
  const id = origin.slice('chrome-extension://'.length);
  // Để trống ALLOWED_EXTENSION_IDS = cho phép mọi extension (tiện lúc dev, vì
  // extension ID đổi theo cách đóng gói). Đặt biến này khi phát hành công khai.
  if (!env.allowedExtensionIds.length) return origin;
  return env.allowedExtensionIds.includes(id) ? origin : null;
}

function withCors(req: Request, res: Response): Response {
  const origin = corsOrigin(req);
  if (!origin) return res;
  const h = new Headers(res.headers);
  // Whitelist tường minh, KHÔNG dùng `*`: request mang token.
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Headers', 'authorization, content-type');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

export interface Ctx<P = Record<string, never>> {
  user: User;
  db: Database;
  /** Tham số của segment động (`[id]`), đã await. Route tĩnh thì là object rỗng. */
  params: P;
}

/** Đối số thứ hai Next.js truyền cho route handler. `params` là Promise từ Next 15. */
interface RouteContext<P> {
  params?: Promise<P>;
}

/**
 * DECORATOR: bọc handler bằng xác thực, CORS và xử lý lỗi.
 * Handler bên trong chỉ còn việc của nó, không lặp lại 20 dòng boilerplate ở 9 chỗ.
 *
 * Tham số động lấy qua `ctx.params` — decorator await sẵn, để handler không phải
 * nhớ rằng `params` của Next.js là một Promise.
 */
export function route<P = Record<string, never>>(
  handler: (req: Request, ctx: Ctx<P>) => Promise<Response>,
): (req: Request, rc?: RouteContext<P>) => Promise<Response> {
  return async (req: Request, rc?: RouteContext<P>) => {
    if (req.method === 'OPTIONS') return withCors(req, new Response(null, { status: 204 }));
    try {
      if (!isConfigured) {
        return withCors(
          req,
          fail('not_configured', 'Server chưa cấu hình DATABASE_URL / GOOGLE_CLIENT_*', 503),
        );
      }
      // Cookie trước (web), rồi Bearer (extension).
      const user =
        (await currentUser()) ?? (await userFromBearer(req.headers.get('authorization')));
      if (!user) return withCors(req, fail('unauthorized', 'Chưa đăng nhập', 401));

      const params = ((await rc?.params) ?? {}) as P;
      return withCors(req, await handler(req, { user, db: getDb(), params }));
    } catch (e) {
      // Không trả stack ra ngoài; xem trong Vercel Logs.
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return withCors(req, fail('server_error', 'Lỗi server', 500));
    }
  };
}

/**
 * Route KHÔNG cần đăng nhập (đổi mã ghép nối, health). Vẫn có CORS + bắt lỗi,
 * nhưng không đòi phiên — vì lúc đổi mã thì extension chưa có phiên nào.
 */
export function publicRoute(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return withCors(req, new Response(null, { status: 204 }));
    try {
      if (!isConfigured) {
        return withCors(req, fail('not_configured', 'Server chưa cấu hình', 503));
      }
      return withCors(req, await handler(req));
    } catch (e) {
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return withCors(req, fail('server_error', 'Lỗi server', 500));
    }
  };
}

/** Đọc JSON an toàn: body hỏng phải là 400, không phải 500. */
export async function readJson<T>(req: Request): Promise<T | Response> {
  try {
    return (await req.json()) as T;
  } catch {
    return fail('invalid', 'Body không hợp lệ', 400);
  }
}
