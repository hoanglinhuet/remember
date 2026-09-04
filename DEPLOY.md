# Triển khai lên Vercel

Điều kiện đã có: DB production trên Supabase (`chpfaaxpioztsbybubgj`, `ap-southeast-1`)
đã chạy xong migration 001–005 — xem [`infra/SUPABASE.md`](infra/SUPABASE.md).

Kiến trúc chỉ có **một** thứ để deploy: `apps/web` chứa cả frontend và backend API
(Next.js App Router). Extension không deploy, chỉ trỏ vào URL sau khi có.

---

## 1. Đưa repo lên GitHub

Repo này **công khai**, nên việc đầu tiên là chắc chắn bí mật không đi theo.

Đã kiểm bằng cách quét đúng giá trị thật của `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`
và mật khẩu DB production trong toàn bộ những file sắp commit:

| | Nằm ở đâu | Có bị commit? |
|---|---|---|
| Mật khẩu DB production | `apps/web/.env.local` | không (đã gitignore) |
| Google client secret | `apps/web/.env.local` **và** `.next/cache/turbopack/*.sst` | không (cả hai đã gitignore) |
| Google client id | `apps/web/.env.local` | không |

Chỗ dễ sót là **`.next/cache/turbopack/*.sst`**: Turbopack cache lại giá trị biến môi
trường lúc build, nên client secret nằm trong cache build chứ không chỉ trong file `.env`.
`.gitignore` ở root chặn cả hai.

```bash
cd ~/Desktop/remember
git status --short                 # xem trước những gì sẽ commit
git commit -m "Remember: extension + web app + infra"
gh repo create remember --public --source=. --push
```

Kiểm lại sau khi push — phải **không ra dòng nào**:

```bash
git ls-files | grep -E "\.env|\.next/"
```

Ảnh chụp màn hình `e56d1b20-….png` ở root đã bị bỏ khỏi staging: tên UUID, 452×944,
trông như ảnh chụp điện thoại. Muốn giữ thì `git add` lại, nhưng xem kỹ nội dung trước.

## 2. Import vào Vercel

**New Project → Import Git Repository**, rồi:

| Cấu hình | Giá trị | Vì sao |
|---|---|---|
| **Root Directory** | **`apps/web`** | Không có `package.json` ở root; `apps/web` là project độc lập |
| Framework Preset | Next.js | tự nhận |
| Build Command | *(để trống)* | mặc định `next build` là đúng |
| Node.js Version | mặc định (22.x) | **đừng** khai `engines: node 26` dù máy bạn là v26 — Vercel không có |

Region đã ghim `sin1` trong [`apps/web/vercel.json`](apps/web/vercel.json) cho khớp
`ap-southeast-1` của DB. Lệch region là cộng thêm vài chục ms cho **mỗi** trong 6 round
trip của một request (ADR-37/38).

## 3. Biến môi trường

Settings → Environment Variables. Tên lấy đúng từ [`lib/server/env.ts`](apps/web/lib/server/env.ts):

| Biến | Giá trị | Bắt buộc |
|---|---|---|
| `DATABASE_URL` | dòng `# PROD_DATABASE_URL=` trong `.env.local` (bỏ tiền tố `# PROD_`) | ✅ |
| `GOOGLE_CLIENT_ID` | như `.env.local` | ✅ |
| `GOOGLE_CLIENT_SECRET` | như `.env.local` | ✅ |
| `APP_ORIGIN` | `https://<domain>.vercel.app` | ✅ — xem §5 |
| `ALLOWED_EXTENSION_IDS` | id extension, phân cách bằng dấu phẩy | ⚠️ xem §6 |

`DATABASE_URL` phải là **transaction pooler cổng 6543** với user `remember_app.<ref>`:

- direct connection `db.<ref>.supabase.co` là **IPv6-only** → Vercel function `ENETUNREACH`
- user `postgres` là **chủ sở hữu bảng, bỏ qua RLS** → mất lớp phòng thủ thứ hai

Không cần `SUPABASE_URL` hay `SUPABASE_ANON_KEY` — app không dùng SDK nào của Supabase
(ADR-22).

## 4. Redirect URI của Google

Google Cloud Console → OAuth 2.0 Client → **Authorized redirect URIs**, thêm:

```
https://<domain>.vercel.app/api/v1/auth/callback
```

Giữ luôn dòng `http://localhost:3000/api/v1/auth/callback` để dev vẫn đăng nhập được.

Đường dẫn này do code dựng ra: `${originOf(req)}/api/v1/auth/callback`
([`auth/login/route.ts:23`](apps/web/app/api/v1/auth/login/route.ts)), và Google đòi
**khớp tuyệt đối** — sai một dấu `/` là `redirect_uri_mismatch`.

## 5. Vì sao `APP_ORIGIN` là bắt buộc

