# Remember — Lưu trữ, tài khoản & đồng bộ

> ### ⚠️ Trạng thái tài liệu (cập nhật 2026-09-02)
> Kiến trúc đã đổi hai lần sau khi tài liệu này được viết. **Phần còn hiệu lực và phần đã bị thay:**
>
> | Mục | Trạng thái |
> |---|---|
> | §2 hạn mức free-tier · §5 dung lượng · §6 domain | ✅ còn hiệu lực |
> | [`001_init.sql`](infra/supabase/001_init.sql) — schema, RLS, trigger | ✅ còn hiệu lực |
> | §3 tài khoản (OTP/token) | 🟠 còn đúng về cơ chế, nhưng client giờ lấy token từ GoTrue rồi gọi **API**, không gọi PostgREST |
> | §4 "client gọi PostgREST trực tiếp" | ❌ **bị thay bởi ADR-21** → [PLATFORM.md §4](PLATFORM.md) |
> | §7 per-field vs row LWW · §8 khi nào cần API · §8b anon key public | ❌ **bị thay bởi ADR-20/21** |
> | §8c `002_quota.sql` | 🟠 không dùng ở quy mô cá nhân (PLATFORM §9) |
> | §9 checklist | ❌ xem PLATFORM §8 |
>
> **Kiến trúc hiện tại:** client (extension, web) → **Worker API `/v1`** → PostgREST → Postgres.
> Web app **không** offline (ADR-20). Extension giữ local-first + outbox một chiều đẩy lên.
> Nguồn đúng nhất về API và luồng dữ liệu: **[PLATFORM.md §4](PLATFORM.md)**.
>
> ⚠️ Số liệu free-tier là tại 2026-08/09; phải kiểm lại trang giá trước khi chốt.

---

## 1. Quyết định

| Câu hỏi | Chốt | Vì sao |
|---|---|---|
| DB + auth | **Supabase free** (Postgres + GoTrue + RLS) | 500MB đủ cho ~200 user dùng thật (§5); GoTrue cấp JWT, Worker xác thực |
| Đăng nhập | **Email OTP 6 số** (`signInWithOtp` → `verifyOtp`) | không cần redirect, không cần domain, không cần OAuth app. Xem §3 |
| Client ↔ server | ~~`fetch` thẳng tới PostgREST~~ → **qua Worker API `/v1`** (ADR-21) | client không cần `anon` key; xem PLATFORM §4 |
| Domain | **Không cần** cho sync. Landing/privacy dùng `*.pages.dev` hoặc `*.github.io` | xem §6 — domain miễn phí thật sự **không còn tồn tại** |
| Plan B | **Cloudflare D1 + Workers** | khi vượt 500MB hoặc không chịu được project pause |
| API trung gian | ~~Không có~~ → **có, và là đường duy nhất tới DB** (ADR-21) | `anon` key không được nằm trong extension công khai |

---

## 2. Hạn mức free-tier và cách sống trong đó

**Supabase Free (2026-08):** 500MB database · 1GB file storage · **50.000 MAU** ·
5GB egress · **2 project active** · **project tự pause sau 7 ngày không có query nào chạm DB**.

| Vấn đề | Hệ quả | Đối phó |
|---|---|---|
| **Pause sau 7 ngày** | sync chết im lặng | `keepalive()` RPC + **GitHub Actions cron mỗi ngày** gọi nó. Pause tính theo *query thật chạm DB*, không phải theo lượt mở dashboard |
| 500MB DB | hết chỗ ở ~200 user | xem §5; app **vẫn chạy local-only** khi sync lỗi, không bao giờ chặn người dùng học |
| 2 project | không có staging riêng | 1 project prod; staging dùng Supabase CLI local (docker) |
| 50k MAU | thoải mái | — |

**Nguyên tắc bắt buộc:** sync là **tính năng cộng thêm**, không phải điều kiện để dùng app.
Server chết / hết quota / pause → người dùng vẫn tra từ, vẫn ôn tập, vẫn lưu thẻ. Chỉ mất đồng bộ.

---

## 3. Tài khoản trong môi trường extension

