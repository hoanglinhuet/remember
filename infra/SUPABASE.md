# Cấu hình Supabase làm database

Supabase ở đây **chỉ là một Postgres được host**. Không dùng Supabase Auth, không dùng
PostgREST, không cài `@supabase/supabase-js`. Toàn bộ truy cập đi qua `DATABASE_URL`
theo đúng port `Database` (ADR-22), nên đổi sang Neon/Railway/máy chủ riêng sau này chỉ
là đổi một biến môi trường.

Nghĩa là **không cần** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Nếu bạn thấy mình đang copy mấy khoá đó thì đã đi sai đường.

---

## 1. Chạy migration

Dán vào **SQL Editor** của Supabase, **đúng thứ tự này**, mỗi file một lần:

| Thứ tự | File | Làm gì |
|---|---|---|
| 1 | [`postgres/001_schema.sql`](postgres/001_schema.sql) | bảng, `app_user_id()`, RLS |
| 2 | [`postgres/002_app_role.sql`](postgres/002_app_role.sql) | role `remember_app` + grant |
| 3 | [`postgres/003_pairing.sql`](postgres/003_pairing.sql) | mã ghép nối extension |
| 4 | [`postgres/004_dedupe_sense.sql`](postgres/004_dedupe_sense.sql) | khoá dedupe theo nghĩa |
| 5 | [`postgres/005_supabase_lockdown.sql`](postgres/005_supabase_lockdown.sql) | **chặn PostgREST** — xem §2 |

`002` và `005` chạy lại được nhiều lần. `002` phải đứng trước `003` vì `003` cấp quyền
cho role do `002` tạo.

## 2. Đổi mật khẩu role, và vì sao `005` là bắt buộc

`002` tạo role với mật khẩu `remember_dev` — mật khẩu đó **chỉ dành cho Docker local**.
Trên Supabase, database mở ra internet, nên đổi ngay:

```sql
alter role remember_app password '<mật khẩu dài, ngẫu nhiên>';
```

**`005` không phải tuỳ chọn.** Supabase phơi schema `public` qua PostgREST bằng `anon`
key — khoá công khai — và cấp sẵn quyền cho role `anon`/`authenticated` trên mọi bảng
kể cả bảng tạo sau. Tầng danh tính của ta cố tình **không có RLS**
(`sessions`, `oauth_states`, `pairing_codes`: bị chạm khi còn chưa biết user là ai), và
policy của `users` có nhánh `or app_user_id() is null` mà với `anon` thì nhánh đó là TRUE.

Đã đo trên bản local dựng lại đúng cấu hình Supabase: `anon` đọc được **17 dòng
`sessions` và 2 dòng `users`** — đủ để chiếm tài khoản. Sau `005`:
`permission denied for table sessions`, và bảng tạo sau cũng không bị cấp lại.

Kiểm tra lại bất cứ lúc nào — phải trả **0 dòng**:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

## 3. Chọn connection string

Supabase cho nhiều chuỗi kết nối và chọn sai thì lỗi rất khó đoán. Lấy ở
**Project Settings → Database → Connection string**:

| Kiểu | Cổng | Dùng khi nào |
|---|---|---|
| **Transaction pooler** (Supavisor) | `6543` | ✅ **Chọn cái này** — Vercel là serverless, mỗi request một instance |
| Session pooler | `5432` | chạy máy chủ thường trú, cần prepared statement |
| Direct connection (`db.<ref>.supabase.co`) | `5432` | ❌ **IPv6-only** ở project mới — Vercel function nhiều khả năng không kết nối được |

`prepare: false` đã đặt sẵn trong `lib/adapters/postgres/index.ts:36` — pooler chế độ
transaction không hỗ trợ prepared statement, thiếu dòng đó là lỗi ngay query đầu tiên.

Thay `postgres` bằng `remember_app` trong tên user để **RLS thực sự có tác dụng**:
chủ sở hữu bảng **bỏ qua RLS**, nên kết nối bằng `postgres` là mất lưới an toàn thứ hai
một cách im lặng.

```
DATABASE_URL=postgres://remember_app.<project-ref>:<mật khẩu>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

> ✅ **Đã kiểm chứng (2026-09-03):** Supavisor **nhận role tự tạo** — kết nối bằng
> `remember_app.<ref>` chạy được ở cả cổng 6543 và 5432, `select current_user` trả
> `remember_app`. Lưu ý: ngay sau `alter role ... password`, pooler còn **cache credential
> cũ** vài giây nên lần thử đầu có thể báo `password authentication failed` — thử lại.
>
> RLS cũng đã kiểm dứt điểm trên Supabase (chèn 2 user trong một transaction rồi rollback):
> mỗi user chỉ thấy thẻ của mình, user lạ thấy 0 thẻ, và chèn thẻ cho `user_id` của người
> khác bị chặn bằng `new row violates row-level security policy`.

## 4. Đặt biến môi trường

**Local** — `apps/web/.env.local` (đã gitignore, đừng commit):

```
DATABASE_URL=postgres://...        # chuỗi ở §3
GOOGLE_CLIENT_ID=...               # giữ nguyên
GOOGLE_CLIENT_SECRET=...
```

Đổi `DATABASE_URL` là app tự dùng adapter Postgres — `usingMemoryDb` chỉ bật khi
**không có** `DATABASE_URL` và không ở production (`lib/server/env.ts`).

**Vercel** — Project Settings → Environment Variables:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | chuỗi ở §3 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | như local |
| `APP_ORIGIN` | `https://<domain>.vercel.app` — cần cho redirect OAuth |
| `ALLOWED_EXTENSION_IDS` | ID extension, phân cách bằng dấu phẩy. **Để trống là mọi extension gọi được API** (ADR-30) |

