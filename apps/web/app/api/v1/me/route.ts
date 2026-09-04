import { json, readJson, route } from '@/lib/server/api';
import { updateSettings } from '@/lib/app/settings';
import type { Me, StudyConfig } from '@/lib/domain/types';

const SERVER_SCHEMA = 1;

export const GET = route(async (_req, { user, db }) => {
  // `dailyRoom()` phải đọc cài đặt để biết hạn mức, nên nó đọc luôn cả hai trong
  // cùng một transaction. Gọi `readConfig()` song song là đọc `users.settings`
  // lần thứ hai qua một transaction thứ hai — cùng dữ liệu, thêm 4 round trip.
  const q = db.queriesFor(user.id);
  const [config, room] = await Promise.all([q.settings(), q.dailyRoom()]);
  const body: Me = {
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatarUrl },
    config,
    room,
    serverSchema: SERVER_SCHEMA,
  };
  return json(body);
});

export const POST = route(async (req, { user, db }) => {
  const patch = await readJson<Partial<StudyConfig>>(req);
  if (patch instanceof Response) return patch;
  return json({ config: await updateSettings(db, user.id, patch) });
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
