# Remember — extension (v0.9.0)

Bản chạy được đầu tiên: **bôi đen text → icon nổi cạnh vùng chọn → click → panel → lưu thẻ**.
Vanilla JS + MV3, **không cần build**, load unpacked là chạy.

## Cài để thử

**Chrome / Edge / Brave**
1. `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `extension/`
3. Mở một trang web bất kỳ (đã mở trước đó thì **F5**, vì content script chỉ inject khi tải trang)
4. Bôi đen một từ → icon tím hiện ra góc dưới-phải vùng chọn

**Firefox**
1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → chọn `extension/manifest.json`
2. Extension sẽ mất khi đóng Firefox (bản tạm).

Sau mỗi lần sửa code: bấm **Reload** ở trang extensions, rồi **F5 lại tab đang test**.

## Đã có ở M0

| Chức năng | Trạng thái |
|---|---|
| FR-A1 — phát hiện selection (chuột, `Shift`+mũi tên, `Ctrl+A`, double-click) | ✅ |
| FR-A1 — icon nổi, Shadow DOM cô lập CSS, tự lật khi sát biên viewport, bám theo khi cuộn | ✅ |
| FR-A1 — panel: từ, **phiên âm IPA**, **nút đọc thành tiếng**, nghĩa **nhóm theo loại từ** (danh từ/động từ/tính từ…), ví dụ, đồng nghĩa, **câu ngữ cảnh** tô sáng | ✅ |
| FR-A1 — chọn nhiều nghĩa để làm mặt sau của thẻ (nghĩa đầu chọn sẵn) | ✅ |
| FR-F2 — provider chain: **Google Translate** → **freedictionaryapi.com** → MyMemory, cache 90 ngày, dedupe request, budget 800 lượt/provider/ngày, lỗi mềm hiện lý do | ✅ |
| **IPA** cho từ đơn tiếng Anh + định nghĩa gốc theo từng loại từ (freedictionaryapi.com, Wiktionary CC BY-SA 4.0) | ✅ |
| Đọc thành tiếng bằng **giọng nữ của translate.google.com** qua offscreen document; lùi về Web Speech API (ưu tiên giọng nữ) khi lỗi | ✅ |
| FR-A1 — **dịch ngược** (reverse translation) để kiểm chứng nghĩa | ✅ |
| Tự nhận ngôn ngữ nguồn (Google `sl=auto`), TTS đọc theo ngôn ngữ phát hiện được | ✅ |
| ADR-5 — TTS bằng Web Speech API (miễn phí, offline, không key) | ✅ |
| FR-B1 — lưu thẻ (front, context, sourceUrl/title, timestamps) | ✅ (lưu tạm `chrome.storage.local`) |
| FR-B3 — chống trùng theo `normalizedFront + langFrom` (gặp lại thì `×N`) | ✅ |
| Menu chuột phải "Remember: lưu …", badge số thẻ, popup 50 thẻ gần nhất, xoá thẻ | ✅ |
| Đóng bằng `Esc` / click ra ngoài; giới hạn 200 ký tự thì chặn lưu (chỉ tra) | ✅ |
| Hiệu ứng: fade + scale có fade-out thật, `transform-origin` theo hướng lật, nội dung panel trôi vào chậm hơn khung 60ms, tôn trọng `prefers-reduced-motion` | ✅ |
| Dịch cụm/câu chất lượng cao, Wiktionary cho ngôn ngữ ≠ tiếng Anh | ❌ M1 |
| FSRS, deck, study mode, highlight in-page, sync | ❌ M1–M3 |

## Cấu trúc

```
extension/
├── manifest.json                       # MV3
├── icons/                              # 16/48/128 png
└── src/
    ├── content/selection-icon.js       # phát hiện selection + icon + panel (Shadow DOM)
    ├── background/providers.js         # chuỗi provider từ điển/MT, chuẩn hoá về 1 schema
    ├── background/service-worker.js    # message hub, lookup + cache + quota, lưu thẻ, badge
    └── popup/popup.html|.js            # danh sách thẻ gần nhất
