# Remember — Đặc tả yêu cầu chức năng

> Phiên bản: 0.1 (draft) · Ngày: 2026-08-31
> Phạm vi tài liệu: **chỉ mô tả chức năng**. Kiến trúc xem [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Bối cảnh & mục tiêu

### 1.1 Sản phẩm tham chiếu
**Remember** là bản dựng lại của **Rememberry** — một browser extension học ngoại ngữ đang có trên Chrome Web Store và Firefox AMO. Cơ chế cốt lõi được kế thừa: người dùng bôi đen / double-click một từ hay cụm từ trên bất kỳ trang web nào → bong bóng dịch hiện ra ngay tại chỗ → 1 click lưu thành flashcard → hệ thống spaced repetition (SRS) nhắc ôn đúng lúc trước khi quên.

*Từ đây trở xuống, "Remember" là sản phẩm được đặc tả trong tài liệu này; "Rememberry" chỉ dùng khi nói về sản phẩm gốc.*

### 1.2 Mục tiêu

| # | Mục tiêu | Thước đo |
|---|---|---|
| G1 | Học từ vựng **không rời khỏi ngữ cảnh đọc** | ≤ 2 hành động từ "thấy từ lạ" → "đã có thẻ" |
| G2 | Ghi nhớ dài hạn bằng SRS hiện đại (FSRS) | retention mục tiêu cấu hình được (mặc định 90%) |
| G3 | **Offline-first chỉ ở extension** (ADR-20) | extension: bắt từ + lưu thẻ chạy offline. **Web app: cần kết nối** |
| G4 | Đa thiết bị qua **backend API** (ADR-21) | web đọc/ghi trực tiếp server; extension đẩy thẻ lên khi đã đăng nhập |
| G5 | **Chi phí hạ tầng = 0đ** ở quy mô cá nhân/nhóm nhỏ | xem §6 và ARCHITECTURE §2 |
| G6 | Không lock-in dữ liệu | export/import JSON/CSV + đọc Anki apkg |

### 1.3 Ngoài phạm vi (v1)
Học ngữ pháp có cấu trúc; luyện nói / đánh giá phát âm bằng ASR; nội dung khoá học có sẵn; mobile app native; mạng xã hội / leaderboard công khai; dịch toàn trang.

---

## 2. Người dùng & bối cảnh sử dụng

| Persona | Nhu cầu chính | Ràng buộc |
|---|---|---|
| **P1 – Người tự học** (chủ đạo) | đọc báo/blog tiếng nước ngoài, gặp từ lạ, muốn nhớ | không muốn thao tác rườm rà, ghét mở app khác |
| **P2 – Sinh viên / thi cử** | học bộ từ theo chủ đề, cần thống kê tiến độ | cần deck có cấu trúc, cần deadline |
| **P3 – Dev/reader tài liệu kỹ thuật** | thuật ngữ chuyên ngành, cần **định nghĩa** hơn là dịch | thẻ dạng từ → định nghĩa cùng ngôn ngữ |
| **P4 – Giáo viên (v2)** | tạo & chia sẻ deck cho học viên | cần deck public / link chia sẻ |

**Bối cảnh chính:** desktop Chrome/Edge/Firefox, đang đọc web hoặc PDF; quãng ôn tập ngắn 3–10 phút (chờ tàu, giữa hai việc); nghe thụ động khi đi lại (playback mode).

---

## 3. Bản đồ chức năng

```
Remember
├── A. Capture (bắt từ)   A1 dịch inline · A2 tra trong popup · A3 PDF · A4 highlight in-page · A5 blacklist
├── B. Card & Deck        B1 cấu trúc thẻ · B2 deck & tag · B3 trùng lặp · B4 tìm kiếm · B5 import/export
├── C. Study (ôn tập)     C1 lịch FSRS · C2 4 study mode · C3 mini-session in-page · C4 leech · C5 undo
├── D. Progress           D1 thống kê · D2 streak & mục tiêu · D3 heatmap · D4 nhắc nhở
├── E. Sync & Account     E1 local-only · E2 tài khoản · E3 sync delta · E4 backup & xoá
└── F. Settings           F1 cặp ngôn ngữ · F2 provider dịch · F3 phím tắt/theme · F4 quyền riêng tư
```

---

## 4. Yêu cầu chức năng chi tiết

Ký hiệu: **[M]** must-have v1 · **[S]** should-have · **[C]** could-have (v2).

### A. Capture — bắt từ trong ngữ cảnh

**FR-A1 · Dịch inline khi chọn văn bản** [M]
- Kích hoạt: bôi đen text, hoặc double-click 1 từ, hoặc bôi đen + giữ phím kích hoạt (cấu hình: none / Alt / Ctrl / Shift), hoặc chuột phải → menu ngữ cảnh.
- Kết quả: bong bóng (bubble) neo cạnh vùng chọn, hiển thị:
  - bản dịch chính + các nghĩa **nhóm theo từ loại** (noun/verb/adj…),
  - phiên âm / transliteration nếu có,
  - nút **🔊 phát âm** (ngôn ngữ nguồn và ngôn ngữ đích),
  - **reverse translation** (dịch ngược để kiểm chứng nghĩa),
  - synonym / antonym / định nghĩa nếu provider có,
  - câu ví dụ, và **câu chứa từ lấy từ trang đang đọc** (context sentence).
- Nút hành động: **＋ Lưu thẻ** · sao chép · đổi cặp ngôn ngữ · mở chi tiết.
- Bubble không được đẩy layout trang (overlay), tự lật vị trí khi sát biên viewport, đóng bằng `Esc` / click ra ngoài.
- Giới hạn: đoạn chọn > 200 ký tự → chỉ dịch, cảnh báo "quá dài để làm thẻ".

**FR-A2 · Tra từ trong popup extension** [M]
Ô nhập tự do, chọn cặp ngôn ngữ, lịch sử 50 lượt tra gần nhất, lưu thẻ trực tiếp.

**FR-A3 · Hoạt động trong PDF** [S]
Hỗ trợ PDF mở bằng viewer tích hợp của trình duyệt (có text layer). PDF ảnh/scan (cần OCR) ngoài phạm vi v1.

**FR-A4 · Highlight thẻ đã lưu trên trang** [S]
- Từ đã có thẻ được tô nhẹ ngay trên trang đang đọc (bật/tắt, chọn màu/độ đậm).
- Hover vào highlight → tooltip nghĩa + trạng thái thẻ (due / đã học / leech).
- So khớp trên **lemma/normalized form** để không bỏ sót biến thể đơn giản (số nhiều, thời).
- Không highlight trong `input`, `textarea`, `contenteditable`, `code`/`pre` (tuỳ chọn).

**FR-A5 · Danh sách domain loại trừ** [M]
Blacklist/whitelist domain: không chèn content script (ví dụ trang nội bộ, ngân hàng).

### B. Card & Deck

**FR-B1 · Cấu trúc thẻ** [M]
Một thẻ gồm: `front` (từ/cụm), `back` (nghĩa đã chọn — cho phép chọn nhiều nghĩa), `lang_from`/`lang_to`, `reading` (phiên âm), `context_sentence`, `source_url` + `source_title`, `tags[]`, `deck_id`, `note`, `audio_ref`, `created_at`. Sửa được toàn bộ sau khi lưu.

**FR-B2 · Deck & tag** [M]
- Deck phẳng có thư mục 1 cấp (`Deck > Subdeck`); mỗi thẻ thuộc **1** deck, **n** tag.
- Deck mặc định tự tạo theo cặp ngôn ngữ (`EN → VI`); rule tự động gán deck theo domain nguồn [C].
- Thao tác hàng loạt: chọn nhiều thẻ → đổi deck / gắn tag / xoá / reset tiến độ.

**FR-B3 · Trùng lặp** [M]
Khi lưu, nếu `front` (normalized) + cặp ngôn ngữ đã tồn tại → cảnh báo và cho chọn: gộp nghĩa vào thẻ cũ / vẫn tạo thẻ mới / mở thẻ cũ.

**FR-B4 · Tìm & duyệt** [M]
Danh sách thẻ có tìm kiếm full-text (front/back/note/context), filter theo deck, tag, trạng thái SRS (new/learning/review/suspended/leech), khoảng ngày, sắp xếp; phân trang ảo cho ≥ 10k thẻ.

**FR-B5 · Import / Export** [M]
- Export: JSON (đầy đủ, gồm lịch sử ôn), CSV (front,back,tags,deck).
- Import: CSV/TSV có map cột; JSON của chính app; **đọc Anki apkg** [S], **ghi apkg** [C].
- Import phải idempotent (chạy 2 lần không nhân đôi thẻ) và có preview + rollback.

**FR-B6 · Ảnh / audio đính kèm** [C]
Đính ảnh gợi nhớ (paste/URL) và audio tải sẵn để dùng offline.

### C. Study — ôn tập

**FR-C1 · Lịch SRS bằng FSRS** [M]
- Thuật toán **FSRS** (open-source, MIT) thay SM-2: mỗi thẻ có `stability`, `difficulty`, `state`, `due`, `reps`, `lapses`.
- Thang đánh giá 4 mức: **Again / Hard / Good / Easy**; hiển thị khoảng lặp dự kiến trên mỗi nút.
- Tham số cấu hình: retention mục tiêu, giới hạn thẻ mới/ngày, giới hạn thẻ ôn/ngày, learning steps, interval tối đa, **múi giờ + giờ bắt đầu ngày** (mặc định 4:00).
- Sắp thẻ: due trước → xen thẻ mới theo tỷ lệ; **burying** thẻ cùng gốc trong một ngày [S].
- **Optimizer** [S]: tính lại tham số FSRS từ `review_logs` của chính người dùng (chạy local trong worker; cần ≥ 400 review) — không gửi dữ liệu ra ngoài.
- Ghi **review_log** đầy đủ cho mọi lần trả lời (kèm thời gian phản hồi) — bắt buộc, vì optimizer và mọi thống kê phụ thuộc nó.

**FR-C2 · Sáu chế độ ôn tập** — ĐÃ LÀM

| Mode | Hỏi gì → làm gì | Cần dữ liệu | Trạng thái |
|---|---|---|---|
| **Nhận biết** (`recognition`) | thấy `front` → tự nhớ → mở `back` | — | ✅ |
| **Gõ nghĩa Việt** (`typeVi`) | thấy `front` → gõ nghĩa tiếng Việt | `back` | ✅ |
| **Nghe rồi gõ** (`dictation`) | nghe phát âm (ẩn từ **và IPA**) → gõ `front` | TTS | ✅ |
| **Gõ ngược** (`typeEn`) | thấy nghĩa Việt → gõ `front` | `back` | ✅ |
| **Điền vào câu** (`cloze`) | câu ngữ cảnh khuyết từ → gõ từ còn thiếu | `contextSentence` chứa `front` | ✅ |
| **Trắc nghiệm** (`choice`) | chọn nghĩa đúng trong 4 đáp án | `back` + ≥3 nghĩa khác trong deck | ✅ |

- **Chọn mode trong cài đặt**: bật một hoặc nhiều. Mỗi thẻ rút **ngẫu nhiên** một mode trong
  (đã bật ∩ dùng được với thẻ đó). Không tắt được mode cuối cùng.
- **Chấm bài gõ**: bỏ dấu để so (gõ `kien cuong` vẫn đúng với `kiên cường`), mọi nghĩa của thẻ
  đều tính đúng, sai ≤1 ký tự (≤2 với từ ≥8 ký tự) là *gần đúng* và hiện dạng đúng.
- **Gõ đúng vẫn phải tự chấm 4 mức** cho FSRS: máy biết đúng/sai, không biết dễ/khó.
- Ô nhập tắt `autocorrect`/`autocapitalize`/`spellcheck` — iOS tự sửa thì bài tập vô nghĩa.
- Phím tắt: `Enter` nộp bài gõ, `Space` mở đáp án (mode nhận biết), `1–4` chấm điểm, `R` phát âm.
- Còn thiếu: **Playback** (nghe thụ động tuần tự, chạy nền, media key) [S].

**FR-C3 · Mini-session ngay trên trang** [S]
Widget nhỏ (góc trang, thu gọn được) hiện số thẻ đến hạn; click → ôn 5–10 thẻ ngay trong overlay, không rời trang đang đọc. Đóng lại vẫn giữ tiến độ.

**FR-C4 · Xử lý thẻ khó (leech)** [S]
Thẻ `lapses ≥ N` (mặc định 8) → gắn tag `leech` + hành động cấu hình (suspend / chỉ cảnh báo), gợi ý viết lại thẻ hoặc thêm ảnh/mnemonic.

**FR-C5 · Undo** [M]
Hoàn tác lần chấm điểm gần nhất (tối thiểu 1 bước, mục tiêu 10 bước trong session).

### D. Progress

- **FR-D1 · Thống kê** [M] — số thẻ theo trạng thái; review/ngày (30/90/365 ngày); dự báo lượng ôn 30 ngày tới; retention thực tế (true retention) theo tháng; thời gian học; phân bố interval.
- **FR-D2 · Mục tiêu & streak** [S] — mục tiêu ngày (số thẻ hoặc số phút), streak, freeze 1 ngày/tuần.
- **FR-D3 · Heatmap** [S] — lịch dạng heatmap theo ngày.
- **FR-D4 · Nhắc nhở** [S] — thông báo hệ thống khi có thẻ đến hạn; khung giờ + tần suất cấu hình được; tắt hẳn được.

### E. Sync & Account

**FR-E1 · Local-only** [M] — **chỉ còn ở extension** (ADR-20)
Extension: dùng được toàn bộ chức năng bắt từ và lưu thẻ mà không cần đăng ký; không có tài khoản = không gửi dữ liệu thẻ nào ra server.
**Web app: bắt buộc đăng nhập** — không có chế độ dùng thử không tài khoản, vì server là nguồn sự thật.

**FR-E2 · Tài khoản (tuỳ chọn)** [M]
Email + magic link / OAuth (Google, GitHub). Đăng nhập lần đầu: merge dữ liệu local vào cloud (không ghi đè).

**FR-E3 · Dữ liệu qua backend API** [M] — *thay cho "sync delta hai chiều" ở bản trước (ADR-20/21)*
- **Web app:** không có bản sao local, không có sync. Mọi đọc/ghi đi qua `/v1`. Ghi thất bại = lượt
  chấm **không xảy ra** ⇒ UI hiện lỗi và **chặn chấm tiếp** cho tới khi ghi xong. Offline → màn "cần kết nối".
- **Extension:** giữ local-first. Lưu thẻ ghi local trước (luôn thành công), rồi `POST /v1/cards`
  nếu đã đăng nhập. Lỗi mạng → `outbox`, retry backoff. **Một chiều đẩy lên**: không pull,
  không cursor, không tombstone, không merge.
- Idempotent: `id` do client sinh (UUID), server upsert theo `id` ⇒ gửi lại không nhân đôi.
- Trùng lặp xử lý ở **server** (unique index `cards_dedupe`): trả `409` kèm deck đang chứa thẻ đó.
- Trạng thái hiển thị rõ: `đã đồng bộ / chờ N thẻ / chưa đăng nhập / lỗi` + thời điểm cuối.

**FR-E4 · Backup & xoá dữ liệu** [M]
Export thủ công bất kỳ lúc nào; auto-backup định kỳ ra file tải về [S]; **xoá tài khoản → xoá sạch dữ liệu server trong ≤ 30 ngày**, có xác nhận 2 bước.

### F. Settings

- **FR-F1 · Cặp ngôn ngữ** [M] — ngôn ngữ đích chính + danh sách nguồn hay dùng; **auto-detect** ngôn ngữ nguồn (theo `lang` của trang + detect theo text).
- **FR-F2 · Provider dịch cắm-rút được** [M] — chọn provider trong danh sách miễn phí; có **chuỗi fallback** khi lỗi/hết quota; cho phép nhập endpoint self-host (LibreTranslate) và API key riêng. Chi tiết ARCHITECTURE §3.
- **FR-F3 · Phím tắt & giao diện** [M] — remap phím tắt, theme sáng/tối/hệ thống, cỡ chữ, ngôn ngữ UI (vi/en trước).
- **FR-F4 · Minh bạch quyền riêng tư** [M] — onboarding nói rõ: text nào được gửi đi, gửi tới provider nào, cái gì ở lại máy; tắt hoàn toàn provider online (chỉ dùng từ điển offline đã tải) [C].

---

## 5. Yêu cầu phi chức năng (NFR)

| ID | Nhóm | Yêu cầu |
|---|---|---|
| NFR-1 | Hiệu năng | Bubble xuất hiện ≤ 100ms sau khi chọn (skeleton); kết quả dịch ≤ 800ms p90 (mạng bình thường), ≤ 50ms nếu cache hit |
| NFR-2 | Hiệu năng | Content script ≤ 60KB gzip, không gây jank (INP ≤ 200ms) trên trang nặng; highlight ≤ 30ms cho trang 5k từ, chạy incremental + `requestIdleCallback` |
| NFR-3 | Quy mô dữ liệu | Mượt với 20.000 thẻ / 500.000 review_log trên máy phổ thông |
| NFR-4 | Offline | **Extension**: bắt từ + lưu thẻ hoạt động offline (dịch xếp hàng sau). **Web app**: yêu cầu kết nối; offline hiện màn "cần kết nối", không có chế độ giảm cấp (ADR-20) |
| NFR-5 | Tương thích | Chrome/Edge/Brave (MV3) + Firefox (MV3, `browser.*` polyfill). Safari [C] |
| NFR-6 | Bảo mật | Không `eval` / remote code (MV3 CSP); token trong `chrome.storage.session` khi có thể. **Client không chứa `anon`/`service_role` key** — chỉ có `API_BASE_URL` (ADR-21). Hai lớp phân quyền: Worker kiểm JWT + RLS là lưới an toàn (ADR-22) |
| NFR-7 | Quyền riêng tư | Không gửi nội dung trang; chỉ gửi **đoạn text người dùng chủ động chọn**. Telemetry mặc định **tắt**, opt-in, ẩn danh |
| NFR-8 | Quyền hệ thống | Xin quyền tối thiểu: `activeTab` / `optional_host_permissions` thay vì `<all_urls>` bắt buộc; `storage`, `alarms`, `contextMenus`, `scripting` |
| NFR-9 | Chi phí | 0đ ở mức ≤ ~1.000 người dùng active (hạn mức free-tier: ARCHITECTURE §2.3) |
| NFR-10 | Bảo trì | Domain logic (SRS, sync, dedupe) là TypeScript thuần, **không phụ thuộc API trình duyệt** → test bằng Vitest không cần browser; coverage domain ≥ 80% |
| NFR-11 | A11y | Điều hướng bàn phím hoàn toàn; contrast AA; screen reader ở màn học; tôn trọng `prefers-reduced-motion` |
| NFR-12 | i18n | Mọi chuỗi UI qua catalog; không hardcode; RTL-ready |
| NFR-13 | Độ tin cậy | Không mất dữ liệu: mọi ghi qua transaction IndexedDB + outbox bền; crash giữa session không mất quá 1 lần chấm điểm |
| NFR-14 | Observability | Log lỗi opt-in; màn "Diagnostics" tự chẩn (kích thước DB, sync cuối, quota provider) |

---

## 6. Ràng buộc "công cụ miễn phí"

1. **Chỉ dùng free tier / open-source self-host.** Không dịch vụ trả phí bắt buộc.
2. **Giới hạn phải được thiết kế vào sản phẩm**, không chỉ ghi chú: cache dịch, hạn mức theo ngày cho từng provider, chuỗi fallback, và luôn có đường lùi "hoạt động không cần server".
3. **Không phụ thuộc một vendor duy nhất**: mọi thành phần server-side phải thay được trong ≤ 1 tuần (ARCHITECTURE §2.4 — exit plan).
4. Khoản **không** miễn phí, phải nói rõ: **phí đăng ký Chrome Web Store 5 USD (một lần)**. Firefox AMO và Microsoft Edge Add-ons: miễn phí → có thể phát hành Firefox trước để giữ 0đ tuyệt đối.
5. Tuân thủ ToS của provider dịch: các proxy không chính thức chỉ đặt ở vị trí **tuỳ chọn / self-host**, không làm default cho bản phát hành công khai.

---

## 7. Luồng người dùng chính

**J1 — Bắt từ đầu tiên (time-to-value)**
Cài extension → onboarding 3 bước (chọn ngôn ngữ đích · chọn cách kích hoạt · lời hứa quyền riêng tư) → mở trang demo → bôi đen 1 từ → thấy bubble → click ＋ → toast "Đã lưu vào EN→VI".
*Mục tiêu: ≤ 60 giây từ lúc cài đến thẻ đầu tiên.*

**J2 — Ôn tập buổi sáng**
Badge icon hiện `23` → click → "Ôn ngay (23 thẻ, ~6 phút)" → Text mode → chấm điểm bằng `1–4` → hết thẻ: tóm tắt (đúng %, thời gian, streak +1) → gợi ý "còn 10 thẻ mới, học thêm?".

**J3 — Đọc bài dài với highlight**
Bật highlight → các từ đã lưu sáng nhẹ → hover xem lại nghĩa → widget báo "8 thẻ đến hạn có trong trang này" → mini-session ngay tại chỗ.

**J4 — Thêm thiết bị thứ hai**
Máy B: cài → đăng nhập → "đang tải 1.240 thẻ" → dữ liệu khớp máy A → sửa thẻ ở B, quay lại A thấy đã cập nhật.

**J5 — Provider hết quota**
Dịch lỗi → bubble hiện "Provider chính hết hạn mức hôm nay, đã dùng nguồn dự phòng (MyMemory)" → vẫn có kết quả → Settings hiện đồng hồ quota. *Không bao giờ hiện lỗi trắng.*

---

## 8. Ưu tiên & lộ trình

| Mốc | Nội dung | Định nghĩa hoàn thành |
|---|---|---|
| **M0 – Spike** | 1 provider dịch + bubble thô + lưu IndexedDB | dịch được và lưu được 1 thẻ |
| **M1 – Local MVP** | A1, A2, A5, B1–B4, C1 (FSRS), C2 Text+Typing, C5, D1, F1–F4 | dùng hàng ngày được, không cần server |
| **M2 – Backend** | Worker API `/v1`, đăng nhập Google/OTP, web app chuyển sang server-authoritative, extension outbox đẩy lên | thẻ lưu ở extension hiện trên web sau khi đăng nhập; ghi lỗi không mất dữ liệu |
| **M3 – In-page** | A3 PDF, A4 highlight, C3 mini-session, C4 leech | đọc–học liền mạch, không rời trang |
| **M4 – Depth** | C2 Audio + Playback, D2–D4, B5 apkg, FSRS optimizer | tính năng ngang bản gốc |
| **M5 – Ship** | Firefox AMO → Edge → Chrome; landing page; privacy policy | có bản public cài được |

---

## 9. Rủi ro & đối phó

| Rủi ro | Ảnh hưởng | Đối phó |
|---|---|---|
| API dịch free bị giới hạn / đổi ToS / chết | cao — mất chức năng cốt lõi | lớp provider trừu tượng + ≥ 3 nguồn + cache + cho nhập key/self-host riêng |
| Chất lượng dịch free kém hơn Google | trung bình | ưu tiên nguồn **từ điển** (định nghĩa, từ loại, ví dụ) thay vì chỉ MT; ghép nhiều nguồn |
| MV3 service worker bị kill (~30s idle) | mất state, sync dở | không giữ state trong SW; dùng `chrome.alarms`, ghi tiến trình vào IndexedDB, mọi tác vụ idempotent |
| Free tier DB tự pause / hết dung lượng | sync dừng | app vẫn chạy local-only; cảnh báo trong Diagnostics; hạ tầng thay được (§2.4) |
| DOM trang lạ làm vỡ bubble/highlight | trung bình | Shadow DOM cô lập CSS; không sửa DOM gốc khi highlight (dùng CSS Custom Highlight API nếu có) |
| Trôi phạm vi (thành "Anki + Duolingo") | tiến độ | khoá phạm vi theo M1; mọi thứ khác đẩy về §1.3 |

---

## 10. Câu hỏi cần chốt

1. Cặp ngôn ngữ ưu tiên v1? (giả định: **EN → VI**, cộng chiều ngược VI → EN)
2. Chỉ Chrome, hay ship **Firefox trước** để giữ chi phí 0đ tuyệt đối?
3. Sync có nằm trong v1, hay M1 local-only là đủ để dùng thật?
4. Có cần **web app** ôn tập (ngoài extension) trong v1, hay chỉ dùng tab của extension?
5. Deck chia sẻ / nhiều người (P4) có nằm trong roadmap 6 tháng không?
