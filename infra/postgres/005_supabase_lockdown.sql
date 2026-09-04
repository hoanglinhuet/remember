-- Chặn PostgREST của Supabase chạm vào schema public. Chạy SAU 001–004.
--
-- VÌ SAO BẮT BUỘC (chỉ trên Supabase; ở local file này không làm gì):
--
-- Supabase phơi schema `public` ra internet qua PostgREST, xác thực bằng `anon` key —
-- khoá này CÔNG KHAI, nằm trong mọi trang web dùng Supabase. Và Supabase đặt sẵn:
--     grant usage on schema public to anon, authenticated;
--     alter default privileges in schema public grant all on tables to anon, authenticated;
-- nên MỌI bảng ta tạo tự động lộ ra qua HTTP.
--
-- RLS không cứu được hết, vì tầng danh tính của ta cố tình không có RLS:
--   * `sessions`, `oauth_states`, `pairing_codes` — không RLS (bị chạm khi CHƯA biết
--     user là ai: lúc đăng nhập, lúc extension đổi mã). ⇒ anon đọc được token hash
--     và mã ghép nối ⇒ chiếm được tài khoản.
--   * `users` — policy `using (id = app_user_id() or app_user_id() is null)`. Với anon
--     thì `app_user_id()` là NULL nên nhánh sau thành TRUE ⇒ anon đọc được mọi user.
--     (Nhánh `is null` đó tồn tại vì lúc tạo user còn chưa có ngữ cảnh user — ADR-24.)
--
-- Ta KHÔNG dùng PostgREST: mọi thứ đi qua API của app bằng DATABASE_URL (ADR-21/22).
-- Nên thu hồi sạch là đúng và không mất gì.
--
-- `service_role` được giữ nguyên: Supabase dashboard (table editor, SQL editor) dùng nó.
-- Khoá service_role là khoá BÍ MẬT và không được đặt vào bất cứ đâu trong project này.

do $$
declare
  r text;
  touched int := 0;
begin
  foreach r in array array['anon', 'authenticated']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      -- Local Docker không có role này. Không phải lỗi.
      raise notice 'role % không tồn tại — bỏ qua (đây là DB không phải Supabase)', r;
      continue;
    end if;

    execute format('revoke all on all tables in schema public from %I', r);
    execute format('revoke all on all sequences in schema public from %I', r);
    execute format('revoke all on all functions in schema public from %I', r);
    execute format('revoke usage on schema public from %I', r);
    -- Bảng thêm sau này cũng không được cấp lại.
    execute format('alter default privileges in schema public revoke all on tables from %I', r);
    execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    touched := touched + 1;
  end loop;

  if touched > 0 then
    raise notice 'Đã thu hồi quyền của % role PostgREST trên schema public', touched;
  end if;
end $$;

-- KIỂM TRA: phải trả 0 dòng. Còn dòng nào là còn lộ bảng đó ra internet.
select grantee, table_name, string_agg(privilege_type, ',') as quyen
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;
