# ⛔ SQL trong thư mục này đã bị thay — đừng chạy

Hai file ở đây (`001_init.sql`, `002_quota.sql`) viết cho kiến trúc **cũ**: client gọi
PostgREST trực tiếp, xác thực bằng Supabase Auth (`auth.uid()`).

Kiến trúc hiện tại (ADR-21/22) ngược lại: mọi truy cập đi qua API của app, database nằm
sau interface và **không phụ thuộc Supabase**. RLS dùng `current_setting('app.user_id')`
chứ không phải `auth.uid()`.

**Migration đúng nằm ở [`../postgres/`](../postgres/)**, chạy theo thứ tự 001 → 005.
Hướng dẫn cấu hình Supabase: [`../SUPABASE.md`](../SUPABASE.md).

Giữ lại hai file này để đối chiếu lịch sử quyết định, không phải để chạy.
