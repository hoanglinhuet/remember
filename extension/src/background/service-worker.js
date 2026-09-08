/**
 * Remember - service worker (M0)
 *
 * Theo ADR-6, đây là nơi duy nhất được gọi mạng ra ngoài (M1 sẽ thêm provider dịch).
 * Theo ADR-4/A4: KHÔNG giữ state trong biến module - service worker MV3 bị kill khi idle.
 * M0 lưu tạm vào chrome.storage.local; M1 sẽ chuyển sang IndexedDB/Dexie.
 */

import { runChain } from './providers.js';
import {
  FLUSH_ALARM, connectWithCode, createDeck, disconnect, flushOutbox, getDecks,
  getExisting, getRecentCards, getRemoteFronts, getStatus, refreshDecks, setApiBase,
  syncAfterSave,
} from './sync.js';

const STORE_KEY = 'cards';
const DECKS_KEY = 'decks';
const CACHE_KEY = 'lookupCache';
const QUOTA_KEY = 'quota';
const MENU_ID = 'remember-lookup';
const HL_KEY = 'highlightIndex';   // { fronts, at } — bộ từ để highlight trên trang
const HL_ON_KEY = 'highlightOn';   // bật/tắt highlight, mặc định BẬT
const HL_TTL_MS = 10 * 60_000;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 ngày (ARCHITECTURE §7)
const CACHE_MAX = 400;                          // giữ storage.local khỏi phình
const DAILY_BUDGET = 800;                       // mỗi provider/ngày, tự đặt dưới hạn mức free

/** Chuẩn hoá để dedupe (FR-B3): bỏ dấu câu ở hai đầu, gộp khoảng trắng, lowercase. */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

// ------------------------------------------------------------------- decks

const DEFAULT_DECK_NAME = 'Mặc định';
const DECK_NAME_MAX = 60;

async function readDecks() {
  const bag = await chrome.storage.local.get(DECKS_KEY);
  return Array.isArray(bag[DECKS_KEY]) ? bag[DECKS_KEY] : [];
}

/**
 * Luôn tồn tại ít nhất một deck - "deck đầu tiên" là mặc định khi lưu thẻ,
 * nên không được để danh sách rỗng.
 */
async function ensureDecks() {
  const decks = await readDecks();
  if (decks.length) return decks;

  const now = new Date().toISOString();
  const seeded = [{ id: crypto.randomUUID(), name: DEFAULT_DECK_NAME, createdAt: now, updatedAt: now }];
  await chrome.storage.local.set({ [DECKS_KEY]: seeded });
  return seeded;
}

async function createLocalDeck(payload) {
  const name = String(payload?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'tên deck không được để trống' };
  if (name.length > DECK_NAME_MAX) return { ok: false, error: `tên deck tối đa ${DECK_NAME_MAX} ký tự` };

  const decks = await ensureDecks();
  const existing = decks.find((d) => d.name.toLowerCase() === name.toLowerCase());
  // Trùng tên thì trả về deck cũ kèm cờ - UI chọn luôn deck đó thay vì báo lỗi.
  if (existing) return { ok: true, deck: existing, existed: true, decks };

  const now = new Date().toISOString();
  const deck = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
  decks.push(deck);
  await chrome.storage.local.set({ [DECKS_KEY]: decks });
  return { ok: true, deck, existed: false, decks };
}

async function readCards() {
  const bag = await chrome.storage.local.get(STORE_KEY);
  return Array.isArray(bag[STORE_KEY]) ? bag[STORE_KEY] : [];
}

/**
 * Xoá badge trên icon extension.
 *
 * Trước đây badge hiện TỔNG số thẻ đã lưu — một con số chỉ tăng, không bao giờ là
 * việc cần làm, nên nó không nói gì ngoài "bạn đã dùng app này bao nhiêu lần". Badge
 * là chỗ cho số việc TỒN (thẻ đến hạn, thẻ chưa đồng bộ); không có số như thế thì
 * để trống.
 *
 * Vẫn phải gọi hàm này lúc cài/khởi động: badge do bản cũ đặt còn sống trong phiên
 * browser hiện tại, không tự mất khi cập nhật extension.
 */