### 3.1 Vì sao chọn Email OTP, không phải OAuth

OAuth trong MV3 phải đi qua `chrome.identity.launchWebAuthFlow` với redirect
`https://<extension-id>.chromiumapp.org/`, phải khai URL đó trong Supabase, và **extension-id đổi
khi bạn đổi cách đóng gói** → dễ vỡ. Google OAuth còn cần tạo OAuth client, verify app.

**Email OTP 6 số không có redirect nào cả:**

```
1. User nhập email        → POST /auth/v1/otp        { email, create_user: true }
2. Supabase gửi mã 6 số   → user mở hộp thư
3. User nhập mã           → POST /auth/v1/verify     { email, token, type: 'email' }
                          ← { access_token, refresh_token, expires_in, user }
4. Hết hạn                → POST /auth/v1/token?grant_type=refresh_token
```

Chỉ cần bật **Email OTP** trong Supabase Auth và **tắt** "Confirm email" cho luồng OTP.
Không domain, không OAuth app, không redirect. OAuth (Google/GitHub) để dành M3 khi đã có landing page.

### 3.2 Lưu token ở đâu

| Token | Chỗ lưu | Lý do |
|---|---|---|
| `access_token` (1 giờ) | `chrome.storage.session` | chỉ trong RAM, mất khi đóng browser |
| `refresh_token` | `chrome.storage.local` | phải sống qua các lần restart, nếu không user đăng nhập lại mỗi ngày |

Đây là **đánh đổi có ý thức**: `storage.local` đọc được bởi bất kỳ code nào chạy trong extension
(và bởi người có quyền trên máy). Không có chỗ nào tốt hơn trong MV3 — extension không có keychain.
Giảm thiệt hại: token chỉ mở được dữ liệu thẻ của chính user đó (RLS), không phải tài khoản Google.
Phải ghi rõ trong privacy policy.

### 3.3 Đăng nhập lần đầu: merge, không ghi đè

Người dùng đã học local-only vài trăm thẻ rồi mới tạo tài khoản. Luồng bắt buộc:

```
1. PULL toàn bộ dữ liệu server (thường rỗng nếu tài khoản mới)
2. Với mỗi thẻ local: khớp theo (normalized_front, lang_from, lang_to)
   - server chưa có  -> đẩy lên
   - server đã có    -> giữ thẻ server, gộp `back`/`tags`, lấy tiến độ SRS có last_review mới hơn
3. review_logs: union theo id (append-only, không bao giờ conflict)
4. Không được xoá gì ở cả hai phía trong bước merge đầu tiên
```

Có nút **"Ngắt kết nối"**: xoá session local nhưng **giữ nguyên dữ liệu local** — không được biến
việc đăng xuất thành xoá dữ liệu.

---

## 4. ~~Client gọi server thế nào~~ — ĐÃ THAY BỞI ADR-21

> Mục này viết khi client còn gọi PostgREST trực tiếp. **Không còn đúng.**
> Hợp đồng API hiện tại: [PLATFORM.md §4](PLATFORM.md).
> Phần dưới giữ lại vì hai thứ vẫn dùng được **ở phía Worker**: cursor kép `(updated_at, id)` cho
> pull phân trang, và việc gọi RPC `push_*` thay vì upsert thẳng.

### (lịch sử) Client gọi server thế nào

GoTrue và PostgREST đều là REST thuần. Extension hiện không có bundler; bundle `supabase-js`
sẽ buộc thêm Vite. Nên **tự viết ~150 dòng client bằng `fetch`**:

```
src/background/sync/
├── auth.js       # otp() · verify() · refresh() · session() · signOut()
├── remote.js     # cài đặt RemoteStore: pull() · push() · deleteAccount()
└── engine.js     # vòng PULL -> merge -> PUSH, checkpoint vào bảng jobs
```

`remote.js` là **module duy nhất** biết đến Supabase (ARCHITECTURE §2.4 — exit plan). Đổi sang D1
= viết lại đúng file này.

**Header mọi request:** `apikey: <anon key>` + `Authorization: Bearer <access_token>`.
Anon key là **public** — nó không phải secret, RLS mới là thứ bảo vệ dữ liệu. Nhưng vẫn phải khai
`https://<project>.supabase.co/*` trong `host_permissions`.

