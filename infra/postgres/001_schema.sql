-- Remember — schema Postgres THUẦN, không phụ thuộc nhà cung cấp nào.
--
-- Chạy được trên: Supabase, Neon, Railway, Render, Postgres tự dựng… Chỉ cần một
-- connection string. Không dùng `auth.users`, không dùng `auth.uid()`, không PostgREST.
--
-- Thay thế infra/supabase/001_init.sql (thứ đó gắn chặt với GoTrue + PostgREST).

create extension if not exists pgcrypto;   -- gen_random_uuid, digest

-- ---------------------------------------------------------------- tiện ích

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();   -- server đặt, không tin đồng hồ client
  return new;
end $$;

/**
 * Người dùng hiện tại của phiên DB.
 *
 * Thay cho auth.uid() của Supabase. Tầng repository đặt bằng
 * `select set_config('app.user_id', $1, true)` trong CÙNG transaction với query,
 * nên RLS vẫn là lưới an toàn thứ hai kể cả khi code ứng dụng quên lọc user_id.
 *
 * `true` ở tham số thứ hai của current_setting = trả NULL thay vì báo lỗi khi chưa đặt.
 */
create or replace function app_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ------------------------------------------------------------ danh tính

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  name        text,
  avatar_url  text,
  settings    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Một user có thể nối nhiều nhà cung cấp đăng nhập (google, github, email…).
create table if not exists oauth_accounts (
  provider     text not null,
  provider_uid text not null,               -- `sub` của Google: ổn định, không đổi khi user đổi email
  user_id      uuid not null references users(id) on delete cascade,
  email        text,
  created_at   timestamptz not null default now(),
  primary key (provider, provider_uid)
);
create index if not exists oauth_by_user on oauth_accounts (user_id);

/**
 * Phiên đăng nhập — token ĐỤC (opaque), không phải JWT.
 *
 * Vì sao không JWT: lợi thế của JWT là xác thực không cần chạm DB, nhưng mọi request
 * của app này đều chạm DB rồi. Đổi lại token đục cho: thu hồi tức thì, không phải
 * quản lý khoá ký, không lo thuật toán ký.
 *
 * Chỉ lưu SHA-256 của token. Lộ cả bảng cũng không mạo danh được ai.
 */
create table if not exists sessions (
  token_hash  bytea       primary key,
  user_id     uuid        not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  user_agent  text,
  kind        text        not null default 'web'   -- 'web' | 'extension'
);
create index if not exists sessions_by_user on sessions (user_id);
create index if not exists sessions_expiry on sessions (expires_at);

