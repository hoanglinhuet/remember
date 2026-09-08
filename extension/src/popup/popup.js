/**
 * Remember — popup: danh sách thẻ gần nhất.
 *
 * Nguồn dữ liệu: **API** khi đã kết nối tài khoản; lùi về bản local khi chưa kết nối
 * hoặc mất mạng. Mọi node dựng bằng DOM API, không innerHTML.
 */

const POS_LABEL = {
  noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ',
  pronoun: 'đại từ', preposition: 'giới từ', conjunction: 'liên từ',
  interjection: 'thán từ', determiner: 'từ hạn định', numeral: 'số từ',
  phrase: 'cụm từ', idiom: 'thành ngữ', abbreviation: 'viết tắt', affix: 'phụ tố',
};

const listEl = document.querySelector('[data-role="list"]');
const countEl = document.querySelector('[data-role="count"]');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

try {
  const v = chrome.runtime.getManifest().version;
  document.querySelector('h1').append(el('span', 'ver', ` v${v}`));
} catch { /* ignore */ }

/** Xuất toàn bộ thẻ local ra file JSON (sao lưu). */
async function exportAll(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'đang xuất…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_ALL' });
    if (!res?.ok) throw new Error(res?.error || 'xuất thất bại');

    const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remember-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    btn.textContent = `đã xuất ${res.payload.cards.length} thẻ`;
  } catch (e) {
    btn.textContent = String(e?.message || e);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = label;
    }, 2500);
  }
}

const exportBtn = document.querySelector('[data-role="export"]');
exportBtn?.addEventListener('click', () => exportAll(exportBtn));

function render(cards, source) {
  listEl.textContent = '';
  countEl.textContent = cards.length
    ? `${cards.length} thẻ · ${source === 'api' ? 'từ tài khoản' : 'trên máy này'}`
    : '';

  if (!cards.length) {
    listEl.append(el('li', 'empty',
      source === 'api'
        ? 'Tài khoản chưa có thẻ nào. Bôi đen một từ trên trang web để lưu.'
        : 'Chưa có thẻ nào. Thử bôi đen một từ trên trang web.'));
    return;
  }

  for (const card of cards) {
    const li = el('li');
    const row = el('div', 'row');
    row.append(el('span', 'front', card.front));

    if (card.reading) {
      row.append(el('span', 'ipa',
        card.readingType === 'ipa' ? `/${card.reading}/` : card.reading));
    }
    if (card.pos) {
      const badge = el('span', 'pos', POS_LABEL[card.pos] || card.pos);
      badge.title = card.pos;
      row.append(badge);
    }
    if (card.seenCount > 1) row.append(el('span', 'badge', `×${card.seenCount}`));

    // Thẻ từ API thì mặc nhiên đã đồng bộ; chỉ bản local cần dấu hiệu.
    if (source !== 'api') {
      const sync = el('span', 'sync-dot', card.synced ? '☁' : '·');
      sync.title = card.synced ? 'đã đồng bộ' : 'chỉ có trên máy này';
      row.append(sync);

      const del = el('button', 'del', '×');
      del.type = 'button';
      del.title = 'Xoá thẻ';
      del.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'DELETE_CARD', payload: { id: card.id } });
        load();
      });
      row.append(del);
    }
    li.append(row);

    if (card.back?.length) li.append(el('div', 'back', card.back.join(' · ')));
    if (card.deckName) li.append(el('span', 'deck', card.deckName));
    if (card.contextSentence) li.append(el('div', 'ctx', card.contextSentence));

    const host = hostOf(card.sourceUrl);
    if (host) {
      const a = el('a', 'src', host);
      a.href = card.sourceUrl;
      a.target = '_blank';
      a.rel = 'noreferrer';
      li.append(a);
    }
    listEl.append(li);
  }
}

async function load() {
  try {
    // Ưu tiên API: khi đã kết nối tài khoản thì đó là nguồn sự thật.
    const remote = await chrome.runtime.sendMessage({
      type: 'GET_REMOTE_CARDS',
      payload: { limit: 50 },
    });
    if (remote?.ok) {
      render(remote.cards, 'api');
      return;
    }
    const local = await chrome.runtime.sendMessage({ type: 'GET_CARDS' });
    render(local?.cards || [], 'local');
  } catch {
    listEl.textContent = '';
    listEl.append(el('li', 'empty', 'Không kết nối được service worker. Thử tải lại extension.'));
  }
}

/**
 * Công tắc highlight.
 *
 * Phải có chỗ TẮT: highlight vẽ lên mọi trang, và có lúc người ta chỉ muốn đọc.
 * Trạng thái đọc trực tiếp từ storage (mặc định BẬT) chứ không hỏi service worker —
 * ô tick không được nhảy sau khi popup đã hiện.
 */
async function setUpHighlightToggle() {
  const box = document.querySelector('[data-role="hl"]');
  const note = document.querySelector('[data-role="hl-note"]');
  if (!box) return;

  const bag = await chrome.storage.local.get(['highlightOn', 'highlightIndex']);
  box.checked = bag.highlightOn !== false;

  const describe = () => {
    const n = bag.highlightIndex?.fronts?.length ?? 0;
    note.textContent = box.checked
      ? (n ? `Đang tô ${n} từ đã lưu trên trang đang đọc.` : 'Tô các từ đã có thẻ ngay trên trang đang đọc.')
      : 'Đang tắt — trang không được tô gì.';
  };
  describe();

  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_HIGHLIGHT_ON',
        payload: { on: box.checked },
      });
      Object.assign(bag, await chrome.storage.local.get('highlightIndex'));
      describe();
    } catch {
      // Service worker không trả lời: trả ô tick về trạng thái thật, đừng để UI nói dối.
      box.checked = !box.checked;
      note.textContent = 'Không đổi được — thử tải lại extension.';
    } finally {
      box.disabled = false;
    }
  });
}

// account.js gọi lại sau khi kết nối / ngắt kết nối để danh sách đổi nguồn ngay.
window.reloadCards = load;

load();
setUpHighlightToggle();
