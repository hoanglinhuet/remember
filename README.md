# Remember

Học từ vựng ngay trong lúc đọc web: bôi đen từ → tra nghĩa tại chỗ → lưu thành flashcard →
ôn tập bằng spaced repetition (FSRS). Dựng lại từ **Rememberry**, trên toàn bộ công cụ miễn phí.

---

## Trạng thái hiện tại (2026-09-03)

| Thành phần | Trạng thái | Chạy thử |
|---|---|---|
| [`extension/`](extension/) | **v0.10.2 — dùng được** | `chrome://extensions` → Load unpacked |
| [`apps/web/`](apps/web/) | **dùng được** — Next.js 16 + TS, frontend *và* backend API | `cd apps/web && npm i && npm run dev` |
| [`infra/`](infra/) | Postgres 17 trong Docker, 4 file migration | `cd infra && docker compose up -d` |
| [`web/`](web/) | **cũ, chỉ để tham khảo** — bản Vite local-only, đã bị `apps/web` thay | — |
| [`infra/supabase/`](infra/supabase/) | **SQL cũ, đã bị thay** — đừng chạy; migration đúng nằm ở `infra/postgres/` | — |

Triển khai lên Vercel: đọc [`DEPLOY.md`](DEPLOY.md).
Dùng Supabase làm database: đọc [`infra/SUPABASE.md`](infra/SUPABASE.md). Supabase ở đây chỉ là
một Postgres được host — **không** cần `SUPABASE_URL`/`ANON_KEY`, và `005_supabase_lockdown.sql`
là **bắt buộc** (nếu không, anon key công khai đọc được `sessions` và `users`).

**Đã làm được:** **highlight từ đã lưu ngay trên trang đang đọc** (extension, tắt được trong
popup) · quản lý trên web: bộ thẻ **thêm · đổi tên · xoá** (xoá bộ thì chọn dồn thẻ
sang bộ khác hay xoá luôn), thẻ trong bộ **xem · tìm · xoá** · bắt từ bằng cách bôi đen (icon nổi, panel có IPA + loại từ tiếng Việt + dịch ngược
+ giọng nữ Google) · deck và danh sách thẻ **lấy qua API** · dedupe theo *từ + loại từ + nghĩa Việt*,
hiện "đã lưu" ngay lúc tra · đăng nhập Google **tự làm** (PKCE + session token riêng, không qua
Supabase Auth) · extension kết nối tài khoản bằng **mã ghép nối** · phiên ôn FSRS **theo đúng cơ chế
Anki** (hàng đợi động, learn-ahead, hạn mức theo ngày, day cutoff 4:00, leech) · bậc độ nhớ 1–5 ·
**6 chế độ ôn tập** (nhận biết · gõ nghĩa Việt · nghe rồi gõ · gõ ngược · điền vào câu · trắc nghiệm),
chọn được nhiều mode và rút ngẫu nhiên mỗi thẻ · tra từ trên web · thống kê · cài đặt.

**Chưa làm:** import/export trong `apps/web` (bản `web/` cũ có) · PWA manifest
chưa port · mode **Playback** (nghe thụ động chạy nền) · deploy Vercel thật
(cấu hình `sin1` đã sẵn) · gia hạn phiên trượt (30 ngày là hết hạn cứng, kể cả người dùng hằng ngày).

---|---|---|
| [`extension/`](extension/) | **v0.7.0 — dùng được** | `chrome://extensions` → Load unpacked |
| [`web/`](web/) | **v0.1 — dùng được** (còn local-only) | `cd web && npm i && npm run dev` |
| `apps/api/` | **chưa có** — bước kế tiếp | — |
| [`infra/supabase/`](infra/supabase/) | SQL đã viết, **chưa deploy** | cần project Supabase |

**Đã làm được:** bắt từ bằng cách bôi đen (icon nổi, panel có IPA + loại từ tiếng Việt + dịch ngược
+ giọng nữ Google) · deck · dedupe · phiên ôn FSRS **theo đúng cơ chế Anki** (hàng đợi động, learn-ahead,
hạn mức theo ngày, day cutoff 4:00, leech) · bậc độ nhớ 1–5 · tra từ trên web · PWA cài được vào
điện thoại · import/export.

**Chưa làm:** backend API · tài khoản · đồng bộ thật (hiện chuyển thẻ bằng file export) · typing/audio
mode · sửa-xoá thẻ trên web · highlight in-page.

---

## Tài liệu

Đọc theo thứ tự này nếu mới vào:

