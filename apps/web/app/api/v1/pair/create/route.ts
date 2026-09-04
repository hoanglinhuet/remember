import { json, route } from '@/lib/server/api';
import { createPairing } from '@/lib/app/pair-extension';

/** Web app tạo mã để dán vào extension. Cần đăng nhập. */
export const POST = route(async (_req, { user, db }) =>
  json(await createPairing(db, user.id, 'extension')));

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
