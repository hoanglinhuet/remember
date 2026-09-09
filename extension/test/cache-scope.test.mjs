/**
 * Cache phải gắn với **server nào + tài khoản nào**.
 *
 * LỖI THẬT ĐÃ GẶP: chuyển giữa hai môi trường (dev ↔ production, hoặc hai tài khoản)
 * thì highlight sai. Mọi cache nằm dưới một key cố định trong `chrome.storage.local`
 * và không ai dọn: bộ từ của môi trường cũ vẫn được tô, cài đặt của tài khoản cũ vẫn
 * được dùng — và nặng nhất là danh sách domain tắt highlight còn "chờ đẩy" của tài
 * khoản A bị ĐẨY LÊN tài khoản B.
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

/** "Server": mỗi base + token là một tài khoản riêng, giữ cài đặt riêng. */
const servers = {
  'http://localhost:3000': { A: { highlightOff: ['dev-only.test'] } },
  'https://prod.test': { B: { highlightOff: [] } },
};
const accountOf = (auth) => String(auth || '').replace('Bearer ', '');
let pushedTo = [];

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const base = `${u.protocol}//${u.host}`;
  const acc = accountOf(init.headers?.authorization);
  const store = servers[base]?.[acc];
  if (!store) return { ok: false, status: 401, json: async () => null };

  if (u.pathname.endsWith('/me')) {
    if ((init.method || 'GET') === 'POST') {
      const patch = JSON.parse(init.body);
      if (Array.isArray(patch.highlightOff)) {
        store.highlightOff = [...patch.highlightOff];
        pushedTo.push({ base, acc, hosts: [...patch.highlightOff] });
      }
      return { ok: true, status: 200, json: async () => ({ config: store }) };
    }
    return { ok: true, status: 200, json: async () => ({ config: store }) };
  }
  if (u.pathname.endsWith('/cards/fronts')) {
    const fronts = acc === 'A' ? ['dev-word'] : ['prod-word'];
    return { ok: true, status: 200, json: async () => ({ fronts, count: fronts.length }) };
  }
  return { ok: false, status: 404, json: async () => null };
};

await import('../src/background/service-worker.js');

const send = (type, payload) => new Promise((r) => onMessage({ type, payload }, {}, r));
const wait = () => new Promise((r) => setTimeout(r, 10));

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${name}: ${JSON.stringify(got)} (mong ${JSON.stringify(want)})`); }
  else console.log(`PASS  ${name}`);
};

function login(base, token) {
  bag.apiBase = base;
  bag.apiToken = token;
  bag.apiUser = { id: token };
}
function reset() {
  for (const k of Object.keys(bag)) delete bag[k];
  bag.cards = [];
  bag.decks = [{ id: 'd1', name: 'Mặc định' }];
  servers['http://localhost:3000'].A.highlightOff = ['dev-only.test'];
  servers['https://prod.test'].B.highlightOff = [];
  pushedTo = [];
}

// 1. Bộ từ highlight KHÔNG được trôi từ môi trường này sang môi trường kia.
reset();
login('http://localhost:3000', 'A');
let r = await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('môi trường A: bộ từ của A', r.fronts, ['dev-word']);

login('https://prod.test', 'B');
r = await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('đổi sang B: bộ từ đổi theo, không còn của A', r.fronts, ['prod-word']);

// 2. Danh sách domain tắt cũng vậy: A tắt `dev-only.test`, B thì không.
reset();
login('http://localhost:3000', 'A');
r = await send('GET_HIGHLIGHT', { host: 'dev-only.test' });
eq('A: domain đã tắt -> không tô', r.on, false);

login('https://prod.test', 'B');
r = await send('GET_HIGHLIGHT', { host: 'dev-only.test' });
eq('B: cùng domain nhưng B chưa tắt -> vẫn tô', r.on, true);

// 3. NẶNG NHẤT: thay đổi "chờ đẩy" của A không được đẩy lên B.
reset();
login('http://localhost:3000', 'A');
servers['http://localhost:3000'].A = null;                 // A tạm thời không với tới được
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'secret.test', on: false });
eq('A mất kết nối: lưu local, chờ đẩy', [r.on, r.synced, bag.highlightOffDirty], [false, false, true]);

servers['http://localhost:3000'].A = { highlightOff: [] };  // A sống lại
login('https://prod.test', 'B');                            // nhưng người dùng đã sang B
await send('GET_HIGHLIGHT', { host: 'bat-ky.test' });
await wait();
eq('sang B: KHÔNG đẩy danh sách của A lên bất kỳ đâu', pushedTo, []);
eq('sang B: cài đặt của B còn nguyên', servers['https://prod.test'].B.highlightOff, []);
eq('sang B: gương local đã bị dọn', bag.highlightOff ?? null, null);

// 4. Nhưng thao tác lúc CHƯA ghép nối thì phải theo lên tài khoản vừa nối.
reset();
bag.apiBase = 'https://prod.test';                          // chưa có token
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'chua-nối.test', on: false });
eq('chưa ghép nối: lưu local, chờ đẩy', [r.on, bag.highlightOffDirty], [false, true]);

login('https://prod.test', 'B');                            // vừa dán mã xong
await send('GET_HIGHLIGHT', { host: 'bat-ky.test' });
await wait();
eq('vừa ghép nối: hàng chờ đi lên tài khoản mới',
  pushedTo.map((p) => [p.acc, p.hosts]), [['B', ['chua-nối.test']]]);

// 5. Bản ghép nối từ TRƯỚC (chưa có user.id): `#unknown` -> `#<id>` là cùng một tài
//    khoản, chỉ là biết thêm nó là ai ⇒ KHÔNG được xoá cache, kể cả thay đổi chờ đẩy.
reset();
bag.apiBase = 'https://prod.test';
bag.apiToken = 'B';
bag.apiUser = { email: 'b@test' };                          // thiếu id, như bản cũ lưu
await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('bản cũ: scope tạm là #unknown', bag.cacheScope, 'https://prod.test#unknown');
bag.highlightOff = ['giu-lai.test'];
bag.highlightOffDirty = true;
bag.apiUser = { id: 'B', email: 'b@test' };                 // /me điền id vào
await send('GET_HIGHLIGHT_STATE', { host: 'x.test' });
eq('biết thêm id: KHÔNG xoá hàng chờ', bag.highlightOff, ['giu-lai.test']);

// 6. Dấu scope được đóng đúng theo base + user.
reset();
login('http://localhost:3000', 'A');
await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('scope = base#user', bag.cacheScope, 'http://localhost:3000#A');

process.exit(bad ? 1 : 0);