Rồi thêm redirect URI vào Google Cloud Console → OAuth client:
`https://<domain>.vercel.app/api/v1/auth/callback`

Region Vercel phải khớp region Supabase. Project production ở **`ap-southeast-1` (Singapore)**
nên `apps/web/vercel.json` đặt **`sin1`**. Lệch region là mỗi round trip cộng thêm vài chục ms,
nhân với 6 round trip mỗi request.

## 5. Kiểm tra

```bash
cd apps/web && npm run db:check          # kiểm tra một chuỗi đã có
cd apps/web && node scripts/db-find-pooler.mjs [--write]   # dò host pooler đúng
```

`db-find-pooler.mjs` sinh ra để giải quyết đúng tình huống đã gặp: chuỗi direct connection
không chứa mã region, mà region thì không đoán được (project này ở Seoul dù dải IPv6 trông
như APAC/Singapore). Script thử lần lượt các region, chỉ in host/port/user, **không in mật khẩu**.

Script này báo: kết nối được không · đang là role nào · **RLS có hiệu lực hay bị bỏ qua** ·
`anon` còn đọc được bảng nào · đủ 5 migration chưa.

## 6. Độ trễ — vì sao dev phải dùng Docker

Đã đo bằng `node scripts/db-latency.mjs`:

| | Docker local | Singapore (`ap-southeast-1`) | Seoul (`ap-northeast-2`) |
|---|---|---|---|
| 1 round trip | **0–1ms** | 46ms | 88ms |
| kết nối lạnh | 37ms | 534ms | 928ms |
| `/api/v1/study/queue` | **20ms** | ~280ms | ~1010ms |

Một transaction là `BEGIN` + `set_config` + query + `COMMIT` = **4 round trip**, nên với DB
ở xa thì thứ quyết định là **số lần khứ hồi**, không phải query nào chậm. Xem ADR-37 cho
những chỗ đã gộp.

Vì vậy `.env.local` trỏ vào **Docker local**, còn chuỗi production đặt ở Environment
Variables của **Vercel** — nơi region cùng chỗ với DB nên round trip ~1ms.

Nhưng lý do quan trọng hơn tốc độ: **`.env.local` không được trỏ vào production.** Một lần
`npm run dev` rồi bấm thử là ghi thẳng vào dữ liệu thật. Chuỗi production nằm trong
`.env.local` ở dạng comment `# PROD_DATABASE_URL=` — để không mất, và để không chạy nhầm.

Đếm số câu lệnh thật của một request:

```bash
DB_DEBUG=1 npm run dev      # in từng câu lệnh gửi tới DB
```

Lưu ý khi đọc log: `Promise.all` trên cùng một transaction được postgres.js **pipeline**
thành một lượt gửi (đã đo: 348ms → 261ms cho 2 query), nhưng log vẫn in hai dòng — số dòng
log **nhiều hơn** số round trip thật.

## Những chỗ dễ vướng

| Hiện tượng | Nguyên nhân |
|---|---|
| `getaddrinfo ENOENT db.<ref>.supabase.co` | **đã gặp:** host này chỉ có bản ghi AAAA (IPv6), máy không phân giải được → dùng pooler |
| `password authentication failed` ngay sau khi đổi mật khẩu role | pooler còn cache credential cũ vài giây → thử lại |
| `ENETUNREACH` / timeout trên Vercel | dùng direct connection (IPv6-only) — đổi sang pooler `6543` |
| lỗi ngay query đầu, nói về prepared statement | thiếu `prepare: false` (đã có sẵn, chỉ lỗi nếu ai xoá) |
| `permission denied for table ...` | role `remember_app` chưa được grant → chạy lại `002` |
| Query trả 0 dòng dù DB có dữ liệu | RLS đang chặn: `set_config('app.user_id', ...)` chỉ có hiệu lực **trong transaction** — mọi đường đọc/ghi phải qua `uow.transaction()` hoặc `read()` |
| Request đầu sau vài ngày im lặng bị lỗi | free tier **tạm dừng project sau 7 ngày không dùng** — vào dashboard bật lại |
| `002` báo `Bảng thiếu RLS: pairing_codes` | bản `002` cũ; bản hiện tại đã liệt kê đủ 3 bảng danh tính |