**PULL delta** — cursor kép `(updated_at, id)` để không sót hàng khi hai hàng trùng timestamp:

```
GET /rest/v1/cards
  ?or=(updated_at.gt.{since},and(updated_at.eq.{since},id.gt.{sinceId}))
  &order=updated_at.asc,id.asc&limit=500
```

**PUSH** — gọi RPC `push_cards` / `push_card_states` / `push_decks` (đã viết trong SQL) thay vì
upsert thẳng. Upsert thẳng sẽ ghi đè cả khi bản trên server mới hơn. RPC so timestamp trước khi
ghi và trả về `rejected[]` để client merge lại rồi đẩy tiếp.

**Bảng local cần thêm** (hiện chưa có, M2 phải làm cùng lúc với việc chuyển sang Dexie):

| Store | Nội dung |
|---|---|
| `outbox` | `{seq, entity, id, op, baseUpdatedAt, clientTs}` — ghi **trong cùng transaction** với thay đổi |
| `tombstones` | `{entity, id, deletedAt}` — giữ 90 ngày, chống thẻ "sống lại" |
| `sync_state` | cursor mỗi bảng, lần sync cuối, trạng thái, lỗi cuối |

---

## 5. Dung lượng: khi nào 500MB hết

| Thành phần | Cỡ/bản ghi | 1.000 thẻ | Ghi chú |
|---|---|---|---|
| `cards` | ~0,6 KB | 600 KB | context_sentence chiếm phần lớn |
| `card_states` | ~0,15 KB | 150 KB | |
| `review_logs` | ~0,08 KB | ~1,6 MB (20k log) | **đây là thứ phình nhanh nhất** |
| **Tổng / user** | | **~2,4 MB** | |

→ **500MB ≈ 200 user** dùng thật (1.000 thẻ, 2 năm ôn tập), không phải 500 như ước lượng ban đầu ở
ARCHITECTURE §2.3 — `review_logs` bị tính thiếu ở đó.

**Ngưỡng hành động:**

| Mốc | Làm gì |
|---|---|
| ~150 user | bật cảnh báo dung lượng trong Diagnostics |
| ~200 user | **chỉ sync `review_logs` dạng tổng hợp theo ngày** (đủ cho thống kê), giữ log chi tiết ở local cho FSRS optimizer. Cắt ~2/3 dung lượng |
| ~500 user | chuyển sang **Cloudflare D1** (5GB) hoặc **PocketBase** self-host trên Oracle Always Free |

Ba việc này đều chỉ đụng vào `remote.js` + schema, không đụng domain/UI.

---

## 6. Domain — trả lời thẳng

**Sync không cần domain.** Extension gọi trực tiếp `https://<project>.supabase.co`.

Domain chỉ cần cho: **privacy policy** (bắt buộc để lên store), landing page, sau này là OAuth redirect.

| Lựa chọn | Chi phí | Thực tế |
|---|---|---|
| `remember.pages.dev` (Cloudflare Pages) | **0đ** | ✅ khuyến nghị — có SSL, CDN, deploy từ GitHub, không giới hạn ngớ ngẩn |
| `<user>.github.io/remember` (GitHub Pages) | **0đ** | ✅ đủ cho privacy policy + docs |
| `remember.js.org` / `.is-a.dev` | 0đ | subdomain do người khác vận hành, xin qua pull request, **có thể bị thu hồi** — dùng cho dự án phụ, không dùng cho thứ không được mất |
| `*.eu.org` | 0đ | duyệt tay, chờ lâu, chủ yếu cho phi lợi nhuận |
| `remember.app` / `.com` riêng | ~250k–350k đ/năm | mua khi thật cần thương hiệu |

**Nói thẳng: domain riêng miễn phí không còn tồn tại.** Freenom (.tk/.ml) đã đóng luồng miễn phí
từ đầu 2024 sau vụ kiện của Meta. Mọi thứ "free domain" còn lại đều là **subdomain của người khác**,
tồn tại theo ý họ.

