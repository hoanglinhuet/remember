/**
 * Test máy trạng thái BẬT/TẮT của content script highlight, bằng DOM giả.
 *
 * Kiểm đúng ba câu hỏi đã hỏng trước đây:
 *   1. domain đang bật  -> có gọi CSS.highlights.set với đủ số vệt?
 *   2. tắt qua popup    -> có xoá sạch?
 *   3. context đã chết  -> có tự dọn và ngắt observer?
 */
const log = [];
const registry = new Map();

class FakeHighlight {
  constructor(...ranges) { this.ranges = ranges; }
}

globalThis.Highlight = FakeHighlight;
globalThis.CSS = {
  highlights: {
    set(k, v) { registry.set(k, v); log.push(`set:${v.ranges.length}`); },
    delete(k) { registry.delete(k); log.push('delete'); },
  },
};
globalThis.CSSStyleSheet = class { replaceSync() {} };
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; this.live = false; }
  observe() { this.live = true; observers.push(this); }
  disconnect() { this.live = false; }
};
const observers = [];

// Một trang giả: 2 đoạn văn, mỗi đoạn một text node.
const para = (text) => ({
  nodeType: 3,
  nodeValue: text,
  parentNode: {
    nodeType: 1, tagName: 'P', isContentEditable: false,
    hasAttribute: () => false, parentNode: null,
  },
});
const nodes = [para('I read a book today'), para('then a book again, and give up')];

globalThis.document = {
  body: {},
  adoptedStyleSheets: [],
  visibilityState: 'visible',
  addEventListener() {},
  createRange: () => ({ setStart() {}, setEnd() {} }),
  createTreeWalker(_root, _mask, filter) {
    const list = nodes.filter((n) => filter.acceptNode(n) === NodeFilter.FILTER_ACCEPT);
    let i = 0;
    return { nextNode: () => (i < list.length ? list[i++] : null) };
  },
};
globalThis.window = globalThis;
globalThis.location = { hostname: 'test.com' };

let msgListener = null;
let reply = { ok: true, on: true, fronts: ['book', 'give up'] };
globalThis.chrome = {
  runtime: {
    id: 'fake-extension-id',
    sendMessage: async () => reply,
    onMessage: { addListener(fn) { msgListener = fn; } },
  },
  storage: { onChanged: { addListener() {} } },
};

await import('../src/content/highlight.js');

const tick = () => new Promise((r) => setTimeout(r, 5));
let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${name}: ${JSON.stringify(got)} (mong ${JSON.stringify(want)})`); }
  else console.log(`PASS  ${name}`);
};

// 1. Lúc nạp: domain đang bật ⇒ tô 3 chỗ ("book" ×2 + "give up").
await tick();
eq('đang bật: có tô, đúng số vệt', log, ['set:3']);
eq('đang bật: registry có highlight', registry.has('remember-saved'), true);

// 2. Popup tắt domain này ⇒ trả lời on:false, bắn HIGHLIGHT_CHANGED.
log.length = 0;
reply = { ok: true, on: false, fronts: [] };
let replied = null;
msgListener({ type: 'HIGHLIGHT_CHANGED' }, {}, (r) => { replied = r; });
await tick();
eq('tắt: popup nhận được trả lời (tab còn sống)', replied, { ok: true });
eq('tắt: ghi highlight rỗng rồi xoá', log, ['set:0', 'delete']);
eq('tắt: registry sạch', registry.has('remember-saved'), false);

// 3. Bật lại ⇒ tô lại (chứng minh `enabled` không bị kẹt ở false).
log.length = 0;
reply = { ok: true, on: true, fronts: ['book'] };
msgListener({ type: 'HIGHLIGHT_CHANGED' }, {}, () => {});
await tick();
eq('bật lại: tô lại được', log, ['set:2']);

// 4. Context extension chết (vừa Reload extension, tab chưa F5) ⇒ tự dọn + ngắt observer.
log.length = 0;
chrome.runtime.id = undefined;
msgListener({ type: 'HIGHLIGHT_CHANGED' }, {}, () => {});
await tick();
eq('context chết: dọn sạch màu', log, ['set:0', 'delete']);
eq('context chết: ngắt MutationObserver', observers.map((o) => o.live), [false]);

process.exit(bad ? 1 : 0);