async function clearBadge() {
  await chrome.action.setBadgeText({ text: '' });
}

// ------------------------------------------------------- highlight trên trang

/**
 * Bộ từ để content script highlight.
 *
 * ĐÃ KẾT NỐI TÀI KHOẢN ⇒ API LÀ NGUỒN SỰ THẬT DUY NHẤT, không lấy hợp với local.
 * Bản đầu tiên gộp cả hai và sai rõ ràng: `chrome.storage.local` giữ MỌI thẻ từng
 * lưu từ browser này, còn xoá thẻ trên web thì không xoá được bản local đó — nên
 * người dùng có 2 thẻ mà cả chục từ cũ đã xoá vẫn sáng lên. Local ở đây là cache,
 * và cache không được quyền phủ quyết nguồn sự thật.
 *
 * Ngoại lệ duy nhất: thẻ local CHƯA đẩy lên được (`!c.synced` — lưu lúc mất mạng).
 * Chúng đã lưu thật theo góc nhìn người dùng, chỉ chưa kịp lên server.
 *
 * Chưa ghép nối tài khoản thì local là kho duy nhất, dùng cả bộ.
 *
 * Kết quả ghi vào storage thay vì trả riêng cho từng tab: một trang có thể có nhiều
 * frame, và content script đọc storage trực tiếp được, không phải đánh thức service
 * worker cho từng frame một.
 */
async function buildHighlightIndex() {
  const cards = await readCards();
  const frontOf = (c) => c.normalizedFront || normalize(c.front || '');
  const remote = await getRemoteFronts({ maxAgeMs: HL_TTL_MS });

  // `stale` mà vẫn có cache: mạng hỏng, dùng bản cache — vẫn đúng hơn local.
  const authoritative = remote.connected && (!remote.stale || remote.fronts.length > 0);
  const fronts = authoritative
    ? [...remote.fronts, ...cards.filter((c) => !c.synced).map(frontOf)]
    : cards.map(frontOf);

  const index = { fronts: [...new Set(fronts.filter(Boolean))], at: Date.now(), source: authoritative ? 'api' : 'local' };
  await chrome.storage.local.set({ [HL_KEY]: index });
  return index;
}

/** Bộ từ cho content script; chỉ gọi API lại khi cache đã cũ. */
async function highlightIndex({ force = false } = {}) {
  const bag = await chrome.storage.local.get([HL_KEY, HL_ON_KEY]);
  const on = bag[HL_ON_KEY] !== false;   // mặc định bật
  const cached = bag[HL_KEY];
  if (!on) return { ok: true, on, fronts: [] };
  if (!force && cached && Date.now() - cached.at < HL_TTL_MS) {
    return { ok: true, on, fronts: cached.fronts };
  }
  const index = await buildHighlightIndex();
  return { ok: true, on, fronts: index.fronts };
}

