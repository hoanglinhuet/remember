/** Remember - offscreen: phát audio TTS. Nhận URL từ service worker, phát, báo kết quả. */

let audio = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  if (msg.type === 'STOP_AUDIO') {
    audio?.pause();
    audio = null;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type !== 'PLAY_AUDIO') return false;

  audio?.pause();
  audio = new Audio(msg.url);
  audio.volume = 1;

  let settled = false;
  const settle = (res) => {
    if (settled) return;
    settled = true;
    sendResponse(res);
  };

  audio.addEventListener('ended', () => settle({ ok: true }));
  audio.addEventListener('error', () => settle({ ok: false, error: 'không tải được audio' }));
  // play() bị reject khi URL trả về HTML lỗi thay vì audio.
  audio.play().catch((e) => settle({ ok: false, error: String(e?.message || e) }));

  return true; // giữ kênh mở cho phản hồi async
});
