/**
 * Remember - content script (M0)
 *
 * Trách nhiệm: phát hiện selection, hiện icon nổi cạnh vùng chọn, mở panel khi click.
 * KHÔNG fetch mạng (theo ADR-6: chỉ service worker gọi mạng ra ngoài).
 */
(() => {
  'use strict';

  // Content script có thể bị inject 2 lần (SPA, re-inject sau update) -> chống trùng.
  if (window.__rememberInjected) return;
  window.__rememberInjected = true;

  // Trước đây có một dòng console.info in phiên bản, để biết tab đang chạy bản nào.
  // Đã bỏ: content script chạy trên MỌI trang, nên nó là rác trong console của người
  // dùng. Cách kiểm bản đang chạy mà không cần log: chrome://extensions hiện version,
  // và Service Worker → Inspect cho biết bản nào vừa được nạp.

  const MAX_CARD_LEN = 200; // FR-A1: dài hơn thì chỉ tra, không cho làm thẻ
  /**
   * Ngưỡng TỰ phát âm. Dài hơn thì phải bấm nút loa.
   *
   * Bôi đen một câu rồi bị đọc to nguyên câu là quấy rầy chứ không phải tiện — nhất
   * là khi đang đọc ở chỗ công cộng. Một từ hay một cụm ngắn thì ngược lại: nghe ngay
   * lúc vừa thấy nghĩa là lúc não gắn âm với nghĩa tốt nhất.
   */
  const AUTO_SPEAK_MAX = 60;
  const ICON_SIZE = 28;
  const GAP = 6;
  const ICON_IN = 160;  // ms - phải khớp với transition trong STYLES
  const PANEL_IN = 190;

  /** @type {HTMLElement|null} */ let host = null;
  /** @type {ShadowRoot|null} */ let root = null;
  /** @type {HTMLElement|null} */ let icon = null;
  /** @type {HTMLElement|null} */ let panel = null;

  /** Selection đang được "chốt" cho lần tương tác này. */
  let current = null; // { text, rect, contextSentence, lang }

  // ---------------------------------------------------------------- UI shell

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
        "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }

    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }

    /* Hiện/ẩn bằng visibility + opacity (không phải display) để transition chạy được.
       visibility đổi tức thì khi mở, và bị hoãn tới cuối transition khi đóng
       -> vẫn chặn được click khi ẩn mà không cắt mất hiệu ứng fade-out. */
    .icon {
      position: fixed; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;
      display: grid; place-items: center; pointer-events: auto;
      border: 0; padding: 0; margin: 0; cursor: pointer;
      border-radius: 9px; background: #6d4aff; color: #fff;
      box-shadow: 0 2px 10px rgba(24, 16, 64, .32);

      visibility: hidden; opacity: 0;
      transform: translateY(var(--enter-y, -4px)) scale(.72);
      transform-origin: var(--origin, top left);
      transition:
        opacity ${ICON_IN}ms ease,
        transform ${ICON_IN}ms cubic-bezier(.34, 1.56, .64, 1),
        box-shadow .12s ease,
        visibility 0s ${ICON_IN}ms;
      will-change: transform, opacity;
    }
    .icon[data-open="1"] {
      visibility: visible; opacity: 1; transform: none;
      transition-delay: 0s, 0s, 0s, 0s;
    }
    .icon[data-open="1"]:hover { transform: scale(1.1); box-shadow: 0 4px 14px rgba(24, 16, 64, .4); }
    .icon[data-open="1"]:active { transform: scale(.94); transition-duration: 60ms; }
    .icon:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .icon svg { width: 17px; height: 17px; display: block; }

    .panel {
      position: fixed; display: block; pointer-events: auto;
      width: 344px; max-width: calc(100vw - 24px);
      background: #fff; color: #1a1725;
      border: 1px solid rgba(24, 16, 64, .12); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(24, 16, 64, .22);
      padding: 12px 14px 10px; font-size: 13px; line-height: 1.5;

      visibility: hidden; opacity: 0;
      transform: translateY(var(--enter-y, -6px)) scale(.965);
      transform-origin: var(--origin, top left);
      transition:
        opacity ${PANEL_IN}ms ease,
        transform ${PANEL_IN}ms cubic-bezier(.22, 1.2, .36, 1),
        visibility 0s ${PANEL_IN}ms;
      will-change: transform, opacity;
    }
    .panel[data-open="1"] {
      visibility: visible; opacity: 1; transform: none;
      transition-delay: 0s, 0s, 0s;
    }
    /* Nội dung trôi vào chậm hơn khung một nhịp -> cảm giác "mở ra" thay vì "nhảy vào". */
    .panel > * {
      opacity: 0; transform: translateY(3px);
      transition: opacity .12s ease, transform .12s ease; /* nhịp fade-out, khỏi snap thành hộp rỗng */
    }
    .panel[data-open="1"] > * {
      opacity: 1; transform: none;
      transition: opacity .18s ease 60ms, transform .22s cubic-bezier(.22, 1.2, .36, 1) 60ms;
    }

    /* ---------------------------------------------------------- header */
    .head { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 10px; }
    .head-text { flex: 1; min-width: 0; }
    .term {
      font-size: 19px; font-weight: 650; letter-spacing: -.01em;
      margin: 0; line-height: 1.25; word-break: break-word;
    }
    .ipa {
      display: block; margin-top: 2px; font-size: 13px; color: #5a5470;
      font-family: "Charis SIL", "Doulos SIL", "Gentium Plus", "Segoe UI", Cambria, serif;
      letter-spacing: .01em;
    }
    .ipa:empty { display: none; }

    /* Đã có thẻ cho từ này */
    .saved-chip {
      display: inline-flex; align-items: center; margin-top: 4px;
      font-size: 10.5px; font-weight: 650; letter-spacing: .02em;
      color: #17916f; background: #dcf5ec; border-radius: 5px; padding: 2px 6px;
      cursor: help;
    }
    .saved-chip small { font-weight: 500; opacity: .8; }
    .saved-mark {
      display: block; font-size: 10.5px; font-weight: 650;
      color: #17916f; margin-top: 2px;
    }
    li.sense[data-saved="1"] { background: #f2fbf7; }
    li.sense[data-saved="1"] .gloss { opacity: .82; }
    .speak {
      flex: none; width: 32px; height: 32px; display: grid; place-items: center;
      border: 1px solid rgba(24, 16, 64, .14); border-radius: 50%;
      background: #fff; color: #6d4aff; cursor: pointer; padding: 0;
      transition: background .12s ease, transform .12s ease, border-color .12s ease;
    }
    .speak:hover { background: #f0ecff; border-color: #c9bcff; }
    .speak:active { transform: scale(.92); }
    .speak[data-playing="1"] { background: #6d4aff; border-color: #6d4aff; color: #fff; }
    .speak svg { width: 16px; height: 16px; }

    /* ------------------------------------------------- nghĩa theo loại từ */
    .body { max-height: 268px; overflow-y: auto; overscroll-behavior: contain; margin: 0 -4px 10px; padding: 0 4px; }
    .body::-webkit-scrollbar { width: 8px; }
    .body::-webkit-scrollbar-thumb { background: rgba(24,16,64,.16); border-radius: 4px; }

    .group + .group { margin-top: 11px; padding-top: 10px; border-top: 1px dashed rgba(24,16,64,.1); }
    .pos {
      display: inline-block; font-size: 10.5px; font-weight: 650; letter-spacing: .03em;
      text-transform: uppercase; color: #5a37f0; background: #efeaff;
      border-radius: 5px; padding: 2px 6px; margin: 0;
    }
    .pos-row { display: flex; align-items: center; gap: 6px; margin: 0 0 5px; }
    .pos-row .pos { margin: 0; }
    button.more {
      margin-left: auto; flex: none; font: inherit; font-size: 10.5px; cursor: pointer;
      border: 0; background: none; color: #6d4aff; padding: 1px 3px; border-radius: 4px;
      transition: background .1s ease;
    }
    button.more:hover { background: #f0ecff; text-decoration: underline; }

    .pos-en {
      font-size: 9.5px; font-weight: 500; text-transform: lowercase;
      letter-spacing: 0; opacity: .62; margin-left: 5px;
    }

    /* Mỗi loại từ một sắc riêng -> mắt nhận ra nhóm mà không cần đọc chữ. */
    .pos[data-pos="verb"]      { color: #0e7a5f; background: #dcf5ec; }
    .pos[data-pos="adjective"] { color: #a35a05; background: #fdeed6; }
    .pos[data-pos="adverb"]    { color: #9a2d6b; background: #fbe4f0; }
    .pos[data-pos="phrase"], .pos[data-pos="idiom"] { color: #4a5568; background: #eaedf3; }
    .pos[data-pos="primary"] { color: #0e7a5f; background: #dcf5ec; }

    /* Định nghĩa trong ngôn ngữ gốc (Google dt=md) - phụ trợ, đặt dưới badge loại từ. */
    .def {
      display: block; font-size: 11.5px; color: #6f6a80; margin: 0 0 5px;
      padding-left: 7px; border-left: 2px solid #e4e0f2;
    }
    .def i { font-style: italic; opacity: .9; }

    ol.senses { list-style: none; margin: 0; padding: 0; counter-reset: s; }
    li.sense {
      counter-increment: s; position: relative; cursor: pointer;
      padding: 4px 8px 4px 22px; border-radius: 7px; border: 1px solid transparent;
      transition: background .1s ease, border-color .1s ease;
    }
    li.sense::before {
      content: counter(s) "."; position: absolute; left: 6px; top: 4px;
      font-size: 11px; color: #a5a0b5; font-variant-numeric: tabular-nums;
    }
    li.sense:hover { background: #f6f5fb; }
    li.sense[aria-selected="true"] {
      background: #f0ecff; border-color: #c9bcff;
    }
    li.sense[aria-selected="true"]::before { content: "✓"; color: #6d4aff; font-weight: 700; }
    .gloss { display: block; font-size: 12.5px; }
    .ex {
      display: block; font-size: 11.5px; color: #6f6a80; font-style: italic;
      margin-top: 1px; padding-left: 7px; border-left: 2px solid #e4e0f2;
    }
    .syn { display: block; font-size: 11px; color: #6f6a80; margin-top: 2px; }
    .syn[title] { cursor: help; }
    .syn b { font-weight: 600; font-style: normal; }

    .ctx {
      font-size: 12px; color: #4a4558; background: #f6f5fb;
      border-left: 2px solid #d9d4f2; border-radius: 0 6px 6px 0;
      padding: 6px 8px; margin: 10px 0 0;
      max-height: 64px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    }
    .ctx mark { background: #ffe9a8; color: inherit; border-radius: 2px; padding: 0 1px; }
    .note { font-size: 11.5px; color: #6f6a80; margin: 0; }

    /* --------------------------------------------------------- skeleton */
    .sk { border-radius: 5px; background: linear-gradient(90deg, #eceaf5 25%, #f6f5fb 50%, #eceaf5 75%);
          background-size: 240% 100%; animation: shimmer 1.1s linear infinite; }
    @keyframes shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    .sk.l1 { height: 11px; width: 34%; margin-bottom: 9px; }
    .sk.l2 { height: 10px; width: 92%; margin-bottom: 6px; }
    .sk.l3 { height: 10px; width: 68%; }

    /* ----------------------------------------------------------- footer */
    .footwrap { display: block; }
    .foot { display: flex; gap: 8px; align-items: center; }
    .deck-slot { display: flex; gap: 6px; align-items: center; flex: 1; min-width: 0; }

    select.deck, input.deck-new {
      font: inherit; font-size: 12px; width: 100%; min-width: 0;
      padding: 5px 6px; border-radius: 8px; color: #1a1725; background: #fff;
      border: 1px solid rgba(24, 16, 64, .14);
    }
    select.deck:hover { background: #f4f2fd; }
    select.deck:focus-visible, input.deck-new:focus-visible {
      outline: 2px solid #6d4aff; outline-offset: 1px;
    }
    input.deck-new::placeholder { color: #a5a0b5; }
    button.act {
      font: inherit; font-size: 12px; cursor: pointer; border-radius: 8px;
      padding: 6px 10px; border: 1px solid rgba(24, 16, 64, .14); background: #fff; color: #1a1725;
      transition: background .12s ease;
    }
    button.act:hover { background: #f4f2fd; }
    button.act.primary { background: #6d4aff; border-color: #6d4aff; color: #fff; }
    button.act.primary:hover { background: #5a37f0; }
    button.act:disabled { opacity: .5; cursor: not-allowed; }
    button.act.icon-only { padding: 6px 8px; }
    .spacer { flex: 1; }
    .status {
      display: block; font-size: 10.5px; color: #6f6a80;
      text-align: right; margin-top: 6px; min-height: 13px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .status[data-kind="err"] { color: #c0344b; }
    .src { font-size: 10px; color: #a5a0b5; }
    .src[hidden] { display: none; }

    /* Trong lúc bám theo scroll thì tắt transition transform để không bị "trôi" trễ. */
    .icon[data-track="1"], .panel[data-track="1"] { transition-property: opacity, visibility; }

    @media (prefers-color-scheme: dark) {
      .panel { background: #1d1b26; color: #ece9f5; border-color: rgba(255,255,255,.12); }
      .ipa { color: #b3adc4; }
      .ex, .syn, .note, .status, .def { color: #9d97ad; }
      .def { border-left-color: #3b3550; }
      .ctx { background: #262330; color: #cdc8dc; border-left-color: #4a3f7d; }
      .ex { border-left-color: #3b3550; }
      button.act, .speak, select.deck, input.deck-new {
        background: #262330; color: #ece9f5; border-color: rgba(255,255,255,.14);
      }
      select.deck:hover { background: #2f2b3d; }
      button.act:hover { background: #2f2b3d; }
      button.act.primary { background: #6d4aff; border-color: #6d4aff; color: #fff; }
      .speak { color: #b7a5ff; }
      .speak:hover { background: #322c48; border-color: #4a3f7d; }
      .speak[data-playing="1"] { background: #6d4aff; border-color: #6d4aff; color: #fff; }
      .pos { color: #c3b2ff; background: #322c48; }
      .pos[data-pos="verb"]      { color: #7fd9bd; background: #1e3a33; }
      .pos[data-pos="adjective"] { color: #f0bd7a; background: #3b2f1c; }
      .pos[data-pos="adverb"]    { color: #f2a3cd; background: #3a2233; }
      .pos[data-pos="phrase"], .pos[data-pos="idiom"] { color: #b9c2d4; background: #2a2f3a; }
      .saved-chip { color: #7fd9bd; background: #1e3a33; }
      .saved-mark { color: #7fd9bd; }
      li.sense[data-saved="1"] { background: #1b2b28; }
      button.more { color: #b7a5ff; }
      button.more:hover { background: #322c48; }
      li.sense:hover { background: #262330; }
      li.sense[aria-selected="true"] { background: #322c48; border-color: #4a3f7d; }
      li.sense[aria-selected="true"]::before { color: #b7a5ff; }
      .group + .group { border-top-color: rgba(255,255,255,.1); }
      .sk { background: linear-gradient(90deg, #262330 25%, #302c3e 50%, #262330 75%); background-size: 240% 100%; }
      .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); }
    }
    @media (prefers-reduced-motion: reduce) {
      .icon, .panel, .panel > * {
        transform: none !important;
        transition: opacity 80ms linear, visibility 0s 80ms !important;
      }
      .icon[data-open="1"], .panel[data-open="1"], .panel[data-open="1"] > * {
        transition: opacity 80ms linear, visibility 0s 0s !important;
      }
    }
  `;

  const ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/>
      <path d="M9 7.5h6M9 11h4"/>
    </svg>`;

  function ensureUi() {
    if (root) return;

    host = document.createElement('div');
    host.id = 'remember-root';
    // Trang có thể có CSS ăn vào mọi thẻ div -> khoá lại vài thuộc tính quan trọng.
    host.style.cssText = 'all: initial; position: static;';
    host.setAttribute('data-remember', '');

    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLES;

    const layer = document.createElement('div');
    layer.className = 'layer';

    icon = document.createElement('button');
    icon.className = 'icon';
    icon.type = 'button';
    icon.title = 'Remember - tra & lưu thẻ';
    icon.setAttribute('aria-label', 'Remember: tra và lưu thẻ');
    icon.innerHTML = ICON_SVG;
    // mousedown: chặn trước khi trình duyệt xoá selection.
    icon.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    icon.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Remember');
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    root.append(style, layer, icon, panel);
    (document.body || document.documentElement).appendChild(host);
  }

  // ------------------------------------------------------- Selection helpers

  function isOurNode(node) {
    for (let n = node; n; n = n.parentNode || n.host) {
      if (n === host) return true;
      if (n.nodeType === 1 && n.hasAttribute?.('data-remember')) return true;
    }
    return false;
  }

  /** Rect cuối của vùng chọn (viewport coords), null nếu không lấy được. */
  function selectionRect(range) {
    const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height);
    const rect = rects.at(-1) || range.getBoundingClientRect();
    return rect && (rect.width || rect.height) ? rect : null;
  }

  /** Cắt lấy câu chứa `term` trong một đoạn văn bản đã chuẩn hoá khoảng trắng. */
  function sentenceAround(text, term) {
    const at = text.toLowerCase().indexOf(term.toLowerCase());
    if (at < 0) return text.slice(0, 220);

    // Mở rộng hai phía tới dấu kết câu gần nhất.
    const left = Math.max(0, text.lastIndexOf('. ', at), text.lastIndexOf('! ', at), text.lastIndexOf('? ', at));
    const rightRaw = text.slice(at).search(/[.!?](\s|$)/);
    const right = rightRaw < 0 ? text.length : at + rightRaw + 1;
    const sentence = text.slice(left ? left + 2 : 0, right).trim();
    return sentence.length > 320 ? sentence.slice(0, 320) + '…' : sentence;
  }

  /**
   * Ngữ cảnh khi đang đọc PDF trong viewer pdf.js (Firefox dùng nó làm viewer mặc
   * định; nhiều trang web cũng nhúng nó).
   *
   * Vì sao cần nhánh riêng: pdf.js dựng mỗi dòng chữ thành một `<span>` định vị tuyệt
   * đối trong `.textLayer`, nên "block cha" của một từ là CẢ TRANG. `innerText` của
   * cả trang thường vượt ngưỡng 4000 ký tự ⇒ nhánh thường trả về rỗng, và thẻ lưu từ
   * PDF sẽ không bao giờ có câu ngữ cảnh (mất luôn mode "điền vào câu").
   *
   * Ở đây lấy span chứa từ cộng hai span mỗi phía — đúng phạm vi một câu thường nằm
   * trong đó, và nối bằng dấu cách vì mỗi span là một dòng riêng.
   */
  function pdfLayerText(range) {
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const layer = node?.closest?.('.textLayer');
    if (!layer) return '';

    const spans = [...layer.children];
    // Span trực tiếp dưới `.textLayer` mới là "dòng"; selection có thể nằm trong thẻ
    // con (pdf.js bọc thêm <br>, <mark> khi tìm kiếm).
    let line = node;
    while (line && line.parentElement !== layer) line = line.parentElement;
    const at = spans.indexOf(line);
    const near = at < 0 ? spans : spans.slice(Math.max(0, at - 2), at + 3);
    return near.map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  }

  /** Câu chứa từ, lấy từ block cha gần nhất (FR-B1: context_sentence). */
  function contextSentence(range, term) {
    const fromPdf = pdfLayerText(range);
    if (fromPdf) return sentenceAround(fromPdf, term);

    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const block = node?.closest?.('p, li, td, dd, blockquote, h1, h2, h3, h4, figcaption, section, article, div');
    const text = (block?.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 4000) return '';
    return sentenceAround(text, term);
  }

  function pageLang() {
    const raw = document.documentElement.lang || document.querySelector('meta[http-equiv="content-language"]')?.content || '';
    return raw.trim().split(',')[0].split('-')[0].toLowerCase() || 'auto';
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (isOurNode(sel.anchorNode) || isOurNode(sel.focusNode)) return null;

    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 1000) return null;
    // Bỏ selection chỉ gồm dấu câu / khoảng trắng.
    if (!/[\p{L}\p{N}]/u.test(text)) return null;

    const range = sel.getRangeAt(0);
    const rect = selectionRect(range);
    if (!rect) return null;

    return { text, rect, range, lang: pageLang() };
  }

  // --------------------------------------------------------------- Placement

  /**
   * Đặt el cạnh rect, lật lên trên nếu tràn đáy viewport.
   * Đồng thời set --origin / --enter-y để hiệu ứng "mọc ra" từ đúng phía vùng chọn.
   */
  function place(node, rect, { width, height }) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + GAP;
    let top = rect.bottom + GAP;
    let flipY = false;
    let flipX = false;

    if (left + width > vw - 8) {
      left = Math.max(8, vw - width - 8);
      flipX = left < rect.right - width / 2;
    }
    if (top + height > vh - 8) {
      top = Math.max(8, rect.top - height - GAP); // lật lên trên
      flipY = true;
    }

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.style.setProperty('--origin', `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`);
    node.style.setProperty('--enter-y', flipY ? '6px' : '-6px');
  }

  function showIcon(sel) {
    ensureUi();
    const reopening = icon.dataset.open === '1';
    current = {
      text: sel.text,
      rect: sel.rect,
      lang: sel.lang,
      contextSentence: contextSentence(sel.range, sel.text),
    };
    cancelPendingClear();
    place(icon, sel.rect, { width: ICON_SIZE, height: ICON_SIZE });

    if (reopening) return; // đang hiện rồi -> chỉ dịch chỗ, không chạy lại animation
    // Ép reflow để trình duyệt nhận trạng thái đóng trước khi bật mở,
    // nếu không thì icon vừa ẩn xong hiện lại sẽ nhảy thẳng, mất animation.
    void icon.offsetWidth;
    icon.dataset.open = '1';
  }

  /** Xoá nội dung panel bị hoãn tới khi fade-out xong, nếu không panel sẽ trống giữa lúc mờ dần. */
  let clearTimer = 0;
  function cancelPendingClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = 0; }
  }

  function hideAll() {
    if (!root) return;
    if (icon.dataset.open !== '1' && panel.dataset.open !== '1') return;
    icon.dataset.open = '';
    panel.dataset.open = '';
    current = null;
    panelToken++;                     // kết quả về sau khi đóng thì bỏ
    // Đừng để giọng đọc tiếp sau khi panel biến mất.
    window.speechSynthesis?.cancel();
    chrome.runtime?.sendMessage?.({ type: 'STOP_SPEAK' }).catch(() => {});
    cancelPendingClear();
    clearTimer = setTimeout(() => {
      clearTimer = 0;
      if (panel.dataset.open !== '1') panel.textContent = '';
    }, PANEL_IN + 40);
  }

  // ------------------------------------------------------------------- Panel

  /** Nhãn tiếng Việt cho loại từ. Provider đã chuẩn hoá về khoá tiếng Anh. */
  const POS_LABEL = {
    noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ',
    pronoun: 'đại từ', preposition: 'giới từ', conjunction: 'liên từ',
    interjection: 'thán từ', determiner: 'từ hạn định', numeral: 'số từ',
    phrase: 'cụm từ', idiom: 'thành ngữ', abbreviation: 'viết tắt', affix: 'phụ tố',
  };

  /**
   * Dạng chuẩn hoá của bộ nghĩa — PHẢI giống hệt `senseKey()` ở server
   * (apps/web/lib/domain/day.ts) và ở sync.js, nếu không sẽ báo "đã lưu" sai.
   */
  function senseKey(list) {
    return (list || [])
      .map((x) => String(x).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort()
      .join('|');
  }

  /** Nghĩa này đã nằm trong một thẻ cùng loại từ chưa? */
  function savedSense(gloss, pos) {
    const g = senseKey([gloss]);
    return existing.some(
      (c) => (c.pos ?? '') === (pos ?? '') && senseKey(c.back).split('|').includes(g),
    );
  }

  /** Đúng bộ nghĩa đang chọn đã có thẻ chưa? (khớp khoá dedupe của server) */
  function savedExactly() {
    if (!picked.size) return null;
    const key = senseKey([...picked]);
    return existing.find((c) => (c.pos ?? '') === (pickedPos ?? '') && c.backKey === key) ?? null;
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const SPEAK_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7"/>
      <path d="M19 5.5a8 8 0 0 1 0 13"/>
    </svg>`;

  /** Nghĩa người dùng đang chọn để làm mặt sau của thẻ: Set các chuỗi gloss. */
  let picked = new Set();
  /** Loại từ của nghĩa vừa tick — một phần của khoá dedupe, phải gửi kèm khi lưu. */
  let pickedPos = null;
  /** Kết quả tra gần nhất cho selection hiện tại. */
  let lookupResult = null;
  /** Thẻ ĐÃ CÓ của từ này (từ API). Dùng để hiện "đã lưu" ngay khi tra. */
  let existing = [];
  /**
   * Token chống race cho CẢ panel. Chỉ tăng khi MỞ panel mới hoặc đóng panel.
   * Mọi tác vụ async (tra từ, lấy thẻ đã có) chỉ ĐỌC để so, KHÔNG tăng — nếu tăng
   * thì chúng làm nhau lỗi thời và kết quả bị bỏ im lặng, panel treo ở skeleton.
   */
  let panelToken = 0;
  /** Danh sách deck và deck đang chọn để lưu thẻ. */
  let decks = [];
  let selectedDeckId = null;

  function openPanel() {
    if (!current) return;
    panelToken++;   // một lượt mở = một token; các tác vụ async so với nó
    picked = new Set();
    pickedPos = null;
    lookupResult = null;
    existing = [];

    panel.textContent = '';
    panel.append(buildHeader(), buildBody('loading'), buildFooter());
    showPanel();
    startLookup();
    loadDecks();      // song song với lookup, không chờ nhau
    loadExisting();   // và cũng không chờ lookup — biết "đã lưu" càng sớm càng tốt
  }

  // ------------------------------------------------------------ các mảnh UI

  function buildHeader() {
    const head = el('div', 'head');
    const textWrap = el('div', 'head-text');
    textWrap.append(el('p', 'term', current.text));
    textWrap.append(el('span', 'ipa', '')); // điền khi có phiên âm
    head.append(textWrap);

    const speak = el('button', 'speak');
    speak.type = 'button';
    speak.title = 'Đọc thành tiếng';
    speak.setAttribute('aria-label', 'Đọc thành tiếng');
    speak.innerHTML = SPEAK_SVG; // hằng số nội bộ, không phải dữ liệu ngoài
    speak.addEventListener('click', (e) => { e.stopPropagation(); speakTerm(speak); });
    head.append(speak);
    return head;
  }

  function buildBody(state) {
    const body = el('div', 'body');
    if (state === 'loading') {
      body.append(el('div', 'sk l1'), el('div', 'sk l2'), el('div', 'sk l3'));
    }
    if (current.contextSentence) body.append(buildContext());
    return body;
  }

  /** Câu ngữ cảnh, tô sáng từ được chọn - dựng bằng DOM nên không cần escape. */
  function buildContext() {
    const box = el('div', 'ctx');
    const s = current.contextSentence;
    const at = s.toLowerCase().indexOf(current.text.toLowerCase());
    if (at < 0) {
      box.textContent = s;
    } else {
      box.append(
        document.createTextNode(s.slice(0, at)),
        el('mark', null, s.slice(at, at + current.text.length)),
        document.createTextNode(s.slice(at + current.text.length)),
      );
    }
    return box;
  }

  function buildFooter() {
    const wrap = el('div', 'footwrap');
    const foot = el('div', 'foot');

    const save = el('button', 'act primary', '＋ Lưu thẻ');
    save.type = 'button';
    save.dataset.act = 'save';
    if (current.text.length > MAX_CARD_LEN) {
      save.disabled = true;
      save.title = `Quá ${MAX_CARD_LEN} ký tự - chỉ tra, không tạo thẻ`;
    } else {
      save.addEventListener('click', saveCard);
    }

    const copy = el('button', 'act icon-only', '⧉');
    copy.type = 'button';
    copy.title = 'Sao chép từ';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(current.text);
        setStatus('đã sao chép');
      } catch {
        setStatus('không sao chép được', 'err');
      }
    });

    const deckSlot = el('div', 'deck-slot');
    deckSlot.dataset.role = 'deck';

    const status = el('span', 'status');
    status.dataset.role = 'status';

    foot.append(save, copy, deckSlot);
    wrap.append(foot, status);
    return wrap;
  }

  // ------------------------------------------------------------------- decks

  /** Deck nguồn từ API (service worker lo cache + đường lùi local). */
  let deckSource = 'api';
  let deckStale = false;

  async function loadDecks() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_DECKS' });
      if (!res?.ok || !res.decks?.length) return;
      decks = res.decks;
      deckSource = res.source ?? 'api';
      deckStale = Boolean(res.stale);
      // Mặc định là deck ĐẦU TIÊN, mỗi lần mở panel đều reset về nó.
      selectedDeckId = decks[0].id;
      renderDeckPicker();
    } catch { /* mất kết nối SW: ẩn picker, lưu thẻ sẽ tự dùng deck đầu tiên */ }
  }

  const NEW_DECK = '__new__';

  function renderDeckPicker() {
    const slot = panel?.querySelector('[data-role="deck"]');
    if (!slot) return;
    slot.textContent = '';

    const sel = el('select', 'deck');
    sel.title = deckStale
      ? 'Deck từ bộ nhớ đệm — chưa gọi được server'
      : 'Deck từ tài khoản';
    if (deckStale) sel.dataset.stale = '1';
    for (const d of decks) {
      // Hiện luôn số đến hạn / thẻ mới nếu API trả về.
      const counts = d.due != null && d.fresh != null ? ` (${d.due}/${d.fresh})` : '';
      const opt = el('option', null, d.name + counts);
      opt.value = d.id;
      if (d.id === selectedDeckId) opt.selected = true;
      sel.append(opt);
    }
    const newOpt = el('option', null, '＋ Deck mới…');
    newOpt.value = NEW_DECK;
    sel.append(newOpt);

    sel.addEventListener('change', () => {
      if (sel.value === NEW_DECK) renderDeckInput();
      else selectedDeckId = sel.value;
    });
    slot.append(sel);
  }

  /** Đổi picker thành ô nhập tên deck mới, ngay tại chỗ. */
  function renderDeckInput() {
    const slot = panel?.querySelector('[data-role="deck"]');
    if (!slot) return;
    slot.textContent = '';

    const input = el('input', 'deck-new');
    input.type = 'text';
    input.placeholder = 'Tên deck mới';
    input.maxLength = 60;

    const ok = el('button', 'act icon-only', '✓');
    ok.type = 'button';
    ok.title = 'Tạo deck';

    const cancel = el('button', 'act icon-only', '✕');
    cancel.type = 'button';
    cancel.title = 'Huỷ';
    cancel.addEventListener('click', renderDeckPicker);

    const submit = async () => {
      const name = input.value.trim();
      if (!name) return renderDeckPicker();
      ok.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({ type: 'CREATE_DECK', payload: { name } });
        if (res?.ok) {
        // Ghi nhận ngay để nếu người dùng mở lại panel thì thấy "đã lưu".
        existing.push({
          id: res.id ?? null,
          pos: pos ?? null,
          back,
          backKey: senseKey(back),
          deckName: res.deckName ?? null,
        });
          // Service worker đã làm mới danh sách; lấy lại rồi chọn deck vừa tạo.
          const list = await chrome.runtime.sendMessage({ type: 'GET_DECKS' });
          decks = list?.decks ?? decks;
          selectedDeckId = res.deck?.id ?? selectedDeckId;
          deckStale = Boolean(list?.stale);
          renderDeckPicker();
          setStatus(res.existed ? 'deck đã tồn tại, đã chọn' : `đã tạo deck "${res.deck?.name}"`);
        } else {
          ok.disabled = false;
          setStatus(res?.error || 'không tạo được deck', 'err');
        }
      } catch {
        ok.disabled = false;
        setStatus('mất kết nối extension', 'err');
      }
      reflowPanel();
    };

    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                       // Esc/Enter là của ô nhập, không phải của panel
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') renderDeckPicker();
    });

    slot.append(input, ok, cancel);
    input.focus({ preventScroll: true });
    reflowPanel();
  }

  /** Số nghĩa hiện trong một loại từ khi chưa mở rộng (mỗi nghĩa 1 dòng dịch ngược). */
  const SENSES_VISIBLE = 3;
  /** Số mục trong một dòng dịch ngược / đồng nghĩa khi chưa mở rộng. */
  const LIST_VISIBLE = 3;

  /**
   * Một nhóm loại từ. Hàng đầu là badge loại từ; nếu có mục bị cắt bớt thì
   * nút "xem thêm / thu gọn" nằm ngay trên hàng đó, canh phải.
   */
  function buildGroup(group) {
    const g = el('div', 'group');

    const posRow = el('div', 'pos-row');
    if (group.isPrimary) {
      const badge = el('span', 'pos', 'bản dịch chính');
      badge.dataset.pos = 'primary';
      posRow.append(badge);
    }
    if (group.pos) {
      const vi = POS_LABEL[group.pos];
      const raw = group.posRaw || group.pos;
      const badge = el('span', 'pos', vi || raw);
      badge.dataset.pos = group.pos;
      // Giữ loại từ gốc bên cạnh: đối chiếu được với từ điển khác, và khi
      // POS_LABEL chưa có nhãn tiếng Việt thì vẫn không mất thông tin.
      if (vi && raw.toLowerCase() !== vi.toLowerCase()) {
        badge.append(el('small', 'pos-en', raw));
      }
      posRow.append(badge);
    }

    if (group.definition?.gloss) {
      const def = el('span', 'def', group.definition.gloss);
      if (group.definition.example) def.append(el('i', null, ` — “${group.definition.example}”`));
      g.append(def);
    }

    // Các danh sách bị cắt bớt; toggle sẽ viết lại nội dung của chúng.
    const trimmed = [];

    const ol = el('ol', 'senses');
    const hiddenSenses = [];
    const senses = group.senses || [];

    senses.forEach((sense, i) => {
      const li = el('li', 'sense');
      li.setAttribute('aria-selected', 'false');
      // Quá SENSES_VISIBLE thì ẩn cả nghĩa - vẫn nằm trong DOM để toggle chỉ cần bật/tắt.
      if (i >= SENSES_VISIBLE) {
        li.hidden = true;
        hiddenSenses.push(li);
      }
      li.append(el('span', 'gloss', sense.gloss));
      if (sense.example) li.append(el('span', 'ex', `“${sense.example}”`));

      // "Dịch ngược": các từ gốc cũng cho ra nghĩa này -> dùng để kiểm chứng
      // mình đang hiểu đúng sắc thái nào của từ (FR-A1).
      addList(li, trimmed, sense.reverse, 'dịch ngược: ',
        'Các từ gốc cũng dịch thành nghĩa này — dùng để kiểm chứng đúng sắc thái');
      addList(li, trimmed, sense.synonyms, 'đồng nghĩa: ', null);

      li.addEventListener('click', () => togglePick(li, sense.gloss, group.pos));
      ol.append(li);
    });

    if (trimmed.length || hiddenSenses.length) {
      posRow.append(buildToggle(trimmed, hiddenSenses));
    }
    if (posRow.childNodes.length) g.prepend(posRow);
    g.append(ol);
    return g;
  }

  /** Thêm một dòng danh sách, cắt còn LIST_VISIBLE mục và ghi nhận nếu bị cắt. */
  function addList(li, trimmed, items, label, tip) {
    if (!items?.length) return;
    const row = el('span', 'syn');
    if (tip) row.title = tip;
    const textNode = document.createTextNode(items.slice(0, LIST_VISIBLE).join(', '));
    row.append(el('b', null, label), textNode);
    li.append(row);
    if (items.length > LIST_VISIBLE) trimmed.push({ textNode, items });
  }

  function buildToggle(trimmed, hiddenSenses) {
    const extraItems = trimmed.reduce((n, t) => n + t.items.length - LIST_VISIBLE, 0);
    const total = extraItems + hiddenSenses.length;
    const label = `xem thêm ${total}`;

    const btn = el('button', 'more', label);
    btn.type = 'button';
    btn.dataset.open = '';

    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // đừng để click lan xuống li.sense -> tick chọn nghĩa
      const open = btn.dataset.open === '1';
      for (const t of trimmed) {
        t.textNode.textContent = (open ? t.items.slice(0, LIST_VISIBLE) : t.items).join(', ');
      }
      for (const li of hiddenSenses) li.hidden = open;
      btn.dataset.open = open ? '' : '1';
      btn.textContent = open ? label : 'thu gọn';
      reflowPanel();
    });
    return btn;
  }

  /** Render các nhóm nghĩa theo loại từ. */
  function renderResult(result) {
    const body = panel.querySelector('.body');
    if (!body) return;
    body.textContent = '';

    const ipa = panel.querySelector('.ipa');
    if (result.reading) {
      // IPA theo quy ước ngôn ngữ học đặt trong /.../; chuyển tự (romaji, pinyin) thì không.
      ipa.textContent = result.readingType === 'ipa' ? `/${result.reading}/` : result.reading;
      ipa.title = result.readingType === 'ipa' ? 'Phiên âm IPA' : 'Chuyển tự';
    } else {
      ipa.remove();
    }

    for (const group of result.groups || []) {
      body.append(buildGroup(group));
    }

    // Chọn sẵn nghĩa đầu tiên -> lưu thẻ 1 click là xong.
    const firstGroup = result.groups.find((g) => g.senses?.length);
    const first = body.querySelector('li.sense');
    if (first && firstGroup) togglePick(first, firstGroup.senses[0].gloss, firstGroup.pos);

    if (current.contextSentence) body.append(buildContext());

    const status = panel.querySelector('[data-role="status"]');
    if (status) {
      const pair = result.detectedLang ? `${result.detectedLang} → vi · ` : '';
      const via = result.reading && result.providerId !== 'freedictionaryapi.com'
        ? `${result.providerId} + Wiktionary`   // IPA/định nghĩa đến từ freedictionaryapi
        : result.providerId;
      status.textContent = `${pair}${via}${result.fromCache ? ' · cache' : ''}`;
      // Ghi công giấy phép là bắt buộc với dữ liệu Wiktionary (CC BY-SA).
      status.title = result.license ? `Nguồn: ${result.license}` : `Nguồn: ${result.providerId}`;
      status.dataset.kind = '';
    }
    // Hai việc phụ này KHÔNG được làm chết phần render nghĩa. Trước đây
    // updateSaveButton() ném ReferenceError và panel treo ở skeleton — trông như
    // không gọi được API dịch, trong khi kết quả đã về đầy đủ.
    try {
      renderExistingBadge();
      updateSaveButton();
    } catch (e) {
      console.warn('[Remember] lỗi khi vẽ trạng thái "đã lưu":', e);
    }
    reflowPanel();
  }

  /** Nút Lưu đổi theo bộ nghĩa đang chọn: trùng hoàn toàn thì không cho lưu lại. */
  function updateSaveButton() {
    const btn = panel?.querySelector('[data-act="save"]');
    if (!btn || !current) return;
    const dup = savedExactly();
    if (dup) {
      btn.disabled = true;
      btn.textContent = '✓ đã lưu';
      btn.title = `Đã có thẻ này${dup.deckName ? ` trong "${dup.deckName}"` : ''}`;
    } else {
      btn.disabled = current.text.length > MAX_CARD_LEN;
      btn.textContent = '＋ Lưu thẻ';
      btn.title = '';
    }
  }

  function renderLookupError(res) {
    const body = panel.querySelector('.body');
    if (!body) return;
    body.textContent = '';
    const why = (res?.attempts || []).map((a) => `${a.id}: ${a.reason}`).join(' · ');
    body.append(el('p', 'note', 'Không tra được nghĩa. Vẫn lưu được thẻ với mặt sau trống để điền sau.'));
    if (why) body.append(el('p', 'note', why));
    if (current.contextSentence) body.append(buildContext());
    reflowPanel();
  }

  function togglePick(li, gloss, pos) {
    const on = li.getAttribute('aria-selected') === 'true';
    li.setAttribute('aria-selected', on ? 'false' : 'true');
    if (on) picked.delete(gloss);
    else {
      picked.add(gloss);
      pickedPos = pos ?? null;
    }
    li.dataset.pos = pos || '';
    updateSaveButton();
  }

  // ------------------------------------------------------ mở / đo / đặt chỗ

  function showPanel() {
    // Đo trong lúc panel còn ẩn (visibility: hidden vẫn có layout), đặt đúng chỗ, rồi mới mở
    // -> animation chạy tại vị trí cuối, không "bay" ngang.
    cancelPendingClear();
    panel.style.left = '-9999px';
    panel.style.top = '0px';
    const box = panel.getBoundingClientRect();
    place(panel, current.rect, { width: box.width, height: box.height });
    void panel.offsetWidth;
    panel.dataset.open = '1';
    requestAnimationFrame(() => panel.querySelector('[data-act="save"]')?.focus({ preventScroll: true }));
  }

  /** Nội dung đổi chiều cao (loading -> kết quả) thì đặt lại chỗ, tránh tràn đáy viewport. */
  function reflowPanel() {
    if (!current || panel.dataset.open !== '1') return;
    const box = panel.getBoundingClientRect();
    place(panel, current.rect, { width: box.width, height: box.height });
  }

  function setStatus(msg, kind) {
    const node = panel?.querySelector('[data-role="status"]');
    if (!node) return;
    node.textContent = msg;
    node.dataset.kind = kind || '';
  }

  /**
   * Thẻ đã có của từ này. Gọi ngay khi mở panel, KHÔNG chờ kết quả tra từ —
   * người dùng nên biết "đã lưu" trước khi kịp đọc hết nghĩa.
   */
  async function loadExisting() {
    // Dùng CHUNG token của panel, KHÔNG tăng nó: tăng ở đây thì kết quả tra từ
    // của startLookup() bị chính hàm này làm cho "lỗi thời" và bị bỏ,
    // panel treo mãi ở skeleton.
    const token = panelToken;
    const text = current?.text;
    if (!text) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GET_EXISTING',
        payload: { front: text, langFrom: current.lang, langTo: 'vi' },
      });
      // Selection đã đổi trong lúc chờ -> bỏ kết quả.
      if (token !== panelToken || panel.dataset.open !== '1') return;
      if (res?.ok) {
        existing = res.cards ?? [];
        renderExistingBadge();
        updateSaveButton();
        // Kết quả tra đã render trước đó -> vẽ lại để tô nghĩa đã lưu.
        if (lookupResult) renderResult(lookupResult);
      }
    } catch { /* chưa kết nối tài khoản hoặc mất mạng: bỏ qua, không phá luồng tra */ }
  }

  /** Chip ở header: từ này đã có bao nhiêu thẻ, ở deck nào. */
  function renderExistingBadge() {
    const head = panel?.querySelector('.head-text');
    if (!head) return;
    head.querySelector('.saved-chip')?.remove();
    if (!existing.length) return;

    const decks = [...new Set(existing.map((c) => c.deckName).filter(Boolean))];
    const chip = el('span', 'saved-chip',
      existing.length === 1 ? '✓ đã lưu' : `✓ đã lưu ${existing.length} thẻ`);
    chip.title = existing
      .map((c) => `${c.pos ?? '—'}: ${c.back.join(', ')}${c.deckName ? ` @${c.deckName}` : ''}`)
      .join('\n');
    if (decks.length === 1) chip.append(el('small', null, ` · ${decks[0]}`));
    head.append(chip);
  }

  // ------------------------------------------------------------------ lookup

  async function startLookup() {
    const token = panelToken;
    const req = { text: current.text, langFrom: current.lang, langTo: 'vi' };
    try {
      const res = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload: req });
      if (token !== panelToken || panel.dataset.open !== '1') return; // selection đã đổi
      if (res?.ok && res.result?.groups?.length) {
        lookupResult = res.result;
        renderResult(res.result);
        autoSpeak();
      } else {
        renderLookupError(res);
      }
    } catch {
      if (token !== panelToken) return;
      renderLookupError({ attempts: [{ id: 'extension', reason: 'mất kết nối service worker' }] });
    }
  }

  // --------------------------------------------------------------------- TTS

  /**
   * Phát âm NGAY khi kết quả dịch hiện ra, không cần bấm nút loa.
   *
   * Chạy được dù browser chặn autoplay: panel chỉ mở sau một cú click vào icon hoặc
   * một lần bấm menu chuột phải, nên đã có tương tác của người dùng đứng trước —
   * autoplay policy chỉ chặn audio không có tương tác nào trước đó.
   *
   * Đọc `current.text` (từ gốc), KHÔNG đọc nghĩa tiếng Việt: cái cần nhớ cách đọc là
   * từ đó. Gọi SAU `renderResult` để `lookupResult.detectedLang` đã có — nếu không
   * `speakTerm()` sẽ đoán ngôn ngữ và đọc từ tiếng Anh bằng giọng Việt.
   *
   * Ba điều kiện, cả ba đều để tránh phát ra tiếng vào lúc không ai muốn:
   *  - panel còn đang mở (kết quả về muộn sau khi đã đóng thì im);
   *  - có nút loa trong panel (dùng lại nó để hiện trạng thái đang phát);
   *  - đoạn chọn ngắn hơn `AUTO_SPEAK_MAX`.
   */
  function autoSpeak() {
    if (!current || !root || panel.dataset.open !== '1') return;
    if (current.text.length > AUTO_SPEAK_MAX) return;
    const btn = panel.querySelector('.speak');
    if (!btn) return;
    speakTerm(btn);
  }

  /**
   * Ưu tiên giọng của translate.google.com (nữ, tự nhiên) qua service worker;
   * thất bại thì lùi về Web Speech API - miễn phí, offline, nhưng dùng giọng của OS.
   */
  async function speakTerm(btn) {
    const lang = lookupResult?.detectedLang || (current.lang !== 'auto' ? current.lang : 'en');
    window.speechSynthesis?.cancel();
    btn.dataset.playing = '1';
    const done = () => { btn.dataset.playing = ''; };

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SPEAK',
        payload: { text: current.text, lang },
      });
      done();
      if (res?.ok) return;
      speakFallback(btn, lang, res?.error);
    } catch {
      done();
      speakFallback(btn, lang, 'mất kết nối service worker');
    }
  }

  /** Danh sách giọng nữ theo tên - Web Speech API không có cờ giới tính. */
  const FEMALE_HINTS = [
    'zira', 'hazel', 'susan', 'linda', 'heera', 'catherine',   // Windows
    'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'ava', 'allison', // macOS
    'female', 'nữ', 'hoaimy', 'hoai my', 'linh',               // vi
    'google us english', 'google uk english female',
  ];

  function pickVoice(synth, lang) {
    const base = lang.split('-')[0].toLowerCase();
    const forLang = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(base));
    const female = forLang.find((v) => FEMALE_HINTS.some((h) => v.name?.toLowerCase().includes(h)));
    return female || forLang[0] || null;
  }

  function speakFallback(btn, lang, why) {
    const synth = window.speechSynthesis;
    if (!synth) return setStatus(why || 'không đọc được', 'err');

    const u = new SpeechSynthesisUtterance(current.text);
    u.lang = lang.length === 2 ? { en: 'en-US', vi: 'vi-VN' }[lang] || lang : lang;
    u.rate = 0.92;

    // getVoices() có thể rỗng ở lần gọi đầu -> chờ voiceschanged rồi thử lại.
    const speakNow = () => {
      const voice = pickVoice(synth, lang);
      if (voice) u.voice = voice;
      btn.dataset.playing = '1';
      const done = () => { btn.dataset.playing = ''; };
      u.addEventListener('end', done);
      u.addEventListener('error', () => { done(); setStatus('không đọc được', 'err'); });
      synth.speak(u);
      setStatus('giọng hệ thống (Google TTS lỗi)');
    };

    if (synth.getVoices().length) speakNow();
    else synth.addEventListener('voiceschanged', speakNow, { once: true });
  }

  // -------------------------------------------------------------- lưu thẻ

  async function saveCard() {
    if (!current) return;
    const btn = panel.querySelector('[data-act="save"]');
    btn.disabled = true;
    setStatus('đang lưu…');

    // Nghĩa đã chọn; nếu người dùng bỏ chọn hết thì lấy nghĩa chính.
    const back = picked.size ? [...picked] : (lookupResult?.primary ? [lookupResult.primary] : []);
    const pos = pickedPos;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SAVE_CARD',
        payload: {
          front: current.text,
          back,
          reading: lookupResult?.reading || '',
          readingType: lookupResult?.readingType || null,
          pos,
          deckId: selectedDeckId,
          langFrom: current.lang,
          langTo: 'vi',
          contextSentence: current.contextSentence,
          sourceUrl: location.href,
          sourceTitle: document.title,
        },
      });
      if (res?.ok) {
        // Ghi nhận ngay để nếu người dùng mở lại panel thì thấy "đã lưu".
        existing.push({
          id: res.id ?? null,
          pos: pos ?? null,
          back,
          backKey: senseKey(back),
          deckName: res.deckName ?? null,
        });
        // Nói rõ thẻ đã lên server hay chỉ nằm ở máy này — im lặng thì người dùng
        // tưởng đã đồng bộ rồi mất dữ liệu khi đổi máy.
        const REASON = {
          no_permission: 'chỉ lưu trên máy · chưa kết nối tài khoản',
          logged_out: 'chỉ lưu trên máy · chưa đăng nhập web',
          network: 'chỉ lưu trên máy · sẽ đẩy lại sau',
          server: 'chỉ lưu trên máy · server lỗi',
        };
        const tail = res.sync?.synced ? ' ☁' : ` · ${REASON[res.sync?.reason] ?? 'chưa đồng bộ'}`;

        setStatus(res.duplicate
          ? `thẻ đã có sẵn${res.deckName ? ` trong "${res.deckName}"` : ''}`
          : `đã lưu vào "${res.deckName}"${tail}`);
        setTimeout(hideAll, res.sync?.synced ? 900 : 1800);
      } else {
        btn.disabled = false;
        setStatus(res?.error || 'lưu thất bại', 'err');
      }
    } catch {
      // SW vừa bị kill / extension vừa reload -> context mất hiệu lực.
      btn.disabled = false;
      setStatus('mất kết nối extension, thử lại', 'err');
    }
  }

  // -------------------------------------------- mở panel không cần selection

  /**
   * Rect giả để neo panel khi KHÔNG có vùng chọn nào đọc được: **trên cùng bên phải**.
   *
   * Dùng cho viewer PDF tích hợp của Chrome: PDF được vẽ bởi plugin trong một
   * `<embed>`, nên `window.getSelection()` ở tài liệu này luôn rỗng — không có cách
   * nào lấy vùng chọn hay toạ độ của nó. Nhưng tài liệu bọc ngoài VẪN chạy content
   * script, nên panel vẫn hiện được; chỉ là neo ở góc thay vì cạnh con chữ.
   *
   * Đặt `right` bằng đúng bề rộng viewport để `place()` kẹp panel sát mép phải (nó
   * tự lùi vào 8px), và `bottom` sát mép trên. `place()` cũng vì thế đặt
   * `--origin: top right`, nên panel "mọc ra" từ đúng góc nó đứng.
   */
  function topRightRect() {
    const x = window.innerWidth;
    return { left: x, right: x, top: 8, bottom: 8, width: 0, height: 0 };
  }

  /**
   * Service worker yêu cầu mở panel cho một từ (từ menu chuột phải).
   *
   * HAI ĐƯỜNG, và luôn ưu tiên đường thứ nhất:
   *
   *  1. **Đọc được vùng chọn thật** (trang web thường, PDF trong pdf.js) — đi ĐÚNG
   *     luồng bôi đen: `showIcon()` + `openPanel()`. Nhờ vậy panel neo cạnh con chữ,
   *     có câu ngữ cảnh, và hành vi giống hệt khi bôi đen — không phải một luồng thứ
   *     hai trông khác đi vì được gọi từ menu.
   *  2. **Không đọc được** (viewer PDF tích hợp của Chrome: plugin vẽ trong `<embed>`
   *     nên `getSelection()` luôn rỗng) — dùng chữ mà BROWSER đưa sang và neo panel
   *     ở góc trên bên phải.
   *
   * Phải `reply()` đúng kết quả: service worker lùi về "lưu thẻ thô" khi không mở
   * được panel, nên báo `ok` sai sẽ cho ra thẻ trống mà người dùng không hề biết —
   * đúng cái nhìn ra ngoài như "bấm mà không có gì xảy ra".
   */
  chrome.runtime?.onMessage?.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'SHOW_LOOKUP') return false;

    const text = String(msg.payload?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 1000) {
      reply({ ok: false, error: 'không có chữ để tra' });
      return false;
    }

    try {
      ensureUi();
      const sel = readSelection();
      if (sel) {
        // Có vùng chọn: dùng CHÍNH nó (chữ, toạ độ, câu ngữ cảnh) — dữ liệu của nó
        // luôn tốt hơn `info.selectionText` của menu, thứ đã bị cắt khoảng trắng.
        showIcon(sel);
        openPanel();
      } else {
        hideAll();
        current = {
          text,
          rect: topRightRect(),
          lang: pageLang(),
          // Plugin PDF không cho đọc chữ quanh vùng chọn ⇒ không có câu ngữ cảnh.
          // Thà để trống còn hơn bịa ra một câu không có trong tài liệu.
          contextSentence: '',
        };
        openPanel();
      }
      reply({ ok: true });
    } catch (e) {
      reply({ ok: false, error: String(e?.message || e) });
    }
    return false;
  });

  // ------------------------------------------------------------------ Events

  let raf = 0;
  function scheduleCheck() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // Panel đang mở: giữ nguyên, người dùng đang tương tác với nó.
      if (root && panel.dataset.open === '1') return;
      const sel = readSelection();
      if (sel) showIcon(sel);
      else hideAll();
    });
  }

  document.addEventListener('mouseup', (e) => {
    if (root && isOurNode(e.target)) return;
    scheduleCheck();
  }, true);

  // Bôi đen bằng bàn phím (Shift+mũi tên, Ctrl+A) và double-click 1 từ.
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow') || (e.ctrlKey && e.key.toLowerCase() === 'a')) scheduleCheck();
  }, true);
  document.addEventListener('dblclick', scheduleCheck, true);

  document.addEventListener('selectionchange', () => {
    if (root && panel.dataset.open === '1') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideAll();
  });

  document.addEventListener('mousedown', (e) => {
    if (root && isOurNode(e.target)) return;
    hideAll();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideAll();
  }, true);

  // Cuộn/resize: bám theo vùng chọn thay vì biến mất.
  let trackTimer = 0;
  let trackRaf = 0;
  const reposition = () => {
    if (!current || !root || icon.dataset.open !== '1') return;

    // data-track tắt transition transform trong lúc cuộn; bật lại sau khi cuộn dừng.
    icon.dataset.track = '1';
    panel.dataset.track = '1';
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => {
      if (!root) return;
      icon.dataset.track = '';
      panel.dataset.track = '';
    }, 120);

    // Gộp nhiều event scroll vào 1 frame - getClientRects() là thao tác gây reflow.
    cancelAnimationFrame(trackRaf);
    trackRaf = requestAnimationFrame(() => {
      if (!current || !root || icon.dataset.open !== '1') return;
      const sel = readSelection();
      if (!sel) return hideAll();
      current.rect = sel.rect;
      place(icon, sel.rect, { width: ICON_SIZE, height: ICON_SIZE });
      if (panel.dataset.open === '1') {
        const box = panel.getBoundingClientRect();
        place(panel, sel.rect, { width: box.width, height: box.height });
      }
    });
  };
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  window.addEventListener('resize', reposition, { passive: true });
})();
