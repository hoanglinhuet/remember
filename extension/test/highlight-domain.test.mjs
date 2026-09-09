/**
 * Kiểm tra công tắc highlight THEO TÊN MIỀN ở service worker:
 * mặc định bật · chỉ lưu cái tắt · nguồn sự thật là DB · không gọi API mỗi trang.
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
  tabs: { query: async () => [], sendMessage: async () => {} },
};

// "Server": giữ config và trả về đúng như apps/web làm (đã chuẩn hoá host).
const server = { config: { highlightOff: [] } };
const normalize = (h) => String(h).toLowerCase().replace(/^www\./, '');
let calls = { me: 0, mePost: 0, fronts: 0 };
let serverUp = true;

globalThis.fetch = async (url, init = {}) => {
  if (!serverUp) throw new Error('mất mạng');
  const path = String(url);
  if (path.includes('/cards/fronts')) {
    calls.fronts++;
    return { ok: true, status: 200, json: async () => ({ fronts: ['book', 'give up'], count: 2 }) };
  }
  if (path.endsWith('/me')) {
    if ((init.method || 'GET') === 'POST') {
      calls.mePost++;
      const patch = JSON.parse(init.body);
      if (Array.isArray(patch.highlightOff)) {
        server.config.highlightOff = [...new Set(patch.highlightOff.map(normalize))];
      }
      return { ok: true, status: 200, json: async () => ({ config: server.config }) };
    }
    calls.me++;
    return { ok: true, status: 200, json: async () => ({ config: server.config }) };
  }
  return { ok: false, status: 404, json: async () => null };
};

await import('../src/background/service-worker.js');

const send = (type, payload) => new Promise((resolve) => onMessage({ type, payload }, {}, resolve));
const wait = () => new Promise((r) => setTimeout(r, 10));

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${name}: ${JSON.stringify(got)} (mong ${JSON.stringify(want)})`); }
  else console.log(`PASS  ${name}`);
};

function reset(state, off = []) {
  for (const k of Object.keys(bag)) delete bag[k];
  Object.assign(bag, state);
  server.config = { highlightOff: off };
  calls = { me: 0, mePost: 0, fronts: 0 };
  serverUp = true;
}

const cards = [{ id: 'c1', front: 'book', normalizedFront: 'book', back: ['x'], synced: true }];

// 1. Mặc định BẬT ở domain chưa từng tắt.
reset({ apiToken: 'tok', cards });
let r = await send('GET_HIGHLIGHT', { host: 'vnexpress.net' });
eq('mặc định bật', [r.on, r.fronts.length > 0], [true, true]);

// 2. Server có 'abc.com' trong danh sách tắt ⇒ tắt, và khớp cả bản có www.
reset({ apiToken: 'tok', cards }, ['abc.com']);
r = await send('GET_HIGHLIGHT', { host: 'www.abc.com' });
eq('tắt theo server (www. cũng khớp)', [r.on, r.fronts], [false, []]);
r = await send('GET_HIGHLIGHT', { host: 'khac.com' });
eq('domain khác vẫn bật', r.on, true);

// 3. Tắt qua popup ⇒ ghi DB, và lần hỏi sau đã tắt.
reset({ apiToken: 'tok', cards });
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'www.news.vn', on: false });
eq('tắt: trả về on=false + đã sync', [r.on, r.synced], [false, true]);
eq('tắt: DB lưu host đã chuẩn hoá', server.config.highlightOff, ['news.vn']);
eq('tắt: gương local khớp DB', bag.highlightOff, ['news.vn']);
r = await send('GET_HIGHLIGHT', { host: 'news.vn' });
eq('tắt: trang đó không tô', [r.on, r.fronts], [false, []]);

// 4. Bật lại ⇒ xoá khỏi DB (chỉ lưu cái tắt).
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'news.vn', on: true });
eq('bật lại: on=true', r.on, true);
eq('bật lại: DB không còn mục nào', server.config.highlightOff, []);

// 5. Chưa ghép nối tài khoản: lưu ở máy này, synced=false, vẫn có hiệu lực.
reset({ cards });
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'local-only.test', on: false });
eq('chưa kết nối: synced=false', [r.on, r.synced], [false, false]);
eq('chưa kết nối: lưu local', bag.highlightOff, ['local-only.test']);
r = await send('GET_HIGHLIGHT', { host: 'local-only.test' });
eq('chưa kết nối: vẫn tắt được', r.on, false);

// 6. Cơ chế cache: hỏi 20 trang liên tiếp KHÔNG được gọi API mỗi lần.
reset({ apiToken: 'tok', cards });
for (let i = 0; i < 20; i++) await send('GET_HIGHLIGHT', { host: `site${i}.com` });
await wait();
eq('20 trang: /me gọi 1 lần', calls.me, 1);
eq('20 trang: /cards/fronts gọi 1 lần', calls.fronts, 1);

// 7. Popup hỏi trạng thái để vẽ ô tick.
reset({ apiToken: 'tok', cards }, ['tat.com']);
const s1 = await send('GET_HIGHLIGHT_STATE', { host: 'https://www.tat.com/bai-viet?x=1' });
eq('trạng thái cho popup (đã tắt)', [s1.host, s1.on], ['tat.com', false]);
const s2 = await send('GET_HIGHLIGHT_STATE', { host: 'bat.com' });
eq('trạng thái cho popup (đang bật)', [s2.host, s2.on], ['bat.com', true]);

// 8. LỖI ĐÃ GẶP: bấm tắt khi server không với tới được.
//    Trước đây bản server (còn rỗng, đang nằm trong cache) ghi đè lượt ghi local ở
//    lần đọc kế tiếp ⇒ ô tick tự bật lại và highlight không bao giờ tắt.
reset({ apiToken: 'tok', cards });
await send('GET_HIGHLIGHT', { host: 'warmup.com' });   // nạp cache settings (rỗng)
serverUp = false;
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'offline.com', on: false });
eq('mất mạng: tắt vẫn ăn, đánh dấu chưa đẩy', [r.on, r.synced], [false, false]);
eq('mất mạng: đánh dấu dirty', bag.highlightOffDirty, true);
r = await send('GET_HIGHLIGHT', { host: 'offline.com' });
eq('mất mạng: lần đọc sau KHÔNG bị bản server xoá', r.on, false);
const st = await send('GET_HIGHLIGHT_STATE', { host: 'offline.com' });
eq('mất mạng: popup vẫn thấy đã tắt (ô tick không tự bật lại)', st.on, false);

// 9. Mạng có lại ⇒ hàng chờ tự đẩy lên server, và hết dirty.
serverUp = true;
r = await send('GET_HIGHLIGHT', { host: 'offline.com' });  // kích hoạt flush ở nền
await wait();
eq('có mạng lại: đã đẩy lên server', server.config.highlightOff, ['offline.com']);
eq('có mạng lại: hết dirty', bag.highlightOffDirty, false);
eq('có mạng lại: vẫn tắt', (await send('GET_HIGHLIGHT', { host: 'offline.com' })).on, false);

// 10. Chưa ghép nối tài khoản: dirty vẫn giữ, và đẩy lên ngay sau khi ghép nối.
reset({ cards });
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'chua-ket-noi.com', on: false });
eq('chưa kết nối: giữ hàng chờ', [r.synced, bag.highlightOffDirty], [false, true]);
bag.apiToken = 'tok';                       // như vừa ghép nối xong
await send('GET_HIGHLIGHT', { host: 'chua-ket-noi.com' });
await wait();
eq('ghép nối xong: hàng chờ đi lên server', server.config.highlightOff, ['chua-ket-noi.com']);

// 11. HỢP ĐỒNG: chưa ghép nối tài khoản thì bấm công tắc KHÔNG gọi API nào cả.
//     Ghim lại vì đây đúng là thứ nhìn ra ngoài như một lỗi ("bấm mà không thấy call
//     API"), trong khi nó là thiết kế — và popup phải nói ra.
reset({ cards });
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'khong-token.com', on: false });
await wait();
eq('chưa ghép nối: không gọi API nào', [calls.me, calls.mePost], [0, 0]);
eq('chưa ghép nối: trả về lý do no_token', r.reason, 'no_token');
const st2 = await send('GET_HIGHLIGHT_STATE', { host: 'khong-token.com' });
eq('chưa ghép nối: popup biết là chưa kết nối', [st2.connected, st2.pending, st2.on], [false, true, false]);

// 12. Đã ghép nối thì bấm một lần = đúng MỘT lượt POST.
reset({ apiToken: 'tok', cards });
r = await send('SET_HIGHLIGHT_FOR_HOST', { host: 'co-token.com', on: false });
await wait();
eq('đã ghép nối: đúng 1 lượt POST /me', calls.mePost, 1);
eq('đã ghép nối: server đã có', server.config.highlightOff, ['co-token.com']);

// 13. BỘ TỪ ĐEM TÔ theo từng trạng thái kết nối.
//     Ghim vì đây đúng là câu hỏi "chưa dán mã mà highlight đã hiện": thẻ đã đẩy lên
//     một tài khoản (`synced: true`) vẫn nằm trong storage sau khi ngắt kết nối/đổi
//     môi trường, và bản trước đem cả bộ đó ra tô.
const mixed = [
  { id: 'a', front: 'da-dong-bo', normalizedFront: 'da-dong-bo', back: ['x'], synced: true },
  { id: 'b', front: 'chua-dong-bo', normalizedFront: 'chua-dong-bo', back: ['x'], synced: false },
];

reset({ cards: mixed });                       // chưa ghép nối (không có apiToken)
r = await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('chưa ghép nối: CHỈ tô thẻ chưa thuộc tài khoản nào', r.fronts, ['chua-dong-bo']);
eq('chưa ghép nối: nguồn = local-unsynced', bag.highlightIndex?.source, 'local-unsynced');

reset({ apiToken: 'tok', cards: mixed });      // đã ghép nối, server trả 2 từ
r = await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('đã ghép nối: server + thẻ chờ đẩy', [...r.fronts].sort(), ['book', 'give up', 'chua-dong-bo'].sort());
eq('đã ghép nối: nguồn = api', bag.highlightIndex?.source, 'api');

reset({ apiToken: 'tok', cards: mixed });      // đã ghép nối nhưng mất mạng ngay từ đầu
serverUp = false;
r = await send('GET_HIGHLIGHT', { host: 'x.test' });
eq('mất mạng chưa có cache: dùng cả bộ local', [...r.fronts].sort(), ['da-dong-bo', 'chua-dong-bo'].sort());
eq('mất mạng: nguồn = local-offline', bag.highlightIndex?.source, 'local-offline');

console.log(`\ncalls: ${JSON.stringify(calls)}`);
process.exit(bad ? 1 : 0);