Khuyến nghị: dùng `*.pages.dev` cho tới khi phát hành công khai; mua domain thật khi làm thương hiệu.
Đây cũng là khoản chi thứ hai sau phí Chrome Web Store 5 USD (REQUIREMENTS §6.4).

---

## 7. Chỗ tôi đơn giản hoá so với ARCHITECTURE §6.2

ARCHITECTURE nói **per-field last-write-wins**. Các RPC trong `001_init.sql` làm
**row-level LWW** (so `updated_at` cho nội dung thẻ, `last_review` cho tiến độ SRS).

**Hệ quả thật:** hai thiết bị offline, máy A sửa `note`, máy B sửa `tags` → khi sync, thay đổi của
máy đẩy sau **ghi đè cả hàng**, mất thay đổi của máy kia.

Vì sao vẫn chấp nhận ở M2: per-field cần thêm cột `field_ts jsonb` và logic merge từng field, gấp
đôi khối lượng; còn xung đột thật sự chỉ xảy ra khi **cùng một thẻ** bị sửa ở **hai máy** trong
**cùng một khoảng offline** — rất hiếm với app một người dùng. Đường lùi đã có: RPC trả `rejected[]`
nên client biết mình bị từ chối và có thể merge lại thay vì mất im lặng.

Nâng lên per-field ở M3, và ghi vào ADR mới khi làm.

---

## 8. Khi nào cần API trung gian

Không cần cho v1 (ADR-11, ADR-12). Nhưng hai rủi ro sau **có thật**, phải chuẩn bị đường lùi từ giờ:

| Rủi ro của truy cập trực tiếp | Vì sao có thật | Chuẩn bị ngay bây giờ (rẻ) |
|---|---|---|
| Không ép user cập nhật extension được → đổi schema hoặc Supabase chết là phải ship bản mới + **chờ store review** | client cũ vẫn gọi schema cũ, không tắt được từ xa | `schema_version` trong `profiles`: client cũ hơn server → **chỉ đọc + nhắc cập nhật**, không ghi sai schema |
| `anon key` là public, ai cũng lấy được từ extension → tạo tài khoản hàng loạt, đốt quota free | không rate-limit được ở phía client | bật rate limit của Supabase Auth; theo dõi MAU; giữ `remote.js` là điểm ghép duy nhất để chèn API sau |

**Thêm API khi** (bất kỳ điều nào xảy ra): deck chia sẻ / nhiều người (P4) · cần giấu API key trả
phí · bị lạm dụng quota thật · cần đổi backend mà không ship extension.

**Đừng đưa lời gọi dịch qua API của mình** (ADR-12): hiện mỗi user gọi bằng IP của họ; proxy qua
server ⇒ một IP gọi thay cho tất cả ⇒ Google chặn IP đó là toàn bộ hệ thống mất dịch cùng lúc.

**SSO không cần API.** GoTrue đã là auth server. Cái thiếu là chỗ nhận OAuth redirect — giải bằng
**một trang tĩnh** trên `*.pages.dev` (~30 dòng HTML), không phải một API.

---

## 8b. Extension public: giấu được gì, không giấu được gì

**Không giấu được gì cả.** Extension trên store là code đọc được: tải `.crx`, giải nén, đọc
plaintext. Obfuscate vừa vô dụng vừa **bị Chrome Web Store cấm** (chính sách về code khó đọc).
Mọi thiết kế dựa trên "giấu endpoint" là tự lừa mình.

> ⚠️ **Mục này viết khi client còn giữ `anon` key.** Từ ADR-21, `anon` key là **secret của Worker**,
> không nằm trong client — nên phần lớn rủi ro dưới đây không còn. Giữ lại vì hai lý do: (1) nếu
> sau này bỏ Worker thì nó đúng trở lại; (2) phần "tuyệt đối không đưa vào client" và
> "test RLS bằng 2 tài khoản" vẫn bắt buộc.

**Anon key vốn được thiết kế để public** — JWT role `anon`, cùng bản chất với Firebase config.
Nó không phải mật khẩu. Thứ bảo vệ dữ liệu là **RLS + JWT của từng user**.