async function saveCard(payload) {
  const front = String(payload?.front ?? '').trim();
  if (!front) return { ok: false, error: 'thiếu nội dung' };

  const normalizedFront = normalize(front);
  const langFrom = payload.langFrom || 'auto';
  const cards = await readCards();

  // Deck: theo yêu cầu người dùng, mặc định là deck ĐẦU TIÊN.
  const decks = await ensureDecks();
  const deckId = decks.some((d) => d.id === payload.deckId) ? payload.deckId : decks[0].id;

  const existing = cards.find(
    (c) => c.normalizedFront === normalizedFront && c.langFrom === langFrom,
  );
  if (existing) {
    // M1 sẽ mở hộp thoại gộp nghĩa; M0 chỉ cập nhật thời điểm gặp lại.
    existing.seenCount = (existing.seenCount || 1) + 1;
    existing.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [STORE_KEY]: cards });
    // Dedupe theo front + ngôn ngữ trên TOÀN BỘ thẻ (FR-B3), không theo từng deck
    // -> nói rõ thẻ cũ đang ở deck nào để người dùng không tưởng là lưu thất bại.
    const deckName = decks.find((d) => d.id === existing.deckId)?.name || '';
    return { ok: true, duplicate: true, total: cards.length, deckName };
  }

  const now = new Date().toISOString();
  cards.push({
    id: crypto.randomUUID(),
    front,
    normalizedFront,
    back: Array.isArray(payload.back) ? payload.back : [],
    reading: payload.reading || '',        // phiên âm, không kèm dấu //
    readingType: payload.readingType || null, // 'ipa' | 'translit'
    pos: payload.pos || null,              // loại từ của nghĩa đã chọn
    langFrom,
    langTo: payload.langTo || 'vi',
    contextSentence: payload.contextSentence || '',
    sourceUrl: payload.sourceUrl || '',
    sourceTitle: payload.sourceTitle || '',
    deckId,
    tags: [],
    seenCount: 1,
    createdAt: now,
    updatedAt: now,
    // Chỗ dành cho FSRS (M1) - M0 chưa xếp lịch.
    state: 'new',
  });

  await chrome.storage.local.set({ [STORE_KEY]: cards });
  // Từ vừa lưu phải được highlight ngay trên trang đang đọc, không phải chờ hết TTL.
  await buildHighlightIndex();

  const card = cards[cards.length - 1];
  // Local trước (đã xong ở trên), rồi mới đẩy lên — bắt từ không được thất bại
  // vì mất mạng hay chưa đăng nhập (ADR-20: extension giữ local-first).
  const sync = await syncAfterSave(card, markSynced);

  return {
    ok: true,
    duplicate: false,
    total: cards.length,
    deckName: decks.find((d) => d.id === deckId)?.name || '',
    sync: { synced: Boolean(sync.ok), reason: sync.reason ?? null, remoteDeck: sync.deckName ?? null },
  };
}

/** Đánh dấu thẻ đã có trên server, để lần flush sau không gửi lại. */
async function markSynced(cardId) {
  const cards = await readCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card || card.synced) return;
  card.synced = true;
  card.syncedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORE_KEY]: cards });
}

// ----------------------------------------------------------- lookup + cache

const inflight = new Map(); // dedupe request đang bay (ARCHITECTURE §7)

async function readCache() {
  const bag = await chrome.storage.local.get(CACHE_KEY);
  return bag[CACHE_KEY] && typeof bag[CACHE_KEY] === 'object' ? bag[CACHE_KEY] : {};
}

async function writeCache(key, value) {
  const cache = await readCache();
  const now = Date.now();
  // Dọn hạn + cắt bớt nếu quá lớn (bỏ các entry cũ nhất).
  for (const [k, v] of Object.entries(cache)) if (!v?.exp || v.exp < now) delete cache[k];
  cache[key] = { v: value, exp: now + CACHE_TTL_MS, at: now };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0))
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete cache[k]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

/** Đếm lượt dùng theo provider theo ngày; trả false nếu hết budget. */
async function chargeQuota(providerId) {
  const today = new Date().toISOString().slice(0, 10);
  const bag = await chrome.storage.local.get(QUOTA_KEY);
  const quota = bag[QUOTA_KEY]?.date === today ? bag[QUOTA_KEY] : { date: today, used: {} };
  const used = quota.used[providerId] || 0;
  if (used >= DAILY_BUDGET) return false;
  quota.used[providerId] = used + 1;
  await chrome.storage.local.set({ [QUOTA_KEY]: quota });
  return true;
}