`originOf()` không có `APP_ORIGIN` thì suy origin từ header `x-forwarded-host`. Trên
production thì đúng, nhưng **mỗi preview deployment có hostname khác nhau**
(`remember-git-abc123-….vercel.app`) — không hostname nào được đăng ký ở Google, nên đăng
nhập trên preview sẽ `redirect_uri_mismatch`.

Đặt `APP_ORIGIN` = domain production thì preview vẫn đăng nhập được, nhưng **quay về
domain production** sau khi xong. Đó là hành vi đúng cho dự án cá nhân: chỉ có một chỗ
đăng nhập thật.

## 6. Nối extension

Sau khi deploy:

1. Mở popup extension → **Địa chỉ server** → nhập `https://<domain>.vercel.app` → Lưu.
   Đổi địa chỉ sẽ **xoá token cũ**, nên phải ghép nối lại.
2. Vào `https://<domain>.vercel.app/connect` → tạo mã → dán vào popup.

Lấy extension id ở `chrome://extensions` (bật Developer mode). Rồi đặt
`ALLOWED_EXTENSION_IDS` — **để trống nghĩa là mọi extension gọi được API của bạn**:

```ts
// lib/server/api.ts:28
if (!env.allowedExtensionIds.length) return origin;   // cho phép tất cả
```

Extension gọi API dựa vào CORS, không xin host permission (ADR-30). Nên `ALLOWED_EXTENSION_IDS`
là thứ **duy nhất** giới hạn ai gọi được — token vẫn cần, nhưng đừng để cửa mở sẵn.

## 7. Kiểm tra sau khi deploy — build xanh KHÔNG có nghĩa là đã đúng

Đã đo: ẩn `.env.local` đi rồi `next build` vẫn **thành công**, vì mọi route đều là `ƒ`
(server-rendered on demand) nên không có gì chạm database lúc build.

Hệ quả: **thiếu hay sai biến môi trường vẫn deploy xanh**, chỉ vỡ lúc chạy — API trả
`503 not_configured`. Nên bước dưới đây là bắt buộc, không phải tuỳ chọn.

Ngược lại, **lỗi type thì chặn deploy thật**. Đã thử chèn một lỗi có ý:

```
app/api/v1/health/route.ts(29,7): error TS2322: Type 'string' is not assignable to type 'number'.
Failed to type check.
```

`next.config.ts` đặt `typescript: { ignoreBuildErrors: false }` nên build đứt ở đó.

### Chạy hai lệnh này

```bash
curl -s https://<domain>.vercel.app/api/v1/health
```

Phải thấy `"storage":"postgres"` và `"databaseReachable":true`. Nếu `databaseReachable`
là `false` thì gần như chắc chắn `DATABASE_URL` còn là direct connection (IPv6-only).

Đăng nhập Google một lần, lưu một thẻ, rồi soi lại chính DB production:

```bash
cd apps/web
DATABASE_URL="<chuỗi production>" node scripts/db-check.mjs
```

Trước khi có dữ liệu, script chỉ nói *"chưa có dữ liệu để kết luận RLS"* — nó **không**
suy RLS từ tên role mà đếm thật dưới hai ngữ cảnh user khác nhau, nên phải có thẻ mới
kết luận được.

## Những chỗ dễ vướng

| Hiện tượng | Nguyên nhân |
|---|---|
| Function timeout / `ENETUNREACH` | `DATABASE_URL` là direct connection IPv6-only → dùng pooler `6543` |
| `redirect_uri_mismatch` | chưa thêm redirect URI, hoặc thiếu `APP_ORIGIN` nên đang chạy trên preview |
| Extension báo lỗi CORS | `ALLOWED_EXTENSION_IDS` có giá trị nhưng không chứa id thật của extension |
| Extension không gọi được API dù CORS đúng | **Deployment Protection** của Vercel chặn (mặc định bật cho preview) — tắt cho production, hoặc extension sẽ nhận trang đăng nhập của Vercel thay vì JSON |
| Request đầu chậm ~500ms | kết nối lạnh tới Supabase (đã đo: 534ms tới Singapore). Function nguội lại thì lặp lại |
| Sau vài ngày không dùng, request đầu lỗi | Supabase free tier **tạm dừng project sau 7 ngày** — vào dashboard bật lại |
| `db:check` báo *RLS BỊ BỎ QUA* | `DATABASE_URL` đang dùng user `postgres` → đổi sang `remember_app.<ref>` |

## Chưa làm

- Chưa có CI. Lỗi **type** thì Vercel bắt được lúc build (đã kiểm chứng ở §7), nhưng lỗi
  **cấu hình** thì không — deploy vẫn xanh rồi API trả 503. Không có gì tự động gọi
  `/api/v1/health` sau deploy để phát hiện.
- Chưa có migration tự động: thêm cột mới thì phải tự chạy SQL trên Supabase trước khi
  deploy code dùng cột đó.
- Project Supabase cũ ở Seoul (`bqdvlbuoeblerkhsgzhn`) vẫn còn và đã có schema — nên xoá
  để không nhầm, và vì free tier chỉ cho 2 project.
