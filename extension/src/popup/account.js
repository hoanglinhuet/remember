/**
 * Khối "tài khoản" trong popup — kết nối bằng mã lấy từ web app.
 *
 * Không cần quyền `cookies`, không cần đăng nhập lại theo từng browser profile:
 * dán mã một lần là extension có session riêng của nó.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const slot = document.querySelector('[data-role="account"]');

const send = (type, payload) =>
  chrome.runtime.sendMessage(payload ? { type, payload } : { type });

function row(...children) {
  const r = el('div', 'acc-row');
  r.append(...children);
  return r;
}

function connectForm(base, note) {
  const box = el('div');
  if (note) box.append(el('p', 'acc-note', note));

  const open = el('button', 'acc-btn', 'Mở trang lấy mã');
  open.addEventListener('click', () => chrome.tabs.create({ url: `${base}/connect` }));

  const input = el('input', 'acc-input');
  input.placeholder = 'Dán mã ở đây';
  input.autocapitalize = 'characters';
  input.spellcheck = false;

  const go = el('button', 'acc-btn primary', 'Kết nối');
  const err = el('p', 'acc-note');

  const submit = async () => {
    const code = input.value.trim();
    if (!code) return;
    go.disabled = true;
    go.textContent = 'đang kết nối…';
    err.textContent = '';
    const res = await send('CONNECT_CODE', { code });
    if (res?.ok) {
      await refresh();
      return;
    }
    go.disabled = false;
    go.textContent = 'Kết nối';
    err.textContent = `✕ ${res?.error || 'Không kết nối được'}`;
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  box.append(open, input, go, err);
  return box;
}

function render(status) {
  slot.textContent = '';
  const { state, base, pending, user, error } = status;

  const label = {
    connected: user?.email || user?.name || 'đã kết nối',
    no_token: 'chưa kết nối tài khoản',
    unauthorized: 'phiên hết hạn',
    error: 'không gọi được server',
  }[state] ?? state;

  slot.append(row(el('span', `acc-dot ${state}`), el('span', 'acc-label', label)));

  if (state === 'no_token') {
    slot.append(connectForm(base,
      'Mở web app → Kết nối extension → tạo mã, rồi dán vào đây. Mã sống 10 phút.'));
  }

  if (state === 'unauthorized') {
    slot.append(connectForm(base, 'Token đã bị thu hồi hoặc hết hạn. Lấy mã mới để kết nối lại.'));
  }

  if (state === 'error') {
    slot.append(el('p', 'acc-note', `${base} — ${error ?? ''}. Thẻ vẫn lưu trên máy.`));
  }

  if (pending > 0) {
    const btn = el('button', 'acc-btn', `Đẩy ${pending} thẻ đang chờ`);
    btn.disabled = state !== 'connected';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'đang đẩy…';
      const res = await send('FLUSH_OUTBOX');
      btn.textContent = `đã đẩy ${res?.result?.pushed ?? 0}`;
      setTimeout(refresh, 900);
    });
    slot.append(btn);
  }

  if (state === 'connected') {
    const out = el('button', 'acc-btn', 'Ngắt kết nối');
    out.addEventListener('click', async () => {
      await send('DISCONNECT');
      await refresh();
    });
    slot.append(out);
  }

  // Đổi địa chỉ server — cần khi deploy lên Vercel.
  const details = el('details', 'acc-cfg');
  details.append(el('summary', null, 'Địa chỉ server'));
  const input = el('input', 'acc-input');
  input.type = 'url';
  input.value = base;
  input.placeholder = 'https://app.vercel.app';
  const save = el('button', 'acc-btn', 'Lưu');
  save.addEventListener('click', async () => {
    const res = await send('SET_API_BASE', { base: input.value });
    if (!res?.ok) {
      save.textContent = res?.error || 'lỗi';
      return;
    }
    save.textContent = 'đã lưu';
    // Đổi server thì token cũ bị xoá -> trạng thái về no_token.
    setTimeout(refresh, 600);
  });
  const clear = el('button', 'acc-btn', 'Xoá cache tra từ');
  clear.title = 'Cache sống 90 ngày; xoá khi kết quả tra trông cũ hoặc thiếu nghĩa';
  clear.addEventListener('click', async () => {
    await send('CLEAR_LOOKUP_CACHE');
    clear.textContent = 'đã xoá';
    setTimeout(() => { clear.textContent = 'Xoá cache tra từ'; }, 1500);
  });

  details.append(input, save, clear);
  slot.append(details);
}

async function refresh() {
  try {
    const res = await send('GET_SYNC_STATUS');
    if (res?.ok) render(res.status);
    // Danh sách thẻ trong popup lấy từ API khi đã kết nối.
    if (typeof window.reloadCards === 'function') window.reloadCards();
  } catch {
    slot.textContent = '';
    slot.append(el('span', 'acc-label', 'mất kết nối service worker'));
  }
}

refresh();
