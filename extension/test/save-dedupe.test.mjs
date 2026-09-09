/**
 * Kiểm trùng khi lưu thẻ (FR-B3).
 *
 * LỖI THẬT ĐÃ GẶP: trên web không còn thẻ nào, nhưng extension vẫn báo "đã tồn tại
 * trong deck X". Hai nguyên nhân, cả hai được ghim ở đây:
 *   1. NGUỒN sai — hỏi `chrome.storage.local`, nơi giữ MỌI thẻ từng lưu từ browser
 *      này và không bị xoá khi người dùng xoá thẻ trên web.
 *   2. KHOÁ sai — chỉ so *từ + langFrom*, nên `book` (danh từ) và `book` (động từ)
 *      bị coi là một thẻ, và nghĩa thứ hai của cùng một từ không lưu được.
 *
 * Khoá đúng, giống index `cards_dedupe` ở server: từ + loại từ + bộ nghĩa + cặp
 * ngôn ngữ.
 */
let onMessage = null;
const bag = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...bag };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in bag).map((k) => [k, bag[k]]));
      },
      async set(obj) { Object.assign(bag, obj); },
      async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete bag[k]; },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: { addListener(fn) { onMessage = fn; } },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    getManifest: () => ({ version: 'test' }),
    sendMessage: async () => ({ ok: true }),
  },
  contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: { addListener() {} } },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) },
};

/** Thẻ mà "server" đang có, dạng như `/cards/existing` trả về. */
let serverCards = [];
let serverUp = true;

const sense = (back) => back
  .map((x) => String(x).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim())
  .filter(Boolean).sort().join('|');

globalThis.fetch = async (url, init = {}) => {
  if (!serverUp) throw new Error('mất mạng');
  const path = String(url);
  if (path.includes('/cards/existing')) {
    const front = new URL(path).searchParams.get('front') || '';
    const want = front.trim().toLowerCase();
    return {
      ok: true, status: 200,
      json: async () => ({
        cards: serverCards
          .filter((c) => c.front.toLowerCase() === want)
          .map((c) => ({
            id: c.id, pos: c.pos, back: c.back, backKey: sense(c.back),
            deckName: c.deckName, createdAt: '2026-01-01T00:00:00.000Z',
          })),
      }),
    };
  }
  if (path.includes('/cards')) {
    // Đẩy thẻ mới lên: chấp nhận.
    return { ok: true, status: 201, json: async () => ({ id: 'srv', deckId: 'd1', deckName: 'Mặc định' }) };
  }
  if (path.endsWith('/decks')) {
    return { ok: true, status: 200, json: async () => ({ decks: [{ id: 'd1', name: 'Mặc định' }] }) };
  }
  return { ok: false, status: 404, json: async () => null };
};

await import('../src/background/service-worker.js');

const save = (payload) => new Promise((r) => onMessage({ type: 'SAVE_CARD', payload }, {}, r));

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${name}: ${JSON.stringify(got)} (mong ${JSON.stringify(want)})`); }
  else console.log(`PASS  ${name}`);
};

const localCard = (over) => ({
  id: over.id, front: over.front, normalizedFront: over.front.toLowerCase(),
  back: over.back, pos: over.pos ?? null, langFrom: 'auto', langTo: 'vi',
  deckId: 'd1', synced: over.synced !== false, seenCount: 1,
});

function reset({ local = [], server = [], token = 'tok', up = true } = {}) {
  for (const k of Object.keys(bag)) delete bag[k];
  bag.decks = [{ id: 'd1', name: 'Mặc định' }];
  bag.cards = local;
  if (token) bag.apiToken = token;
  serverCards = server;
  serverUp = up;
}

// 1. ĐÚNG CA CỦA NGƯỜI DÙNG: local còn bản cũ, server đã xoá ⇒ phải LƯU ĐƯỢC.
reset({
  local: [localCard({ id: 'ghost', front: 'resilient', back: ['kiên cường'], pos: 'adjective' })],
  server: [],
});
let r = await save({ front: 'resilient', back: ['kiên cường'], pos: 'adjective' });
eq('web đã xoá: không báo trùng nữa', [r.ok, Boolean(r.duplicate)], [true, false]);
eq('web đã xoá: bóng thẻ cũ bị dọn, còn đúng 1 thẻ', bag.cards.length, 1);
eq('web đã xoá: thẻ còn lại là thẻ mới', bag.cards[0].id !== 'ghost', true);

// 2. Server CÓ thẻ đó ⇒ báo trùng, kèm tên deck của server.
reset({
  local: [],
  server: [{ id: 's1', front: 'resilient', back: ['kiên cường'], pos: 'adjective', deckName: 'Bộ A' }],
});
r = await save({ front: 'resilient', back: ['kiên cường'], pos: 'adjective' });
eq('server có: báo trùng + deck của server', [r.duplicate, r.deckName], [true, 'Bộ A']);
eq('server có: không tạo thẻ local', (bag.cards ?? []).length, 0);

// 3. Cùng từ, KHÁC loại từ ⇒ là thẻ khác (khoá cũ chỉ so từ nên chặn sai).
reset({
  local: [],
  server: [{ id: 's1', front: 'book', back: ['quyển sách'], pos: 'noun', deckName: 'Bộ A' }],
});
r = await save({ front: 'book', back: ['đặt trước'], pos: 'verb' });
eq('khác loại từ: lưu được', [r.ok, Boolean(r.duplicate)], [true, false]);

// 4. Cùng từ cùng loại từ, KHÁC nghĩa ⇒ vẫn là thẻ khác.
reset({
  local: [],
  server: [{ id: 's1', front: 'bank', back: ['ngân hàng'], pos: 'noun', deckName: 'Bộ A' }],
});
r = await save({ front: 'bank', back: ['bờ sông'], pos: 'noun' });
eq('khác nghĩa: lưu được', [r.ok, Boolean(r.duplicate)], [true, false]);

// 5. Thẻ local CHƯA đẩy lên (lưu lúc mất mạng) vẫn tính là trùng — người dùng đã lưu
//    nó thật, chỉ server chưa biết.
reset({
  local: [localCard({ id: 'pending', front: 'offline', back: ['ngoại tuyến'], synced: false })],
  server: [],
});
r = await save({ front: 'offline', back: ['ngoại tuyến'] });
eq('thẻ chờ đẩy: vẫn báo trùng', [r.duplicate, r.deckName], [true, 'Mặc định']);

// 6. Chưa ghép nối tài khoản: local là nguồn duy nhất, và dùng đúng khoá.
reset({
  local: [localCard({ id: 'l1', front: 'book', back: ['quyển sách'], pos: 'noun' })],
  server: [],
  token: null,
});
r = await save({ front: 'book', back: ['quyển sách'], pos: 'noun' });
eq('chưa ghép nối: trùng theo local', r.duplicate, true);
r = await save({ front: 'book', back: ['đặt trước'], pos: 'verb' });
eq('chưa ghép nối: khác loại từ vẫn lưu được', Boolean(r.duplicate), false);

// 7. Mất mạng khi đã ghép nối: lùi về local, không được coi như "chưa từng lưu".
reset({
  local: [localCard({ id: 'l1', front: 'brittle', back: ['giòn'] })],
  server: [],
  up: false,
});
r = await save({ front: 'brittle', back: ['giòn'] });
eq('mất mạng: dùng local', r.duplicate, true);

process.exit(bad ? 1 : 0);
