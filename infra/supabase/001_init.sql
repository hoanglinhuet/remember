-- Remember - schema đồng bộ (M2)
-- Chạy: Supabase Dashboard > SQL Editor, hoặc `supabase db push`.
-- Nguyên tắc: client nói TRỰC TIẾP với Postgres qua PostgREST, không có API server riêng.
-- Toàn bộ phân quyền nằm ở RLS -> mọi request từ client coi như không tin cậy (ADR-3).

-- ---------------------------------------------------------------- tiện ích

-- updated_at do SERVER đặt, không tin đồng hồ client (máy user hay lệch giờ).
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- bảng

create table if not exists profiles (
  id             uuid primary key references auth.users on delete cascade,
  settings       jsonb       not null default '{}'::jsonb,
  schema_version int         not null default 1,
  updated_at     timestamptz not null default now()
);

create table if not exists decks (
  id         uuid primary key,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  parent_id  uuid references decks(id) on delete set null,
  sort_order int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists cards (
  id               uuid primary key,
  user_id          uuid not null references auth.users on delete cascade,
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
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- FR-B3: một từ + một cặp ngôn ngữ chỉ tồn tại một lần cho mỗi user.
-- Partial index: thẻ đã xoá (tombstone) không chặn việc tạo lại.
create unique index if not exists cards_dedupe
  on cards (user_id, normalized_front, lang_from, lang_to)
  where deleted_at is null;

-- Tiến độ FSRS tách khỏi nội dung thẻ: tần suất ghi và quy tắc merge khác nhau (ADR-7).
create table if not exists card_states (
  card_id     uuid primary key references cards(id) on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  state       text not null default 'new',
  due         timestamptz,
  stability   double precision,
  difficulty  double precision,
  reps        int not null default 0,
  lapses      int not null default 0,
  last_review timestamptz,
  updated_at  timestamptz not null default now()
);

-- Append-only: không bao giờ update/delete -> không thể conflict.
create table if not exists review_logs (
  id              uuid primary key,
  user_id         uuid not null references auth.users on delete cascade,
  card_id         uuid not null references cards(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 4),
  reviewed_at     timestamptz not null,
  elapsed_ms      int,
  scheduled_days  int
);

-- Pull delta = một range scan trên (user_id, updated_at).
create index if not exists decks_sync       on decks       (user_id, updated_at);
create index if not exists cards_sync       on cards       (user_id, updated_at);
create index if not exists card_states_sync on card_states (user_id, updated_at);
create index if not exists review_logs_sync on review_logs (user_id, reviewed_at);
create index if not exists cards_deck       on cards       (user_id, deck_id) where deleted_at is null;

drop trigger if exists trg_decks_updated on decks;
create trigger trg_decks_updated before insert or update on decks
  for each row execute function set_updated_at();
drop trigger if exists trg_cards_updated on cards;
create trigger trg_cards_updated before insert or update on cards
  for each row execute function set_updated_at();
drop trigger if exists trg_states_updated on card_states;
create trigger trg_states_updated before insert or update on card_states
  for each row execute function set_updated_at();
drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before insert or update on profiles
  for each row execute function set_updated_at();

-- Tự tạo profile khi có user mới.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------------- RLS
-- Đây là TOÀN BỘ tầng phân quyền. Thiếu một policy = rò dữ liệu giữa các user.

alter table profiles    enable row level security;
alter table decks       enable row level security;
alter table cards       enable row level security;
alter table card_states enable row level security;
alter table review_logs enable row level security;

drop policy if exists own_profile on profiles;
create policy own_profile on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists own_decks on decks;
create policy own_decks on decks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_cards on cards;
create policy own_cards on cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_states on card_states;
create policy own_states on card_states
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- review_logs: chỉ đọc và thêm. Không update/delete -> giữ tính append-only ở tầng DB.
drop policy if exists read_logs on review_logs;
create policy read_logs on review_logs
  for select using (user_id = auth.uid());
drop policy if exists insert_logs on review_logs;
create policy insert_logs on review_logs
  for insert with check (user_id = auth.uid());

-- ------------------------------------------------------- PUSH (last-write-wins)
-- Không dùng upsert thẳng: nó sẽ ghi đè cả khi bản trên server MỚI HƠN.
-- Các hàm dưới đây so timestamp trước khi ghi và trả về danh sách bị từ chối
-- để client merge lại (ARCHITECTURE §6.2).

create or replace function push_cards(rows jsonb)
returns jsonb language plpgsql security invoker as $$
declare
  r          jsonb;
  rejected   jsonb := '[]'::jsonb;
  server_ts  timestamptz;
begin
  for r in select * from jsonb_array_elements(rows) loop
    select updated_at into server_ts from cards where id = (r->>'id')::uuid;

    -- Bản trên server mới hơn base mà client dựa vào -> từ chối, client tự merge.
    if server_ts is not null
       and server_ts > coalesce((r->>'base_updated_at')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'server_updated_at', server_ts);
      continue;
    end if;

    insert into cards (
      id, user_id, deck_id, front, normalized_front, back, reading, reading_type, pos,
      lang_from, lang_to, context_sentence, source_url, source_title, tags, note, deleted_at
    ) values (
      (r->>'id')::uuid, auth.uid(), nullif(r->>'deck_id','')::uuid,
      r->>'front', r->>'normalized_front', coalesce(r->'back', '[]'::jsonb),
      r->>'reading', nullif(r->>'reading_type',''), r->>'pos',
      coalesce(r->>'lang_from','auto'), coalesce(r->>'lang_to','vi'),
      r->>'context_sentence', r->>'source_url', r->>'source_title',
      coalesce((select array_agg(value::text) from jsonb_array_elements_text(r->'tags')), '{}'),
      r->>'note', nullif(r->>'deleted_at','')::timestamptz
    )
    on conflict (id) do update set
      deck_id = excluded.deck_id, front = excluded.front,
      normalized_front = excluded.normalized_front, back = excluded.back,
      reading = excluded.reading, reading_type = excluded.reading_type, pos = excluded.pos,
      lang_from = excluded.lang_from, lang_to = excluded.lang_to,
      context_sentence = excluded.context_sentence, source_url = excluded.source_url,
      source_title = excluded.source_title, tags = excluded.tags, note = excluded.note,
      deleted_at = excluded.deleted_at;
  end loop;

  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

create or replace function push_card_states(rows jsonb)
returns jsonb language plpgsql security invoker as $$
declare
  r         jsonb;
  rejected  jsonb := '[]'::jsonb;
  srv_last  timestamptz;
begin
  for r in select * from jsonb_array_elements(rows) loop
    select last_review into srv_last from card_states where card_id = (r->>'card_id')::uuid;

    -- Tiến độ SRS so bằng last_review, KHÔNG bằng updated_at:
    -- máy nào ôn sau thì tiến độ máy đó đúng hơn (ARCHITECTURE §6.2).
    if srv_last is not null
       and srv_last > coalesce((r->>'last_review')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('card_id', r->>'card_id', 'server_last_review', srv_last);
      continue;
    end if;

    insert into card_states (
      card_id, user_id, state, due, stability, difficulty, reps, lapses, last_review
    ) values (
      (r->>'card_id')::uuid, auth.uid(), coalesce(r->>'state','new'),
      nullif(r->>'due','')::timestamptz,
      nullif(r->>'stability','')::double precision,
      nullif(r->>'difficulty','')::double precision,
      coalesce((r->>'reps')::int, 0), coalesce((r->>'lapses')::int, 0),
      nullif(r->>'last_review','')::timestamptz
    )
    on conflict (card_id) do update set
      state = excluded.state, due = excluded.due,
      stability = excluded.stability, difficulty = excluded.difficulty,
      reps = excluded.reps, lapses = excluded.lapses, last_review = excluded.last_review;
  end loop;

  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

create or replace function push_decks(rows jsonb)
returns jsonb language plpgsql security invoker as $$
declare
  r         jsonb;
  rejected  jsonb := '[]'::jsonb;
  server_ts timestamptz;
begin
  for r in select * from jsonb_array_elements(rows) loop
    select updated_at into server_ts from decks where id = (r->>'id')::uuid;
    if server_ts is not null
       and server_ts > coalesce((r->>'base_updated_at')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'server_updated_at', server_ts);
      continue;
    end if;

    insert into decks (id, user_id, name, parent_id, sort_order, deleted_at)
    values ((r->>'id')::uuid, auth.uid(), r->>'name',
            nullif(r->>'parent_id','')::uuid, coalesce((r->>'sort_order')::int, 0),
            nullif(r->>'deleted_at','')::timestamptz)
    on conflict (id) do update set
      name = excluded.name, parent_id = excluded.parent_id,
      sort_order = excluded.sort_order, deleted_at = excluded.deleted_at;
  end loop;

  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

-- Giữ project free khỏi bị pause: cron gọi hàm này mỗi ngày (một query thật
-- chạm vào DB, không phải chỉ mở dashboard). Không cần đăng nhập.
create or replace function keepalive()
returns timestamptz language sql security definer set search_path = public as $$
  select now();
$$;
grant execute on function keepalive() to anon;

-- ------------------------------------------------- siết quyền theo role
-- Extension là PUBLIC: anon key nằm trong code, ai cũng đọc được. Coi như kẻ tấn công
-- luôn có nó và gửi được request tuỳ ý -> role `anon` phải KHÔNG chạm được vào dữ liệu.
-- RLS đã chặn (auth.uid() là null với anon), nhưng đây là lớp thứ hai: nếu sau này ai đó
-- thêm bảng mới mà QUÊN bật RLS, mặc định của Supabase sẽ cấp quyền cho anon.

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Bảng mới tạo về sau cũng không tự cấp quyền cho anon.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;

grant select, update            on profiles    to authenticated;
grant select, insert, update, delete on decks       to authenticated;
grant select, insert, update, delete on cards       to authenticated;
grant select, insert, update, delete on card_states to authenticated;
-- review_logs là append-only: không grant update/delete, kể cả cho chính chủ.
grant select, insert            on review_logs to authenticated;

-- RPC push_*: security invoker -> vẫn chạy dưới RLS của người gọi. Chỉ user đã đăng nhập.
grant execute on function push_cards(jsonb)       to authenticated;
grant execute on function push_card_states(jsonb) to authenticated;
grant execute on function push_decks(jsonb)       to authenticated;

-- keepalive() là endpoint công khai duy nhất. Chỉ trả now(), không chạm dữ liệu.
grant execute on function keepalive() to anon;

-- Kiểm tra bắt buộc trước khi deploy: mọi bảng phải có RLS.
-- Query này phải trả về 0 dòng.
--   select tablename from pg_tables t
--   where schemaname = 'public'
--     and not exists (
--       select 1 from pg_class c
--       where c.relname = t.tablename and c.relrowsecurity
--     );