async function lookup(payload) {
  const text = String(payload?.text ?? '').trim();
  if (!text) return { ok: false, error: 'thiếu nội dung' };

  const langFrom = payload.langFrom || 'auto';
  const langTo = payload.langTo || 'vi';
  const key = `${langFrom}>${langTo}|${normalize(text)}`;

  const cache = await readCache();
  const hit = cache[key];
  if (hit?.exp > Date.now()) return { ok: true, result: { ...hit.v, fromCache: true } };

  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const { result, attempts } = await runChain({ text, langFrom, langTo }, chargeQuota);
    if (attempts.length) {
      // Hiện ở console của service worker (chrome://extensions -> "service worker").
      console.warn('[Remember] provider thất bại:', JSON.stringify(attempts), 'text=', text);
    }
    if (!result) {
      return {
        ok: false,
        error: 'không tra được',
        attempts, // UI hiện lý do thay vì báo lỗi trắng (J5)
      };
    }
    const full = { ...result, fetchedAt: new Date().toISOString(), fromCache: false };
    await writeCache(key, full);
    return { ok: true, result: full };
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

// ---------------------------------------------------------------- TTS (audio)

/**
 * Giọng đọc của translate.google.com. Cùng loại endpoint không chính thức như
 * translate_a (xem ghi chú ở providers.js): không key, ngoài ToS, có thể bị chặn.
 * `client=tw-ob` là client mà trang Google Translate dùng - giọng nữ.
 * Giới hạn thực tế ~200 ký tự cho một request.
 */
function ttsUrl(text, lang) {
  const q = text.slice(0, 200);
  const tl = (lang || 'en').split('-')[0];
  return 'https://translate.google.com/translate_tts'
    + `?ie=UTF-8&client=tw-ob&idx=0&total=1&textlen=${q.length}`
    + `&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`;
}

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

async function ensureOffscreen() {
  // getContexts là cách đúng để biết offscreen đã tồn tại chưa (SW có thể vừa hồi sinh).
  const existing = await chrome.runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing?.length) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Phát audio phát âm của từ vựng.',
    });
  } catch (e) {
    // Race: hai lần gọi cùng lúc -> document đã được tạo, coi như thành công.
    if (!String(e?.message || e).includes('Only a single offscreen')) throw e;
  }
}