Giả định đúng để thiết kế: *kẻ tấn công có project URL + anon key và gửi request tuỳ ý.*

| Họ thử | Kết quả | Nhờ đâu |
|---|---|---|
| Đọc/sửa dữ liệu user khác | ❌ | RLS `user_id = auth.uid()` trên mọi bảng |
| Xem cấu trúc bảng qua PostgREST | ✅ được | vô hại khi RLS đúng |
| Ghi bằng role `anon` | ❌ | RLS + `revoke all ... from anon` (lớp hai) |
| Tạo tài khoản hàng loạt → đốt MAU/dung lượng | ⚠️ **thật** | Captcha (Turnstile/hCaptcha) + rate limit của Supabase Auth |
| Hammer endpoint → đốt egress, project throttle | ⚠️ **thật** | rate limit; theo dõi trong Diagnostics |

### Tuyệt đối không đưa vào extension
- **`service_role` key** — bỏ qua toàn bộ RLS. Lộ là mất sạch dữ liệu mọi user.
- **Connection string / password Postgres** — client không bao giờ nói trực tiếp với port DB.

~~Trong extension chỉ có đúng hai thứ: project URL + `anon` key.~~
**Từ ADR-21: trong extension chỉ có đúng một thứ — `API_BASE_URL`.**

### Bắt buộc làm
1. RLS bật trên **mọi** bảng, kiểm bằng query ở cuối `001_init.sql` (phải trả 0 dòng)
   và **test thật bằng 2 tài khoản** — không tin vào việc "đã viết policy".
2. `revoke all from anon` + `alter default privileges` — để bảng thêm sau này mà quên bật RLS
   thì vẫn không hở cho anon.
3. Bật **Captcha** ở Supabase Auth (miễn phí) — đây là chốt duy nhất chặn việc tạo tài khoản hàng loạt.
4. Cẩn thận với `security definer`: hàm loại này **bỏ qua RLS**. Trong schema chỉ có 2 hàm dùng nó
   (`handle_new_user`, `keepalive`) và cả hai đều không đọc dữ liệu user. Thêm hàm `security definer`
   mới thì phải review như review code bảo mật.

### Chỗ đau thật khi bị lạm dụng
Rotate anon key ⇒ **mọi session hết hiệu lực** và phải **ship extension mới + chờ store review**
(vài ngày). Tức là bạn không có nút "khoá ngay" nào. Đây chính là lý do mạnh nhất để thêm bridge API
về sau (ADR-11) — giá trị của API **không phải giữ bí mật** (URL và token của API cũng public y như
vậy), mà là **có chỗ để revoke và rate-limit phía server mà không cần ship extension**.

---

## 8c. Rate limit theo từng user

Có làm được, **bên trong Postgres** — [`infra/supabase/002_quota.sql`](infra/supabase/002_quota.sql).

### Đổi mô hình quyền ghi (điều kiện tiên quyết)

`001_init.sql` cấp `insert/update/delete` trực tiếp cho `authenticated`, nên client **ghi thẳng
qua PostgREST được** và đi vòng mọi chốt quota. `002` siết lại:

```
authenticated:  SELECT trực tiếp  (PULL, RLS lo phân quyền)
                mọi thay đổi → BẮT BUỘC qua RPC push_*
```

Một điểm nghẽn ghi duy nhất = một chỗ duy nhất đặt hạn mức.

### Hạn mức (bảng `limits`, sửa được bằng SQL, không cần deploy)

| Khoá | Mặc định | Chặn cái gì |
|---|---|---|
| `pushes_per_minute` | 30 | hammer / vòng lặp lỗi ở client |
| `rows_per_day` | 20.000 | đốt dung lượng trong một ngày |
| `max_cards` | 20.000 | phình dài hạn (khớp NFR-3) |
| `max_decks` | 500 | |

Vượt hạn mức ⇒ `raise exception` ⇒ PostgREST trả 400 kèm message tiếng Việt ⇒ client hiện lý do
trong trạng thái sync. Counter tự reset khi sang phút / sang ngày.

### Đánh đổi phải biết

