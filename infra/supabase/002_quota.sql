-- Remember - hạn mức theo từng user (M2)
-- Chạy SAU 001_init.sql.
--
-- Mục tiêu: một tài khoản bị lạm dụng không đốt được 500MB free tier của cả hệ thống.
--
-- ⚠️ GIỚI HẠN CỦA CÁCH NÀY
-- Request vẫn ĐẾN Postgres rồi mới bị từ chối. Nên nó bảo vệ **dung lượng** và
-- **tính toàn vẹn dữ liệu**, KHÔNG bảo vệ egress/CPU khỏi bị hammer. Muốn chặn trước
-- khi chạm DB thì phải có edge (bridge API / Cloudflare) - xem SYNC.md §8.

-- ------------------------------------------------- đổi mô hình quyền ghi
-- 001_init cấp insert/update/delete trực tiếp cho `authenticated`, nên client có thể
-- ghi thẳng qua PostgREST và ĐI VÒNG mọi chốt quota. Siết lại: chỉ còn đọc trực tiếp,
-- mọi thay đổi buộc phải qua RPC push_* -> một điểm nghẽn duy nhất để đặt hạn mức.

revoke insert, update, delete on decks       from authenticated;
revoke insert, update, delete on cards       from authenticated;
revoke insert, update, delete on card_states from authenticated;
revoke insert                 on review_logs from authenticated;
revoke update                 on profiles    from authenticated;
-- select vẫn giữ: PULL đọc trực tiếp qua PostgREST, RLS lo phần phân quyền.

-- ---------------------------------------------------------------- hạn mức

create table if not exists limits (
  key   text primary key,
  value bigint not null
);

insert into limits (key, value) values
  ('max_cards',        20000),   -- NFR-3 nói mượt tới 20k thẻ -> lấy luôn làm trần
  ('max_decks',          500),
  ('rows_per_day',     20000),   -- tổng số dòng ghi/ngày/user
  ('pushes_per_minute',   30)    -- số lần gọi push_*/phút/user
on conflict (key) do nothing;

-- Bảng đếm không cần RLS cho client: client không bao giờ đọc/ghi nó trực tiếp
-- (đã revoke all từ anon ở 001; ở đây không grant gì cho authenticated).
create table if not exists usage_counters (
  user_id        uuid primary key references auth.users on delete cascade,
  day            date        not null default current_date,
  day_rows       bigint      not null default 0,
  minute_at      timestamptz not null default date_trunc('minute', now()),
  minute_pushes  int         not null default 0
);

alter table usage_counters enable row level security;
-- Không có policy nào -> chỉ hàm security definer chạm được. Đúng ý muốn.

/**
 * Tính một lần gọi push với n dòng vào hạn mức của user hiện tại.
 * Raise exception khi vượt -> PostgREST trả 400 kèm message, client hiện lý do.
 * Tự reset counter khi sang ngày / sang phút mới.
 */
create or replace function charge_quota(n int)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  lim_rows   bigint;
  lim_push   bigint;
  cur        usage_counters;
begin
  if uid is null then
    raise exception 'chưa đăng nhập' using errcode = '28000';
  end if;

  select value into lim_rows from limits where key = 'rows_per_day';
  select value into lim_push from limits where key = 'pushes_per_minute';

  insert into usage_counters (user_id) values (uid) on conflict (user_id) do nothing;
  select * into cur from usage_counters where user_id = uid for update;

  -- Sang ngày mới thì reset bộ đếm ngày.
  if cur.day <> current_date then
    cur.day := current_date;
    cur.day_rows := 0;
  end if;

  -- Sang phút mới thì reset bộ đếm phút.
  if cur.minute_at <> date_trunc('minute', now()) then
    cur.minute_at := date_trunc('minute', now());
    cur.minute_pushes := 0;
  end if;

  if cur.minute_pushes + 1 > lim_push then
    raise exception 'quá % lượt đồng bộ mỗi phút, thử lại sau', lim_push
      using errcode = '53400';
  end if;
  if cur.day_rows + n > lim_rows then
    raise exception 'quá % dòng ghi mỗi ngày', lim_rows using errcode = '53400';
  end if;

  update usage_counters set
    day = cur.day,
    day_rows = cur.day_rows + n,
    minute_at = cur.minute_at,
    minute_pushes = cur.minute_pushes + 1
  where user_id = uid;