async function speak(payload) {
  const text = String(payload?.text ?? '').trim();
  if (!text) return { ok: false, error: 'thiếu nội dung' };
  if (!chrome.offscreen) return { ok: false, error: 'trình duyệt không hỗ trợ offscreen' };

  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PLAY_AUDIO',
      url: ttsUrl(text, payload.lang),
    });
    return res?.ok ? { ok: true } : { ok: false, error: res?.error || 'phát audio thất bại' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// -------------------------------------------------------------- message hub

const handlers = {
  LOOKUP: (msg) => lookup(msg.payload),
  /**
   * Deck lấy từ API. Mất mạng thì trả cache và gắn cờ `stale` để panel nói rõ.
   * Chưa kết nối tài khoản thì trả deck local (extension vẫn dùng được offline).
   */
  GET_DECKS: async () => {
    const remote = await getDecks();
    if (remote.decks.length) {
      return { ok: true, decks: remote.decks, stale: Boolean(remote.stale), source: 'api' };
    }
    return { ok: true, decks: await ensureDecks(), stale: true, source: 'local' };
  },

  // --- kết nối & dữ liệu qua API ---
  GET_SYNC_STATUS: async () => ({ ok: true, status: await getStatus() }),
  CONNECT_CODE: async (msg) => {
    const res = await connectWithCode(msg.payload?.code);
    if (res.ok) await flushOutbox(readCards, markSynced);
    return res;
  },
  DISCONNECT: async () => {
    await disconnect();
    return { ok: true };
  },
  SET_API_BASE: async (msg) => {
    try {
      return { ok: true, base: await setApiBase(msg.payload?.base) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  FLUSH_OUTBOX: async () => ({ ok: true, result: await flushOutbox(readCards, markSynced) }),
  /**
   * Xoá cache tra từ. Cần khi parser đổi: cache sống 90 ngày nên kết quả cũ
   * (thiếu nhóm "bản dịch chính", thiếu IPA…) sẽ che mất bản sửa.
   */
  CLEAR_LOOKUP_CACHE: async () => {
    await chrome.storage.local.remove(CACHE_KEY);
    return { ok: true };
  },
  REFRESH_DECKS: async () => ({ ok: true, ...(await refreshDecks()) }),
  GET_REMOTE_CARDS: async (msg) => getRecentCards(msg.payload?.limit ?? 50),
  GET_EXISTING: async (msg) => {
    const { front, langFrom, langTo } = msg.payload ?? {};
    if (!front) return { ok: false, cards: [] };
    return getExisting(front, langFrom, langTo);
  },
  EXPORT_ALL: async () => ({
    ok: true,
    payload: {
      app: 'remember-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: 'extension',
      decks: await ensureDecks(),
      cards: await readCards(),
    },
  }),
  /** Tạo deck: ưu tiên API (nguồn sự thật), lùi về local khi chưa kết nối. */
  CREATE_DECK: async (msg) => {
    const name = String(msg.payload?.name ?? '').trim();
    const remote = await createDeck(name);
    if (remote.ok) return remote;
    if (remote.reason === 'no_token' || remote.reason === 'unauthorized') {
      return createLocalDeck(msg.payload);
    }
    return { ok: false, error: remote.error || 'không tạo được deck' };
  },
  /** Content script hỏi bộ từ để highlight. */
  GET_HIGHLIGHT: (msg) => highlightIndex({ force: Boolean(msg.payload?.force) }),
  /** Popup bật/tắt highlight. Tắt thì xoá luôn bộ từ đang cache cho gọn. */
  SET_HIGHLIGHT_ON: async (msg) => {
    const on = Boolean(msg.payload?.on);
    await chrome.storage.local.set({ [HL_ON_KEY]: on });
    if (on) await buildHighlightIndex();
    return { ok: true, on };
  },
  SPEAK: (msg) => speak(msg.payload),
  STOP_SPEAK: async () => {
    try {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_AUDIO' });
    } catch { /* offscreen chưa tồn tại - không sao */ }
    return { ok: true };
  },
  SAVE_CARD: (msg) => saveCard(msg.payload),
  GET_CARDS: async () => ({
    ok: true,
    cards: (await readCards()).slice(-50).reverse(),
    decks: await ensureDecks(),
  }),
  DELETE_CARD: async (msg) => {
    const cards = (await readCards()).filter((c) => c.id !== msg.payload?.id);
    await chrome.storage.local.set({ [STORE_KEY]: cards });
    await buildHighlightIndex();
    return { ok: true, total: cards.length };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `không rõ message: ${msg?.type}` });
    return false;
  }
  // Trả true để giữ kênh mở cho phản hồi async.
  Promise.resolve(handler(msg))
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ------------------------------------------------------------- context menu

function registerMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Remember: lưu "%s"',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerMenu();
  clearBadge();
  ensureDecks();
  // Dựng lại bộ từ highlight NGAY, không chờ hết TTL: bản cũ trong storage có thể
  // được dựng bằng phiên bản trước (và bằng luật khác), nên sau khi cập nhật
  // extension nó vẫn còn tô những từ đã xoá.
  buildHighlightIndex().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  registerMenu();
  clearBadge();
  buildHighlightIndex().catch(() => {});
  // Mở browser lại: có thể đã đăng nhập web từ lần trước, thử đẩy hàng chờ.
  flushOutbox(readCards, markSynced).catch(() => {});
});

/** Hàng chờ còn thẻ thì thử đẩy lại định kỳ. Service worker MV3 bị kill khi idle,
 *  nên phải dùng chrome.alarms chứ không phải setInterval. */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  await flushOutbox(readCards, markSynced);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  await saveCard({
    front: info.selectionText,
    langFrom: 'auto',
    sourceUrl: info.pageUrl || tab?.url || '',
    sourceTitle: tab?.title || '',
  });
});