| | |
|---|---|
| ✅ Bảo vệ được | dung lượng 500MB, tính toàn vẹn dữ liệu, client lỗi gây vòng lặp sync |
| ❌ Không bảo vệ được | **egress và CPU**. Request vẫn *đến* Postgres rồi mới bị từ chối — mỗi lần từ chối vẫn tốn một transaction |
| Chi phí | 1 lần `UPDATE usage_counters` cho **mỗi lần push**, không phải mỗi dòng. Push đi theo lô 200 dòng nên không đáng kể |

Muốn chặn **trước khi** chạm DB thì buộc phải có edge (bridge API / Cloudflare) — §8.

### Rủi ro mới do `002` tạo ra

`push_*` phải chuyển sang **`security definer`** (vì `authenticated` không còn quyền ghi).
**RLS không còn bảo vệ bên trong các hàm đó** — hàm phải tự kiểm sở hữu. Hai quy tắc, vi phạm là
rò dữ liệu giữa các user:

1. `user_id` **luôn** lấy từ `auth.uid()`, **không bao giờ** lấy từ payload.
2. Trước khi ghi đè hàng đã tồn tại, **phải kiểm hàng đó thuộc `auth.uid()`** — nếu không, ai cũng
   ghi đè thẻ của người khác chỉ bằng cách gửi đúng `id`.

Cả hai đã cài trong `002`; `push_card_states` còn kiểm thêm thẻ có thuộc user không, chặn việc gắn
tiến độ vào thẻ của người khác. **Mọi lần sửa các hàm này phải review như review code bảo mật**, và
test bằng 2 tài khoản: đăng nhập user A, gửi `push_cards` với `id` của thẻ user B → phải nhận
`rejected: forbidden`, và dữ liệu user B không đổi.

### Còn lại: rate limit ở tầng Auth
Signup/OTP **không** đi qua RPC nên `002` không chạm tới. Dùng rate limit sẵn có của Supabase Auth
+ **Captcha** (§8b) — đó vẫn là chốt duy nhất chặn tạo tài khoản hàng loạt.

---

## 9. ~~Việc cần làm~~ — xem [PLATFORM.md §8](PLATFORM.md)

> Checklist dưới đây viết cho kiến trúc client-gọi-DB-trực-tiếp. Lộ trình hiện tại ở PLATFORM §8.

### (lịch sử) Việc cần làm, theo thứ tự

| # | Việc | Chặn cái gì |
|---|---|---|
| 1 | Tạo project Supabase, chạy `001_init.sql` **rồi** `002_quota.sql`, **kiểm tra RLS + kiểm tra push_* bằng 2 tài khoản test** (§8c) | tất cả |
| 2 | Chuyển local store `chrome.storage.local` → **Dexie/IndexedDB** + `outbox`/`tombstones`/`sync_state` | sync không thể làm sạch trên storage.local |
| 3 | `auth.js` — OTP + refresh + lưu token đúng chỗ (§3.2) | |
| 4 | `remote.js` — pull cursor kép, push qua RPC | |
| 5 | `engine.js` — vòng sync + checkpoint, `chrome.alarms` 15 phút, debounce 5s sau mỗi thay đổi | |
| 6 | UI: trạng thái `synced / pending N / offline / error` + thời điểm sync cuối | NFR-14 |
| 7 | Merge lần đầu (§3.3) + test: 2 máy offline, xoá vs sửa, kill giữa sync, chạy lại 2 lần | mọi bất biến ARCHITECTURE §5.3 |
| 8 | GitHub Actions cron gọi `keepalive()` mỗi ngày | project bị pause |
| 9 | Privacy policy trên `*.pages.dev` + luồng xoá tài khoản (FR-E4) | lên store |

**Bước 1 và 2 nên làm trước khi viết bất kỳ dòng sync nào** — bước 2 là việc lớn hơn cả sync engine.

Sources: [Supabase free tier limits](https://costbench.com/software/database-as-service/supabase/free-plan/) ·
[Supabase pricing 2026](https://uibakery.io/blog/supabase-pricing) ·
[Free domain landscape sau Freenom](https://tld-list.com/blog/free-domains)
