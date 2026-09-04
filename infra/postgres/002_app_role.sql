-- Role của ứng dụng — chạy SAU 001_schema.sql.
--
-- Vì sao bắt buộc: **chủ sở hữu bảng BỎ QUA RLS**. Nếu app kết nối bằng role chủ
-- (`postgres`), mọi policy trong 001 thành vô hiệu — code vẫn chạy đúng nhưng bạn
-- mất lưới an toàn thứ hai, và mất nó một cách IM LẶNG.
--
-- Dựng role này ở local để môi trường dev hành xử giống production: một query quên
-- lọc `user_id` sẽ lộ ra ngay khi phát triển, không phải đợi tới lúc deploy.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'remember_app') then
    -- Mật khẩu này CHỈ dùng cho database local trong Docker.
    create role remember_app login password 'remember_dev';
  end if;
end $$;

grant usage on schema public to remember_app;
grant select, insert, update, delete on all tables in schema public to remember_app;
grant execute on function app_user_id() to remember_app;

-- review_logs là append-only: cưỡng chế ở tầng quyền, không chỉ ở tầng code.
revoke update, delete on review_logs from remember_app;

-- Bảng thêm sau này cũng tự có quyền, khỏi phải nhớ grant lại.
alter default privileges in schema public
  grant select, insert, update, delete on tables to remember_app;

-- Kiểm tra: phải trả 0 dòng (mọi bảng dữ liệu đều có RLS).
do $$
declare missing text;
begin
  select string_agg(tablename, ', ') into missing
  from pg_tables t
  where schemaname = 'public'
    -- Ba bảng của tầng danh tính KHÔNG có RLS một cách có chủ ý: chúng bị chạm khi
    -- còn CHƯA biết user là ai (lúc đăng nhập, lúc extension đổi mã ghép nối).
    -- Phải liệt kê đủ cả ba, nếu không file này chỉ chạy được khi đứng trước
    -- 003_pairing.sql — đã đo: chạy lại sau 003 thì báo "thiếu RLS: pairing_codes".
    and tablename not in ('sessions', 'oauth_states', 'pairing_codes')
    and not exists (
      select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity
    );
  if missing is not null then
    raise exception 'Bảng thiếu RLS: %', missing;
  end if;
  raise notice 'RLS: tất cả bảng dữ liệu đã bật';
end $$;