end $$;

/** Trần tổng: chặn việc phình dung lượng dài hạn (khác với rate limit theo thời gian). */
create or replace function enforce_totals()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n   bigint;
  lim bigint;
begin
  select value into lim from limits where key = 'max_cards';
  select count(*) into n from cards where user_id = uid and deleted_at is null;
  if n > lim then
    raise exception 'đã đạt trần % thẻ', lim using errcode = '53400';
  end if;

  select value into lim from limits where key = 'max_decks';
  select count(*) into n from decks where user_id = uid and deleted_at is null;
  if n > lim then
    raise exception 'đã đạt trần % deck', lim using errcode = '53400';
  end if;
end $$;

-- ------------------------------------------- push_* : definer + tự kiểm quyền
-- Vì đã revoke quyền ghi của `authenticated`, các hàm này phải là SECURITY DEFINER.
-- Hệ quả: RLS KHÔNG còn bảo vệ bên trong hàm -> hàm phải tự kiểm sở hữu.
-- Hai quy tắc bắt buộc, vi phạm là rò dữ liệu giữa các user:
--   1. user_id LUÔN lấy từ auth.uid(), không bao giờ lấy từ payload.
--   2. Trước khi ghi đè một hàng đã tồn tại, phải kiểm hàng đó thuộc auth.uid().