/** Chống CSRF cho luồng OAuth: state + code_verifier sống ngắn. */
create table if not exists oauth_states (
  state         text primary key,
  code_verifier text        not null,
  next_path     text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

-- ------------------------------------------------------------ dữ liệu học

create table if not exists decks (
  id         uuid primary key,
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  parent_id  uuid references decks(id) on delete set null,
  sort_order int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists cards (
  id               uuid primary key,
  user_id          uuid not null references users(id) on delete cascade,
  deck_id          uuid references decks(id) on delete set null,
  front            text not null,
  normalized_front text not null,
  back             jsonb not null default '[]'::jsonb,
  reading          text,
  reading_type     text check (reading_type in ('ipa', 'translit')),
  pos              text,
  lang_from        text not null default 'auto',
  lang_to          text not null default 'vi',
  context_sentence text,
  source_url       text,
  source_title     text,
  tags             text[] not null default '{}',
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- FR-B3: một từ + một cặp ngôn ngữ chỉ tồn tại một lần cho mỗi user.
-- Partial index: thẻ đã xoá không chặn việc tạo lại.
create unique index if not exists cards_dedupe
  on cards (user_id, normalized_front, lang_from, lang_to)
  where deleted_at is null;

-- Tiến độ FSRS tách khỏi nội dung thẻ (ADR-7).
create table if not exists card_states (
  card_id     uuid primary key references cards(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  state       text not null default 'new' check (state in ('new','learning','review','relearning')),
  due         timestamptz,
  stability   double precision,
  difficulty  double precision,
  reps        int  not null default 0,
  lapses      int  not null default 0,
  last_review timestamptz,
  suspended   boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- Append-only: không bao giờ update/delete.
create table if not exists review_logs (
  id             uuid primary key,
  user_id        uuid not null references users(id) on delete cascade,
  card_id        uuid not null references cards(id) on delete cascade,
  rating         smallint not null check (rating between 1 and 4),
  reviewed_at    timestamptz not null,
  elapsed_ms     int,
  scheduled_days int,
  state_before   text
);

create index if not exists decks_by_user   on decks       (user_id) where deleted_at is null;
create index if not exists cards_by_user   on cards       (user_id) where deleted_at is null;
create index if not exists cards_by_deck   on cards       (user_id, deck_id) where deleted_at is null;
create index if not exists states_due      on card_states (user_id, due);
create index if not exists logs_by_time    on review_logs (user_id, reviewed_at);
create index if not exists logs_by_card    on review_logs (card_id);

drop trigger if exists trg_users_updated on users;
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();
drop trigger if exists trg_decks_updated on decks;
create trigger trg_decks_updated before insert or update on decks
  for each row execute function set_updated_at();
drop trigger if exists trg_cards_updated on cards;
create trigger trg_cards_updated before insert or update on cards
  for each row execute function set_updated_at();
drop trigger if exists trg_states_updated on card_states;
create trigger trg_states_updated before insert or update on card_states
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------- RLS
-- Lưới an toàn thứ hai (ADR-22 giữ nguyên tinh thần, đổi cơ chế):
-- tầng repository đã lọc user_id, nhưng nếu một query quên lọc thì RLS chặn.
--
-- ⚠️ Chủ sở hữu bảng BỎ QUA RLS. Ứng dụng phải kết nối bằng role `remember_app`
-- (tạo ở cuối file), KHÔNG phải bằng role sở hữu schema.

alter table users         enable row level security;
alter table oauth_accounts enable row level security;
alter table decks         enable row level security;
alter table cards         enable row level security;
alter table card_states   enable row level security;
alter table review_logs   enable row level security;

-- BẢNG DANH TÍNH: `users` và `oauth_accounts` bị chạm TRƯỚC khi biết user là ai
-- (lúc đăng ký/đăng nhập), nên `app_user_id()` còn NULL. Nếu policy chỉ là
-- `id = app_user_id()` thì INSERT lúc đăng ký bị chặn và ĐĂNG NHẬP VỠ HOÀN TOÀN.
--
-- Cách xử lý: cho phép khi CHƯA có user context. Hệ quả thực tế:
--   - Mọi truy vấn dữ liệu học đều chạy trong transaction có set_config ⇒ vẫn bị RLS ràng buộc.
--   - Đường không-scope chỉ có tầng danh tính (8 hàm trong IdentityRepository) đi qua.
-- Đây là đánh đổi có ý thức, không phải quên bật RLS.
drop policy if exists own_user on users;
create policy own_user on users
  for all using (id = app_user_id() or app_user_id() is null)
  with check (id = app_user_id() or app_user_id() is null);

drop policy if exists own_oauth on oauth_accounts;
create policy own_oauth on oauth_accounts
  for all using (user_id = app_user_id() or app_user_id() is null)
  with check (user_id = app_user_id() or app_user_id() is null);

drop policy if exists own_decks on decks;
create policy own_decks on decks
  for all using (user_id = app_user_id()) with check (user_id = app_user_id());

drop policy if exists own_cards on cards;
create policy own_cards on cards
  for all using (user_id = app_user_id()) with check (user_id = app_user_id());

drop policy if exists own_states on card_states;
create policy own_states on card_states
  for all using (user_id = app_user_id()) with check (user_id = app_user_id());

-- review_logs: chỉ đọc và thêm — tính append-only cưỡng chế ở tầng DB.
drop policy if exists read_logs on review_logs;
create policy read_logs on review_logs for select using (user_id = app_user_id());
drop policy if exists insert_logs on review_logs;
create policy insert_logs on review_logs for insert with check (user_id = app_user_id());

-- `sessions` và `oauth_states` được truy cập TRƯỚC khi biết user là ai (lúc đăng nhập),
-- nên không đặt RLS theo app_user_id. Chúng chỉ được chạm bởi tầng auth.

-- --------------------------------------------------------- role của ứng dụng
-- Chạy phần này một lần, đổi mật khẩu trước khi chạy.
--
--   create role remember_app login password 'ĐỔI_ĐI';
--   grant usage on schema public to remember_app;
--   grant select, insert, update, delete on all tables in schema public to remember_app;
--   revoke update, delete on review_logs from remember_app;   -- append-only
--   grant execute on function app_user_id() to remember_app;
--   alter default privileges in schema public
--     grant select, insert, update, delete on tables to remember_app;
--
-- Rồi dùng role này trong DATABASE_URL. Nếu kết nối bằng role sở hữu bảng (vd `postgres`
-- của Supabase) thì RLS BỊ BỎ QUA và bạn mất lưới an toàn — vẫn chạy đúng, nhưng mất một lớp.

-- Kiểm tra trước khi deploy: mọi bảng dữ liệu phải có RLS. Query này phải trả 0 dòng.
--   select tablename from pg_tables t
--    where schemaname = 'public'
--      and tablename not in ('sessions','oauth_states')
--      and not exists (select 1 from pg_class c
--                       where c.relname = t.tablename and c.relrowsecurity);
