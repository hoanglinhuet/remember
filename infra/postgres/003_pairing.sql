-- Ghép nối extension với tài khoản.
--
-- Vấn đề: web app đăng nhập bằng cookie httpOnly, mà extension chạy ở origin
-- `chrome-extension://` nên không đọc được cookie đó. Extension cần một phiên RIÊNG.
--
-- Cách làm: web tạo một MÃ ngắn hạn, người dùng dán vào extension, extension đổi mã
-- lấy session token của chính nó (`sessions.kind = 'extension'`).
--
-- Vì sao không dùng `externally_connectable` (web tự đẩy token sang extension):
--   - Firefox KHÔNG hỗ trợ, mà ADR-9 nói ship Firefox trước.
--   - Phải khai extension ID ở cả hai phía; ID đổi theo cách đóng gói (dev/unpacked/store).
-- Đổi lại: người dùng phải copy-paste một lần.

create table if not exists pairing_codes (
  -- Chỉ lưu SHA-256. Dump DB hay đọc log cũng không lấy được mã.
  code_hash  bytea       primary key,
  user_id    uuid        not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  label      text
);

create index if not exists pairing_by_user on pairing_codes (user_id);
create index if not exists pairing_expiry on pairing_codes (expires_at);

-- Không đặt RLS: giống `sessions` và `oauth_states`, bảng này bị chạm khi CHƯA biết
-- user là ai (lúc extension đổi mã). Tầng danh tính là chỗ duy nhất truy cập nó.

grant select, insert, delete on pairing_codes to remember_app;