create or replace function push_cards(rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  r         jsonb;
  rejected  jsonb := '[]'::jsonb;
  srv       record;
begin
  if uid is null then raise exception 'chưa đăng nhập' using errcode = '28000'; end if;
  perform charge_quota(jsonb_array_length(rows));

  for r in select * from jsonb_array_elements(rows) loop
    select user_id, updated_at into srv from cards where id = (r->>'id')::uuid;

    -- Hàng đã tồn tại nhưng của user KHÁC -> không tiết lộ, chỉ từ chối.
    if srv.user_id is not null and srv.user_id <> uid then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'reason', 'forbidden');
      continue;
    end if;

    -- Bản trên server mới hơn base mà client dựa vào -> client tự merge rồi đẩy lại.
    if srv.updated_at is not null
       and srv.updated_at > coalesce((r->>'base_updated_at')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'server_updated_at', srv.updated_at);
      continue;
    end if;

    insert into cards (
      id, user_id, deck_id, front, normalized_front, back, reading, reading_type, pos,
      lang_from, lang_to, context_sentence, source_url, source_title, tags, note, deleted_at
    ) values (
      (r->>'id')::uuid, uid, nullif(r->>'deck_id','')::uuid,
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

  perform enforce_totals();
  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

create or replace function push_decks(rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  r         jsonb;
  rejected  jsonb := '[]'::jsonb;
  srv       record;
begin
  if uid is null then raise exception 'chưa đăng nhập' using errcode = '28000'; end if;
  perform charge_quota(jsonb_array_length(rows));

  for r in select * from jsonb_array_elements(rows) loop
    select user_id, updated_at into srv from decks where id = (r->>'id')::uuid;
    if srv.user_id is not null and srv.user_id <> uid then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'reason', 'forbidden');
      continue;
    end if;
    if srv.updated_at is not null
       and srv.updated_at > coalesce((r->>'base_updated_at')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('id', r->>'id', 'server_updated_at', srv.updated_at);
      continue;
    end if;

    insert into decks (id, user_id, name, parent_id, sort_order, deleted_at)
    values ((r->>'id')::uuid, uid, r->>'name', nullif(r->>'parent_id','')::uuid,
            coalesce((r->>'sort_order')::int, 0), nullif(r->>'deleted_at','')::timestamptz)
    on conflict (id) do update set
      name = excluded.name, parent_id = excluded.parent_id,
      sort_order = excluded.sort_order, deleted_at = excluded.deleted_at;
  end loop;

  perform enforce_totals();
  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

create or replace function push_card_states(rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  r         jsonb;
  rejected  jsonb := '[]'::jsonb;
  srv       record;
begin
  if uid is null then raise exception 'chưa đăng nhập' using errcode = '28000'; end if;
  perform charge_quota(jsonb_array_length(rows));

  for r in select * from jsonb_array_elements(rows) loop
    select cs.user_id, cs.last_review into srv
      from card_states cs where cs.card_id = (r->>'card_id')::uuid;

    if srv.user_id is not null and srv.user_id <> uid then
      rejected := rejected || jsonb_build_object('card_id', r->>'card_id', 'reason', 'forbidden');
      continue;
    end if;

    -- Thẻ phải thuộc chính user này (chặn việc gắn tiến độ vào thẻ của người khác).
    if not exists (select 1 from cards where id = (r->>'card_id')::uuid and user_id = uid) then
      rejected := rejected || jsonb_build_object('card_id', r->>'card_id', 'reason', 'unknown_card');
      continue;
    end if;

    -- Tiến độ SRS so bằng last_review, KHÔNG bằng updated_at (ARCHITECTURE §6.2).
    if srv.last_review is not null
       and srv.last_review > coalesce((r->>'last_review')::timestamptz, 'epoch'::timestamptz) then
      rejected := rejected || jsonb_build_object('card_id', r->>'card_id',
                                                'server_last_review', srv.last_review);
      continue;
    end if;

    insert into card_states (card_id, user_id, state, due, stability, difficulty, reps, lapses, last_review)
    values ((r->>'card_id')::uuid, uid, coalesce(r->>'state','new'),
            nullif(r->>'due','')::timestamptz,
            nullif(r->>'stability','')::double precision,
            nullif(r->>'difficulty','')::double precision,
            coalesce((r->>'reps')::int, 0), coalesce((r->>'lapses')::int, 0),
            nullif(r->>'last_review','')::timestamptz)
    on conflict (card_id) do update set
      state = excluded.state, due = excluded.due,
      stability = excluded.stability, difficulty = excluded.difficulty,
      reps = excluded.reps, lapses = excluded.lapses, last_review = excluded.last_review;
  end loop;

  return jsonb_build_object('server_time', now(), 'rejected', rejected);
end $$;

/** review_logs: append-only, bỏ qua bản trùng id -> chạy lại sync bao nhiêu lần cũng an toàn. */
create or replace function push_review_logs(rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'chưa đăng nhập' using errcode = '28000'; end if;
  perform charge_quota(jsonb_array_length(rows));

  insert into review_logs (id, user_id, card_id, rating, reviewed_at, elapsed_ms, scheduled_days)
  select (r->>'id')::uuid, uid, (r->>'card_id')::uuid, (r->>'rating')::smallint,
         (r->>'reviewed_at')::timestamptz, nullif(r->>'elapsed_ms','')::int,
         nullif(r->>'scheduled_days','')::int
    from jsonb_array_elements(rows) r
   where exists (select 1 from cards c where c.id = (r->>'card_id')::uuid and c.user_id = uid)
  on conflict (id) do nothing;

  return jsonb_build_object('server_time', now(), 'rejected', '[]'::jsonb);
end $$;

grant execute on function push_review_logs(jsonb) to authenticated;
-- charge_quota / enforce_totals chỉ được gọi từ trong các hàm push_* -> không grant cho ai.
revoke execute on function charge_quota(int)   from anon, authenticated;
revoke execute on function enforce_totals()    from anon, authenticated;

/** Cập nhật settings: thay cho quyền update trực tiếp lên profiles vừa bị revoke. */
create or replace function push_settings(new_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'chưa đăng nhập' using errcode = '28000'; end if;
  perform charge_quota(1);
  update profiles set settings = new_settings where id = uid;
  return jsonb_build_object('server_time', now());
end $$;
grant execute on function push_settings(jsonb) to authenticated;

-- Dọn counter của user đã lâu không hoạt động (pg_cron, nếu bật extension).
-- select cron.schedule('purge-usage', '0 3 * * *',
--   $$delete from usage_counters where day < current_date - 30$$);
