import { fail, json, readJson, route } from '@/lib/server/api';
import { createDeck } from '@/lib/app/manage-deck';
import { listDeckSummaries } from '@/lib/app/decks';

export const GET = route(async (_req, { user, db }) =>
  json({ decks: await listDeckSummaries(db, user.id) }));

export const POST = route(async (req, { user, db }) => {
  const body = await readJson<{ name?: unknown }>(req);
  if (body instanceof Response) return body;

  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return fail('invalid', 'Tên deck không được để trống', 400);
  if (name.length > 60) return fail('invalid', 'Tên deck tối đa 60 ký tự', 400);

  const { deck, existed } = await createDeck(db, user.id, name);
  return json({ deck, existed }, { status: existed ? 200 : 201 });
});

export const OPTIONS = route(async () => new Response(null, { status: 204 }));
