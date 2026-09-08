/**
 * Remember — highlight từ đã lưu ngay trên trang đang đọc.
 *
 * KHÔNG SỬA DOM. Dùng CSS Custom Highlight API: gom các `Range` khớp rồi đăng ký
 * `CSS.highlights`, style bằng `::highlight()`. Cách cũ — bọc mỗi từ trong một
 * `<span>` — có ba vấn đề mà cách này không có:
 *   - chèn thẻ vào trang của người khác làm vỡ layout, vỡ selector CSS của họ, và
 *     làm React/Vue "mất" node của chính nó rồi crash khi re-render;
 *   - bôi đen một đoạn có span lẫn vào cho ra text bị cắt vụn ⇒ chính tính năng
 *     bắt từ của extension này sẽ nhận sai từ;
 *   - dọn dẹp phải nhớ từng thẻ đã chèn; ở đây chỉ cần `CSS.highlights.delete`.
 *
 * Giới hạn của cách này, biết trước để không hứa sai: highlight không phải element
 * nên KHÔNG bắt được hover/click, và `::highlight()` chỉ nhận màu chữ, màu nền,
 * text-decoration, text-shadow — không có border-radius hay padding.
 */
(() => {
  'use strict';

  if (window.__rememberHighlight) return;
  window.__rememberHighlight = true;

  const NAME = 'remember-saved';
  const MAX_WORDS = 4000;    // trần để regex không phình vô hạn
  const MAX_RANGES = 3000;   // trần highlight mỗi trang, chống trang khổng lồ
  const DEBOUNCE_MS = 350;

  // Browser không có CSS Custom Highlight API (Chrome < 105, Firefox < 140) thì bỏ
  // qua trong im lặng: phần bắt từ của extension vẫn chạy đầy đủ, chỉ là không tô.
  const supported = typeof CSS !== 'undefined' && 'highlights' in CSS
    && typeof Highlight === 'function';
  if (!supported) return;

  /** Thẻ không chứa văn bản để đọc, hoặc chứa văn bản người dùng đang sửa. */
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'TITLE', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO',
  ]);

  let regex = null;

  // -------------------------------------------------------------- style

  /**
   * Style bằng adoptedStyleSheets, không chèn <style> vào trang: không thêm node
   * nào vào DOM của người ta, và tự mất khi tab đóng.
   *
   * Màu: tím của app, ĐỘ MỜ THẤP + gạch chân. Nền đặc sẽ đè lên màu chữ của trang
   * và có trang thành không đọc được — highlight là để nhận ra, không phải để nổi
   * hơn nội dung.
   */
  function installStyle() {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        ::highlight(${NAME}) {
          background-color: rgba(109, 74, 255, .18);
          text-decoration: underline;
          text-decoration-color: rgba(109, 74, 255, .75);
          text-decoration-thickness: 2px;
          text-underline-offset: 2px;
        }
      `);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (e) {
      // Hỏng ở đây = highlight có range nhưng không có màu, tức tắt câm. Phải nói ra.
      console.error('[Remember] không cài được style highlight:', e);
    }
  }

  // ------------------------------------------------------------- matcher

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * Một regex cho cả bộ từ. Dài nhất đứng trước để cụm từ thắng từ đơn nằm trong
   * nó ("give up" phải khớp trước "give").
   *
   * Ranh giới dùng lookaround theo \p{L}\p{N}, KHÔNG dùng `\b`: `\b` định nghĩa theo
   * [A-Za-z0-9_] nên chữ có dấu bị nó tính là ranh giới. Đã đo: `/\bbook\b/giu` khớp
   * cả trong "bookủ" và "ủbook", bản lookaround thì không — với `\b`, highlight sẽ
   * tô nhầm vào giữa từ ngay khi trang có tiếng Việt.
   */
  function buildRegex(fronts) {
    const list = [...new Set(fronts.map((f) => String(f).trim()).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_WORDS);
    if (!list.length) return null;

    const body = list.map(escapeRe).join('|');
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'giu');
    } catch (e) {
      console.error('[Remember] regex highlight lỗi:', e);
      return null;
    }
  }

  // ------------------------------------------------------------ quét trang

  function skip(node) {
    for (let n = node.parentNode; n; n = n.parentNode || n.host) {
      if (n.nodeType !== 1) continue;
      // SVG có tagName chữ thường ('svg'), HTML thì chữ hoa — chuẩn hoá trước khi so,
      // nếu không nhánh SVG lọt qua và text trong <svg> cũng bị tô.
      if (SKIP_TAGS.has(n.tagName.toUpperCase())) return true;
      // UI của chính extension (icon nổi + panel) sống trong shadow DOM có cờ này.
      if (n.hasAttribute?.('data-remember')) return true;
      // Vùng đang gõ: highlight không sửa DOM nên không phá được, nhưng range sẽ
      // lệch ngay khi người dùng gõ thêm, cho ra vệt màu sai chỗ.
      if (n.isContentEditable) return true;
    }
    return false;
  }

  function collectRanges() {
    const ranges = [];
    if (!regex) return ranges;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
        return skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      regex.lastIndex = 0;
      for (let m = regex.exec(node.nodeValue); m; m = regex.exec(node.nodeValue)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        ranges.push(range);
        if (ranges.length >= MAX_RANGES) return ranges;
        // Chuỗi rỗng không thể khớp (mọi từ đều có ít nhất 1 ký tự), nhưng vẫn
        // chặn lastIndex đứng yên để không lặp vô hạn nếu regex đổi sau này.
        if (m.index === regex.lastIndex) regex.lastIndex++;
      }
    }
    return ranges;
  }

  function paint() {
    if (!document.body) return;
    const ranges = collectRanges();
    if (!ranges.length) {
      CSS.highlights.delete(NAME);
      return;
    }
    CSS.highlights.set(NAME, new Highlight(...ranges));
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(paint, DEBOUNCE_MS);
  }

  // ----------------------------------------------------------------- vòng đời

  /**
   * Nguồn dữ liệu là service worker (nó gộp thẻ local với thẻ trên API rồi cache).
   * Hỏi một lần lúc trang mở; những lần đổi sau tới qua storage.onChanged.
   */
  async function load() {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'GET_HIGHLIGHT' });
    } catch {
      return; // extension vừa reload -> context cũ mất hiệu lực, không phải lỗi
    }
    if (!res?.ok || !res.on || !res.fronts?.length) {
      CSS.highlights.delete(NAME);
      regex = null;
      return;
    }
    regex = buildRegex(res.fronts);
    paint();
  }

  installStyle();
  load();

  // Bộ từ đổi (lưu thêm thẻ, xoá thẻ, bật/tắt trong popup) — service worker ghi lại
  // storage, mọi tab đang mở nghe được ngay, không cần chờ tải lại trang.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.highlightIndex || changes.highlightOn) load();
  });

  // Trang tự thêm nội dung (SPA, lazy-load, infinite scroll): quét lại, có debounce.
  // Bỏ qua thay đổi do chính extension gây ra để không tự kích hoạt vòng lặp.
  const observer = new MutationObserver((records) => {
    if (!regex) return;
    for (const r of records) {
      const target = r.target?.nodeType === 1 ? r.target : r.target?.parentElement;
      if (target?.closest?.('[data-remember]')) continue;
      schedule();
      return;
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
