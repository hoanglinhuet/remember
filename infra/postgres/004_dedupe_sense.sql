-- Đổi khoá chống trùng: thêm LOẠI TỪ và NGHĨA vào key.
--
-- Trước:  (user_id, normalized_front, lang_from, lang_to)
--         ⇒ `book` (danh từ) và `book` (động từ) bị coi là một thẻ. Sai.
--
-- Sau:    (user_id, normalized_front, coalesce(pos,''), back_key, lang_from, lang_to)
--         ⇒ khác loại từ = thẻ khác; khác nghĩa = thẻ khác.
--
-- `back_key` là dạng chuẩn hoá của mảng `back` (nghĩa tiếng Việt). Cần nó vì `back`
-- là jsonb array: ["kiên cường","đàn hồi"] và ["đàn hồi","kiên cường"] là cùng một
-- bộ nghĩa nhưng khác thứ tự, không thể đưa mảng thô vào unique index.
--
-- Chuẩn hoá = lowercase + trim từng phần tử + SẮP XẾP + nối bằng '|'.
-- App tính giá trị này (`senseKey()` trong lib/domain/day.ts) — cùng chỗ với
-- `normalized_front`, để chỉ có một nơi quyết định thế nào là "trùng".

alter table cards add column if not exists back_key text not null default '';

-- Backfill cho các thẻ đã có. `collate "C"` để thứ tự sắp xếp khớp với
-- Array.prototype.sort() của JavaScript (so theo code point), tránh lệch
-- giữa dòng cũ và dòng mới.
update cards c set back_key = coalesce((
  select string_agg(lower(btrim(value)), '|' order by lower(btrim(value)) collate "C")
  from jsonb_array_elements_text(c.back) as t(value)
), '')
where back_key = '';

drop index if exists cards_dedupe;

create unique index cards_dedupe on cards
  (user_id, normalized_front, coalesce(pos, ''), back_key, lang_from, lang_to)
  where deleted_at is null;

-- `coalesce(pos,'')` là bắt buộc, không phải cho gọn: trong SQL, NULL <> NULL, nên
-- unique index coi mọi dòng có pos = NULL là KHÁC nhau. Cụm từ và câu thường không
-- có loại từ ⇒ để `pos` trần thì dedupe ngừng hoạt động với đúng nhóm đó.

comment on column cards.back_key is
  'Dạng chuẩn hoá của back: lowercase + trim + sort + join "|". App tính, dùng cho cards_dedupe.';
