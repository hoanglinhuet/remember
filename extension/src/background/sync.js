/**
 * Remember — kết nối extension với tài khoản, và lấy/đẩy dữ liệu qua API.
 *
 * CÁCH LẤY PHIÊN: người dùng tạo mã ở web app (`/connect`) rồi dán vào popup.
 * Extension đổi mã lấy session token riêng (`sessions.kind = 'extension'`).
 *
 * Vì sao không đọc cookie bằng `chrome.cookies` (cách trước):
 *   - Mỗi browser profile là một cookie jar riêng ⇒ phải đăng nhập web ở từng profile.
 *   - Cần quyền `cookies` — quyền mạnh, store sẽ chất vấn khi review.
 *   - Extension dùng chung phiên với web ⇒ không thu hồi riêng extension được.
 * Với mã ghép nối: token của extension độc lập, thu hồi riêng được, và không cần
 * quyền `cookies` nào.
 *
 * NGUỒN DỮ LIỆU: deck và danh sách thẻ lấy từ API. Bản local chỉ còn là cache để
 * hiển thị khi mất mạng và hàng chờ khi đẩy thất bại.
 */

const DEFAULT_BASE = 'http://localhost:3000';
const BASE_KEY = 'apiBase';
const TOKEN_KEY = 'apiToken';
const USER_KEY = 'apiUser';
const DECKS_KEY = 'deckCache';
const OUTBOX_KEY = 'outbox';
const FLUSH_ALARM = 'remember-flush';

// ------------------------------------------------------------------ cấu hình

export async function getApiBase() {
  const bag = await chrome.storage.local.get(BASE_KEY);
  return String(bag[BASE_KEY] || DEFAULT_BASE).replace(/\/+$/, '');
}

export async function setApiBase(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(clean)) throw new Error('URL không hợp lệ');
  // Đổi server thì token cũ vô nghĩa — xoá luôn để không hiện trạng thái sai.
  await chrome.storage.local.set({ [BASE_KEY]: clean });
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, DECKS_KEY]);
  return clean;
}

async function getToken() {
  const bag = await chrome.storage.local.get(TOKEN_KEY);
  return bag[TOKEN_KEY] || null;
}

// -------------------------------------------------------------- gọi API

/**
 * Gọi API với token. Trả { ok, status, body } — KHÔNG ném lỗi, vì mọi chỗ gọi
 * đều cần phân biệt "chưa đăng nhập" với "mất mạng" với "server lỗi".
 */
async function call(path, init = {}) {
  const base = await getApiBase();
  const token = await getToken();
  if (!token) return { ok: false, reason: 'no_token' };

  let res;
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, reason: 'network', error: String(e?.message || e) };
  }

  if (res.status === 401) {
    // Token bị thu hồi hoặc hết hạn: xoá để UI hiện "cần kết nối lại".
    await chrome.storage.local.remove([TOKEN_KEY, USER_KEY]);
    return { ok: false, reason: 'unauthorized', status: 401 };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, reason: 'server', status: res.status, body };
  return { ok: true, status: res.status, body };
}

// ------------------------------------------------------------ ghép nối

/** Đổi mã người dùng dán vào lấy token. Không cần đăng nhập ở phía extension. */
export async function connectWithCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, error: 'Chưa nhập mã' };

  const base = await getApiBase();
  let res;
  try {
    res = await fetch(`${base}/api/v1/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, label: navigator.userAgent.slice(0, 60) }),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Không gọi được ${base} — ${String(e?.message || e)}` };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    return { ok: false, error: body?.message || `Lỗi ${res.status}` };
  }

  await chrome.storage.local.set({ [TOKEN_KEY]: body.token, [USER_KEY]: body.user ?? null });
  // Kéo deck về ngay để panel có gì mà chọn.
  await refreshDecks();
  // Đẩy luôn những thẻ đã lưu trước khi kết nối.
  return { ok: true, user: body.user ?? null };
}

export async function disconnect() {
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, DECKS_KEY]);
}

/**
 * Trạng thái kết nối. Ba tình huống, xử lý khác nhau:
 *  - no_token: chưa dán mã
 *  - unauthorized: token hết hạn/bị thu hồi → cần dán mã mới
 *  - connected / error
 */
export async function getStatus() {
  const base = await getApiBase();
  const pending = (await readOutbox()).length;
  const token = await getToken();
  if (!token) return { state: 'no_token', base, pending };

  const res = await call('/me');
  if (res.ok) {
    await chrome.storage.local.set({ [USER_KEY]: res.body?.user ?? null });
    return { state: 'connected', base, pending, user: res.body?.user ?? null };
  }
  if (res.reason === 'unauthorized') return { state: 'unauthorized', base, pending };

  // Mất mạng: vẫn coi là đã kết nối, chỉ báo lỗi — đừng làm người dùng tưởng
  // bị đăng xuất chỉ vì wifi rớt.
  const bag = await chrome.storage.local.get(USER_KEY);
  return { state: 'error', base, pending, user: bag[USER_KEY] ?? null, error: res.error || `HTTP ${res.status}` };
}

// ------------------------------------------------------------------ decks

/** Deck lấy từ API; cache lại để panel dùng được khi mất mạng. */
export async function refreshDecks() {
  const res = await call('/decks');
  if (!res.ok) return { ok: false, reason: res.reason };
  const decks = (res.body?.decks ?? []).map((d) => ({
    id: d.id, name: d.name, due: d.due ?? 0, fresh: d.fresh ?? 0,
  }));
  await chrome.storage.local.set({ [DECKS_KEY]: { decks, at: Date.now() } });
  return { ok: true, decks };
}