```

## Khác biệt có ý thức so với ARCHITECTURE.md

| Tài liệu nói | M0 làm | Vì sao |
|---|---|---|
| IndexedDB (Dexie) là source of truth | `chrome.storage.local` | M0 không cần schema/migration; đổi sang Dexie ở M1, dữ liệu M0 migrate được (đã có `id` UUID + `updatedAt`) |
| `optional_host_permissions`, không xin `<all_urls>` | `content_scripts` trên `<all_urls>` | bản dev cần chạy mọi trang ngay; M5 sẽ chuyển sang inject theo yêu cầu bằng `chrome.scripting` |
| Monorepo TS + Vite + domain thuần | 3 file JS thuần | M0 là spike để kiểm chứng UX chọn-text; dựng monorepo ở M1 |

## ⚠️ Về provider Google Translate

Endpoint đang dùng là `translate.googleapis.com/translate_a/single?client=gtx&dj=1` — **không chính thức**:
không cần key, nhưng không có quota công bố, có thể bị chặn hoặc đổi format bất kỳ lúc nào, và
**nằm ngoài ToS của Google**. Lý do vẫn chọn: đây là nguồn duy nhất của Google trả về **loại từ +
nghĩa nhóm theo loại từ + dịch ngược + định nghĩa**. Cloud Translation API *chính thức* cần API key +
billing và **chỉ** trả bản dịch thuần — không POS, không phiên âm.

Rủi ro này đã ghi ở REQUIREMENTS §6.5 và §9. Trước khi phát hành công khai, nên để user tự bật
thay vì mặc định. Đổi thứ tự hoặc bỏ provider: sửa `PROVIDER_ORDER` ở đầu `src/background/providers.js`
(M1 sẽ đọc từ Settings).

Giọng đọc cũng dùng endpoint không chính thức: `translate.google.com/translate_tts?client=tw-ob`
(giọng nữ, đúng giọng trang Google Translate). Phát qua **offscreen document** vì service worker MV3
không có DOM để dùng `Audio()`, còn `new Audio()` trong content script thì bị CSP `media-src` của
trang chặn. Lỗi thì lùi về Web Speech API, chọn giọng nữ theo tên (Zira, Hazel, Samantha, HoaiMy…).

## Phiên âm & định nghĩa gốc

**Từ đơn tiếng Anh** → `https://freedictionaryapi.com/api/v1/entries/en/{word}` (nguồn Wiktionary,
**CC BY-SA 4.0** — ghi công ở tooltip của dòng nguồn trong footer). Lấy 2 thứ:

- **IPA** từ `entries[].pronunciations[]` nơi `type === 'ipa'`
- **định nghĩa tiếng Anh** theo từng loại từ, ghép vào đúng nhóm POS mà Google trả về

Chạy sau kết quả chính (`enrichFromDictionary()`), thất bại thì bỏ qua — không làm hỏng bản dịch.
Nó cũng là provider dự phòng thứ hai nếu Google chết.

Với chữ **không phải Latin** (Nhật, Nga, Ả Rập…), phiên âm lấy từ Google `dt=rm` (`src_translit`).
Cụm/câu thì không có IPA — freedictionaryapi chỉ nhận từ đơn.

Cặp ngôn ngữ đích hiện hardcode `vi` — sẽ vào Settings ở M1.

`storage.local` mặc định ~10MB — đủ cho vài nghìn thẻ ở M0, nhưng đây chính là lý do M1 phải chuyển sang IndexedDB.

## Kết nối tài khoản & dữ liệu qua API (v0.9.0)

**Không đăng nhập trong extension.** Web app tạo một **mã**, bạn dán vào popup, extension
nhận session riêng của nó (`sessions.kind = 'extension'`).

### Lần đầu

1. Web app → nút **🧩** (Kết nối extension) → **Tạo mã kết nối**
2. Popup extension → mục **Tài khoản** → dán mã → **Kết nối**
3. Xong. Đèn xanh kèm email của bạn.

Mã sống **10 phút**, dùng **một lần**, và server chỉ lưu SHA-256 của nó. Tạo mã mới thì mã
cũ hết tác dụng ngay.

### Nguồn dữ liệu

| Thứ | Nguồn | Khi mất mạng / chưa kết nối |
|---|---|---|
| Deck trong panel | `GET /api/v1/decks` | cache 5 phút, rồi deck local |
| Tạo deck | `POST /api/v1/decks` | tạo local |
| Danh sách thẻ ở popup | `GET /api/v1/cards/list` | bản local, ghi rõ "trên máy này" |
| Lưu thẻ | `POST /api/v1/cards` | local + outbox, thử lại mỗi 5 phút |

