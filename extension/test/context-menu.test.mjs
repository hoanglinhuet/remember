/**
 * Menu chuột phải "Translate with Remember".
 *
 * LỖI THẬT ĐÃ GẶP: ở trang web thường bấm menu thì "không có phản hồi". Hai nguyên
 * nhân, cả hai được ghim ở đây:
 *   1. `chrome.tabs.sendMessage` gửi cho CẢ TAB ⇒ mọi frame đều nhận (content script
 *      chạy với `all_frames: true`), panel mở trong một iframe không ai thấy, và câu
 *      trả lời đầu tiên tới lại có thể là của frame đó ⇒ service worker coi như xong.
 *      Phải gửi đúng `info.frameId`.
 *   2. Content script không mở được panel nhưng vẫn báo `ok` (hoặc không báo gì) ⇒
 *      service worker lùi về lưu thẻ thô, im lặng.
 */
let onClicked = null;
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
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    getManifest: () => ({ version: 'test' }),
    sendMessage: async () => ({ ok: true }),
  },
  contextMenus: {
    removeAll(cb) { cb?.(); },
    create() {},
    onClicked: { addListener(fn) { onClicked = fn; } },
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    query: async () => [],
    // Ghi lại từng lượt gửi, và cho test quyết định phản hồi.
    sendMessage: async (tabId, msg, options) => {
      sent.push({ tabId, type: msg?.type, text: msg?.payload?.text, options });
      if (reply === 'throw') throw new Error('Could not establish connection');
      return reply;
    },
  },
};

let sent = [];
let reply = { ok: true };
globalThis.fetch = async () => { throw new Error('mất mạng'); };

await import('../src/background/service-worker.js');

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${name}: ${JSON.stringify(got)} (mong ${JSON.stringify(want)})`); }
  else console.log(`PASS  ${name}`);
};

const click = (info, tab) => onClicked(info, tab);
function reset(nextReply) {
  for (const k of Object.keys(bag)) delete bag[k];
  sent = [];
  reply = nextReply;
}

const MENU = 'remember-lookup';

// 1. Trang web thường: mở panel trong ĐÚNG frame vừa bấm, và KHÔNG lưu thẻ nào.
reset({ ok: true });
await click(
  { menuItemId: MENU, selectionText: 'resilient', frameId: 7, pageUrl: 'https://a.test/x' },
  { id: 42, title: 'A' },
);
eq('gửi đúng 1 lượt, đúng frame', sent, [{
  tabId: 42, type: 'SHOW_LOOKUP', text: 'resilient', options: { frameId: 7 },
}]);
eq('panel mở được thì KHÔNG lưu thẻ thô', bag.cards ?? [], []);

// 2. Không có content script (PDF cục bộ chưa cấp quyền, tab chạy bản cũ):
//    lùi về lưu thẻ thô để không mất từ vừa đọc.
reset('throw');
await click(
  { menuItemId: MENU, selectionText: 'obsolete', frameId: 0, pageUrl: 'file:///a.pdf' },
  { id: 9, title: 'PDF' },
);
eq('không mở được panel -> lưu thẻ thô', (bag.cards ?? []).map((c) => c.front), ['obsolete']);
eq('thẻ thô giữ nguồn', (bag.cards ?? [])[0]?.sourceUrl, 'file:///a.pdf');

// 3. Content script trả về ok:false (mở panel lỗi) -> cũng phải lùi về lưu thô.
reset({ ok: false, error: 'panel lỗi' });
await click(
  { menuItemId: MENU, selectionText: 'brittle', frameId: 0, pageUrl: 'https://b.test' },
  { id: 3, title: 'B' },
);
eq('ok:false -> vẫn lưu được thẻ', (bag.cards ?? []).map((c) => c.front), ['brittle']);

// 4. Menu khác / không có chữ: không làm gì.
reset({ ok: true });
await click({ menuItemId: 'menu-khac', selectionText: 'x', frameId: 0 }, { id: 1 });
await click({ menuItemId: MENU, selectionText: '', frameId: 0 }, { id: 1 });
eq('menu khác hoặc rỗng: không gửi, không lưu', [sent.length, (bag.cards ?? []).length], [0, 0]);

// 5. Không có frameId (browser cũ): vẫn gửi, chỉ là không giới hạn frame.
reset({ ok: true });
await click({ menuItemId: MENU, selectionText: 'legacy', pageUrl: 'https://c.test' }, { id: 5 });
eq('thiếu frameId: gửi không kèm options', sent[0]?.options, undefined);

process.exit(bad ? 1 : 0);