/** Deck cho panel: API nếu được, không thì cache. */
export async function getDecks({ maxAgeMs = 5 * 60_000 } = {}) {
  const bag = await chrome.storage.local.get(DECKS_KEY);
  const cached = bag[DECKS_KEY];
  const fresh = cached && Date.now() - cached.at < maxAgeMs;
  if (fresh) return { decks: cached.decks, stale: false };

  const res = await refreshDecks();
  if (res.ok) return { decks: res.decks, stale: false };
  return { decks: cached?.decks ?? [], stale: true, reason: res.reason };
}

export async function createDeck(name) {
  const res = await call('/decks', { method: 'POST', body: JSON.stringify({ name }) });
  if (!res.ok) return { ok: false, reason: res.reason, error: res.body?.message };
  await refreshDecks();
  return { ok: true, deck: res.body?.deck, existed: Boolean(res.body?.existed) };
}

/**
 * Dạng chuẩn hoá của bộ nghĩa — PHẢI giống hệt `senseKey()` ở server
 * (apps/web/lib/domain/day.ts), nếu không client sẽ báo "đã lưu" sai.
 */
export function senseKey(back) {
  return (back || [])
    .map((x) => String(x).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

/** Thẻ đã có của một từ — để panel hiện "đã lưu" ngay khi tra. */
export async function getExisting(front, langFrom, langTo) {
  const qs = new URLSearchParams({
    front,
    langFrom: langFrom || 'auto',
    langTo: langTo || 'vi',
  });
  const res = await call(`/cards/existing?${qs.toString()}`);
  if (!res.ok) return { ok: false, reason: res.reason, cards: [] };
  return { ok: true, cards: res.body?.cards ?? [] };
}

/** Danh sách thẻ gần nhất cho popup — lấy từ API. */
export async function getRecentCards(limit = 50) {
  const res = await call(`/cards/list?limit=${limit}`);
  if (!res.ok) return { ok: false, reason: res.reason, cards: [] };
  return { ok: true, cards: res.body?.cards ?? [] };
}

// ------------------------------------------------------------------ outbox

async function readOutbox() {
  const bag = await chrome.storage.local.get(OUTBOX_KEY);
  return Array.isArray(bag[OUTBOX_KEY]) ? bag[OUTBOX_KEY] : [];
}

async function writeOutbox(list) {
  await chrome.storage.local.set({ [OUTBOX_KEY]: list });
  if (list.length) await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  else await chrome.alarms.clear(FLUSH_ALARM);
}

async function enqueue(cardId) {
  const list = await readOutbox();
  if (!list.includes(cardId)) {
    list.push(cardId);
    await writeOutbox(list);
  }
}

async function dequeue(cardId) {
  await writeOutbox((await readOutbox()).filter((id) => id !== cardId));
}

// ---------------------------------------------------------------- đẩy thẻ

function toPayload(card) {
  return {
    id: card.id,
    deckId: card.deckId || null,
    front: card.front,
    back: card.back ?? [],
    reading: card.reading || null,
    readingType: card.readingType || null,
    pos: card.pos || null,
    langFrom: card.langFrom || 'auto',
    langTo: card.langTo || 'vi',
    contextSentence: card.contextSentence || null,
    sourceUrl: card.sourceUrl || null,
    sourceTitle: card.sourceTitle || null,
  };
}

/**
 * Đẩy một thẻ. Idempotent: `id` do extension sinh, server upsert theo `id`,
 * nên gửi lại sau lỗi mạng không nhân đôi thẻ.
 */
export async function pushCard(card) {
  const res = await call('/cards', { method: 'POST', body: JSON.stringify(toPayload(card)) });
  if (res.ok) return { ok: true, deckName: res.body?.deckName ?? null };

  // 409 = server đã có thẻ này ⇒ coi như đã đồng bộ, đừng thử lại mãi.
  if (res.status === 409) {
    return { ok: true, duplicate: true, deckName: res.body?.detail?.deckName ?? null };
  }
  return { ok: false, reason: res.reason, error: res.body?.message || res.error };
}

/** Lưu xong ở local thì đẩy lên; thất bại vì mạng/server thì xếp hàng chờ. */
export async function syncAfterSave(card, markSynced) {
  const res = await pushCard(card);
  if (res.ok) {
    await markSynced(card.id);
    await dequeue(card.id);
    return res;
  }
  if (res.reason === 'network' || res.reason === 'server') await enqueue(card.id);
  return res;
}

/** Đẩy lại hàng chờ + các thẻ chưa từng đồng bộ (kể cả lưu trước khi kết nối). */
export async function flushOutbox(readCards, markSynced) {
  if (!(await getToken())) return { pushed: 0, left: (await readOutbox()).length, reason: 'no_token' };

  const cards = await readCards();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ids = new Set([...(await readOutbox()), ...cards.filter((c) => !c.synced).map((c) => c.id)]);

  let pushed = 0;
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) {
      await dequeue(id);
      continue;
    }
    const res = await pushCard(card);
    if (res.ok) {
      await markSynced(id);
      await dequeue(id);
      pushed++;
    } else if (res.reason === 'no_token' || res.reason === 'unauthorized') {
      break; // thử tiếp là vô ích
    } else {
      await enqueue(id);
    }
  }
  return { pushed, left: (await readOutbox()).length };
}

export { FLUSH_ALARM };
