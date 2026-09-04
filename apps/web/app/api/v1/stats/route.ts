import { json, route } from '@/lib/server/api';

export const GET = route(async (_req, { user, db }) =>
  json(await db.queriesFor(user.id).stats()));

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