Deck trong dropdown hiện luôn số `(đến hạn/thẻ mới)` lấy từ API.

### Lưu thẻ

```
＋ Lưu thẻ → ghi local (LUÔN thành công, kể cả offline)
           → đã kết nối? → POST /api/v1/cards
                             ├─ 201 → "đã lưu vào <deck> ☁"
                             ├─ 409 → "thẻ đã có sẵn trong <deck>"
                             └─ lỗi mạng → outbox, thử lại mỗi 5 phút (chrome.alarms)
           → chưa kết nối → "chỉ lưu trên máy · chưa kết nối tài khoản"
```

Extension **giữ local-first** (ADR-20): bắt từ không được thất bại vì mất mạng.
Idempotent: `id` do extension sinh, server upsert theo `id` ⇒ gửi lại không nhân đôi.
Nút "Đẩy N thẻ đang chờ" đẩy cả thẻ lưu **trước khi** kết nối tài khoản.

### Vì sao không đọc cookie (cách ở v0.8.0)

v0.8.0 đọc cookie phiên web bằng `chrome.cookies` — `httpOnly` không chặn API đó. Nhưng:

- **Nhiều browser profile**: cookie jar riêng theo profile ⇒ phải đăng nhập web ở **từng** profile
- Cần quyền **`cookies`** — quyền mạnh, store sẽ chất vấn khi review
- Extension dùng **chung phiên** với web ⇒ không thu hồi riêng extension được

Mã ghép nối bỏ được cả ba. Đổi lại: copy-paste một lần, và **đăng xuất web không còn tự động
ngắt extension** (phải bấm "Ngắt kết nối" trong popup, hoặc xoá dòng `sessions` ở DB).
Xem ADR-29.

### Quyền & CORS

`permissions` chỉ còn `storage, contextMenus, offscreen, alarms` — **không có `cookies`**,
và **không xin host permission** cho API. Extension gọi API dựa vào CORS: đã kiểm chứng
preflight `OPTIONS` trả 204 + `Access-Control-Allow-Origin: chrome-extension://<id>`.

⚠️ **Khi phát hành phải đặt `ALLOWED_EXTENSION_IDS` ở server.** Để trống nghĩa là **mọi**
extension gọi được API — chỉ chấp nhận lúc dev, vì extension ID đổi theo cách đóng gói (ADR-30).

Đổi địa chỉ server ở popup → **Địa chỉ server**. Đổi server thì token cũ bị xoá (nó vô nghĩa
với server khác), trạng thái về "chưa kết nối".

## Việc tiếp theo (M1)

Extension **giữ local-first** (ADR-20) — bắt từ không được thất bại vì mất mạng. Nhưng khi đã
đăng nhập, mỗi lần lưu thẻ sẽ đẩy lên backend:

```
Bấm ＋ Lưu thẻ → ghi local (luôn thành công)
                 → đã đăng nhập? → POST /v1/cards
                                    ├─ 201 → đánh dấu synced
                                    ├─ 409 → "thẻ đã có sẵn trong deck X"
                                    └─ lỗi → outbox, retry backoff
```

Outbox này **một chiều đẩy lên**: không pull, không cursor, không tombstone, không merge —
nhỏ hơn sync engine rất nhiều. Token lấy từ web app qua `externally_connectable`, không tự chạy
OAuth (ADR-15). Chi tiết: [../PLATFORM.md §4](../PLATFORM.md).

Extension **không** chứa `anon` key hay bất kỳ credential nào của DB — chỉ có `API_BASE_URL`
(ADR-21). Đây là lý do chính có backend.

## Việc tiếp theo (M1)

1. Settings: chọn/đổi thứ tự provider, cặp ngôn ngữ đích, phím kích hoạt, blacklist domain; thêm Wiktionary + LibreTranslate self-host làm đường lùi khi Google bị chặn.
2. Chuyển sang Dexie + FSRS (`ts-fsrs`), màn học Text/Typing.
4. Settings: cặp ngôn ngữ, phím kích hoạt, blacklist domain (FR-A5 — hiện chỉ hardcode loại trừ vài trang store).