| Tài liệu | Nội dung | Khi nào đọc |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | Chức năng: 4 persona, ~30 FR, 14 NFR, lộ trình M0–M5 | muốn biết sản phẩm làm gì |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc + **22 ADR** (quyết định và lý do) | muốn biết vì sao làm như vậy |
| [PLATFORM.md](PLATFORM.md) | **Nguồn đúng nhất** về API, đa client, Google SSO, deploy | đang xây backend |
| [SYNC.md](SYNC.md) | Hạn mức free-tier, dung lượng, domain, bảo mật DB. ⚠️ **có banner đánh dấu phần đã lỗi thời** | cần số liệu hạ tầng |
| [extension/README.md](extension/README.md) | Cài, luồng bắt từ, provider dịch, cái bẫy CORS/ORB | làm việc với extension |
| [web/README.md](web/README.md) | Chạy trên điện thoại, cơ chế Anki, bậc độ nhớ, so sánh với Anki | làm việc với web app |
| [infra/supabase/](infra/supabase/) | `001_init.sql` (schema + RLS) · `002_quota.sql` (hạn mức, bỏ ở quy mô cá nhân) | deploy DB |

**Tài liệu này ghi cả những chỗ tôi đã sai và sửa lại** — ADR bị lật đều giữ nguyên phần lý do cũ
kèm lý do lật, để không ai lặp lại cùng một lập luận sai.

---

## Kiến trúc chốt

```
                    tra từ (client tự gọi, KHÔNG qua API — ADR-12)
              ┌─────────────────────────────────────────────┐
              ▼                                             │
   Google Translate · freedictionaryapi.com                  │
                                                            │
  Extension MV3  ──── local-first (IndexedDB) ──────────────┤
   bắt từ trong ngữ cảnh                                    │
   lưu thẻ → nếu đã đăng nhập → POST /v1/cards ─────┐        │
                                                    ▼        │
  Web PWA  ──── server-authoritative (ADR-20) ──►  Worker API /v1  ──►  Supabase
   ôn tập trên điện thoại                          (Hono, Cloudflare)     Postgres + RLS
                                                    ▲
                                     giữ SUPABASE_URL + ANON_KEY làm secret
```

**Bốn nguyên tắc không đổi:**

1. **Backend API là đường duy nhất tới DB** (ADR-21) — client không chứa `anon` key, chỉ có
   `API_BASE_URL`. Đây là cách đúng để một extension công khai không phơi kết nối DB.
2. **Lời gọi dịch luôn đi từ máy người dùng** (ADR-12) — proxy qua server nghĩa là một IP gọi thay
   tất cả, Google chặn IP đó là cả hệ thống mất chức năng dịch.
3. **RLS là lưới an toàn thứ hai** (ADR-22) — Worker chuyển tiếp JWT của user, nên một bug kiểu quên
   `where user_id` bị DB chặn thay vì rò dữ liệu.
4. **Extension offline được, web thì không** (ADR-20) — bắt từ không được thất bại vì mất mạng;
   ôn tập thì đánh đổi offline để khỏi phải xây sync engine.

---

## Chi phí

| | |
|---|---|
| Cloudflare Workers + Pages · Supabase · Google OAuth · GitHub Actions | **0đ** |
| Chrome Web Store (một lần, nếu muốn phát hành) | 5 USD |
| Firefox AMO · Edge Add-ons · `*.pages.dev` | 0đ |

**Trần sẽ chạm trước:** Supabase 500MB ≈ 200 user (SYNC §5), rồi Workers 100k req/ngày.
Dùng cá nhân thì không chạm tới cái nào — nhưng **Supabase free pause sau 7 ngày không hoạt động,
và từ ADR-20 thì pause = app chết**, nên cron `keepalive()` là bắt buộc.

---

## Bước kế tiếp

1. ✋ **Cần bạn:** thử 6 mode ôn tập trên điện thoại — bàn phím ảo và nút phát lại là chỗ dễ khó dùng nhất
2. Sửa/xoá thẻ trên web (giờ chỉ tạo được)
3. Port import/export và PWA manifest từ `web/` sang `apps/web/`
4. Trước khi public: đặt `ALLOWED_EXTENSION_IDS` ở server (ADR-30 — để trống là **mọi** extension gọi được API)

Nợ kỹ thuật đã biết: `senseKey()` tồn tại ở ~4 chỗ và `providers.js` (extension) song song với
`lookup.ts` (web) — đúng thứ mà `packages/domain` sẽ chặn, nhưng extension là vanilla JS không bundle.

---

## Ghi chú pháp lý

Hai endpoint của Google (`translate_a/single`, `translate_tts`) là **không chính thức**: không key,
không quota công bố, nằm ngoài ToS, có thể bị chặn hoặc đổi format bất kỳ lúc nào (ADR-10).
Vì vậy luôn có fallback chain và mọi lỗi tra từ đều là **lỗi mềm** — không được làm chết luồng học.

Dữ liệu định nghĩa/IPA từ [freedictionaryapi.com](https://freedictionaryapi.com) có nguồn Wiktionary,
giấy phép **CC BY-SA 4.0** — bắt buộc ghi công trong UI (đã làm ở cả extension và web).
