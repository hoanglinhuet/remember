/**
 * Remember — popup.
 *
 * Chỉ còn ba việc: cho biết đã ghép nối tài khoản chưa (`account.js`), bật/tắt
 * highlight cho tên miền đang mở, và xuất dữ liệu ra file.
 *
 * KHÔNG còn danh sách thẻ ở đây: quản lý thẻ nằm trên web app (`/decks`), nơi có tìm
 * kiếm, phân trang và xoá. Một danh sách 50 thẻ trong popup 340px chỉ là bản xem
 * thiếu của cùng dữ liệu đó, và nó buộc popup phải gọi API mỗi lần mở.
 *
 * Mọi node dựng bằng DOM API, không innerHTML.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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

/**
 * Công tắc highlight — THEO TỪNG TÊN MIỀN.
 *
 * Vì sao theo domain chứ không phải một công tắc toàn cục: người ta muốn tắt ở đúng
 * chỗ gây rối (dashboard công việc, trang tin đọc nhanh) và giữ bật ở chỗ đang học.
 * Một công tắc toàn cục buộc họ chọn giữa "rối khắp nơi" và "không có tính năng".
 *
 * Mặc định BẬT, và **chỉ trạng thái TẮT được lưu** — danh sách `highlightOff` nằm
 * trong `users.settings` ở DB (qua `/v1/me`), nên tắt ở máy này thì máy khác cũng
 * tắt. Chưa ghép nối tài khoản thì lưu trong `storage.local` của extension.
 *
 * Tên miền lấy từ tab đang mở bằng quyền `activeTab` — quyền này được cấp đúng lúc
 * người dùng bấm vào icon extension, nên không cần xin quyền `tabs` (quyền đọc URL
 * của MỌI tab, lúc nào cũng có hiệu lực).
 */
async function setUpHighlightToggle() {
  const box = document.querySelector('[data-role="hl"]');
  const note = document.querySelector('[data-role="hl-note"]');
  const hostEl = document.querySelector('[data-role="hl-host"]');
  if (!box) return;

  const tabOf = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  };

  const tab = await tabOf();
  let host = '';
  try {
    host = tab?.url ? new URL(tab.url).hostname : '';
  } catch { /* URL lạ (chrome://, about:) -> coi như không có host */ }

  if (!host) {
    // Trang nội bộ của browser (chrome://…, trang mới) không có content script nào
    // chạy, nên công tắc ở đây vô nghĩa — nói thẳng thay vì để một ô tick chết.
    // `tab.url` rỗng cũng vào đây: đó là dấu hiệu quyền `activeTab` chưa có tác dụng.
    hostEl.textContent = 'trang này';
    note.textContent = tab
      ? 'Không đọc được tên miền của tab (trang nội bộ của browser, hoặc thiếu quyền).'
      : 'Không đọc được tab đang mở.';
    box.checked = false;
    box.disabled = true;
    return;
  }

  const state = await chrome.runtime.sendMessage({
    type: 'GET_HIGHLIGHT_STATE',
    payload: { host },
  }).catch(() => null);

  const shown = state?.host || host;
  hostEl.textContent = shown;
  box.checked = state ? state.on : true;
  if (!state) {
    // Không hỏi được service worker: nói ra, đừng để ô tick mặc định "đang bật"
    // trông như một trạng thái đã đọc được.
    note.textContent = 'Không đọc được trạng thái — thử tải lại extension.';
  }

  const bag = await chrome.storage.local.get('highlightIndex');
  const describe = (extra) => {
    if (extra) { note.textContent = extra; return; }
    const n = bag.highlightIndex?.fronts?.length ?? 0;
    const where = box.checked
      ? (n ? `Đang tô ${n} từ đã lưu ở tên miền này.` : 'Tô các từ đã có thẻ ngay trên trang đang đọc.')
      : `Đã tắt ở ${shown}. Các trang khác vẫn tô.`;
    // Nói luôn trạng thái đồng bộ: chưa ghép nối thì công tắc KHÔNG gọi API nào,
    // và đó là thiết kế, không phải lỗi.
    const sync = state && !state.connected
      ? ' Chỉ lưu trên máy này — chưa ghép nối tài khoản.'
      : (state?.pending ? ' Có thay đổi chưa đẩy lên server.' : '');
    note.textContent = where + sync;
  };
  if (state) describe();

  /**
   * Bắn tín hiệu TRỰC TIẾP vào tab đang mở.
   *
   * Không dựa vào `storage.onChanged` một mình: nếu tab đang chạy content script của
   * bản extension CŨ (Reload extension mà chưa F5 tab) thì bản cũ đó không nghe được
   * gì, và phần đã tô sẽ đứng nguyên — nhìn ra đúng như "tắt mà không tắt".
   *
   * Không có ai trả lời = tab đó không có content script còn sống ⇒ nói người dùng F5,
   * thay vì im lặng để họ tưởng công tắc hỏng.
   */
  const poke = async () => {
    if (!tab?.id) return false;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_CHANGED' });
      return Boolean(res?.ok);
    } catch {
      return false;
    }
  };

  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SET_HIGHLIGHT_FOR_HOST',
        payload: { host: shown, on: box.checked },
      });
      if (!res?.ok) throw new Error(res?.error || 'không đổi được');
      box.checked = res.on;
      Object.assign(bag, await chrome.storage.local.get('highlightIndex'));

      if (!(await poke())) {
        note.textContent = 'Đã lưu, nhưng trang đang mở chạy bản cũ — tải lại trang (F5).';
      } else if (res.synced) {
        describe();
      } else {
        // Chưa đồng bộ thì phải nói RÕ VÌ SAO — "đã lưu trên máy này" mà không nói
        // lý do thì người dùng không biết là đang thiếu tài khoản hay mất mạng.
        describe(res.reason === 'no_token'
          ? 'Đã lưu trên máy này — chưa ghép nối tài khoản nên máy khác chưa biết.'
          : 'Đã lưu trên máy này — chưa đẩy lên server được, sẽ tự thử lại.');
      }
    } catch (e) {
      // Trả ô tick về trạng thái thật, đừng để UI nói dối.
      box.checked = !box.checked;
      note.textContent = `Không đổi được — ${String(e?.message || e)}`;
    } finally {
      box.disabled = false;
    }
  });
}

// Lỗi ở đây từng làm cả công tắc chết im lặng (listener không được gắn, bấm không
// gọi gì cả). Hiện lỗi ra ngay trong popup thay vì để nó biến mất.
setUpHighlightToggle().catch((e) => {
  const note = document.querySelector('[data-role="hl-note"]');
  if (note) note.textContent = `Công tắc lỗi: ${String(e?.message || e)}`;
});
