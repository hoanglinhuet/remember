import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Sinh và chuẩn hoá mã ghép nối — DÙNG CHUNG cho mọi adapter.
 *
 * Trước đây mỗi adapter tự sinh mã theo cách riêng, và bản Postgres còn hash chuỗi
 * CÓ dấu gạch lúc tạo nhưng hash chuỗi ĐÃ BỎ gạch lúc đổi ⇒ mã đúng vẫn báo sai.
 * Gộp về một chỗ để lỗi kiểu đó không tái diễn: chỉ một hàm sinh, một hàm chuẩn hoá,
 * một hàm hash.
 */

/** Bỏ các ký tự dễ đọc lẫn (0/O, 1/I/L) — người dùng phải đọc và gõ lại bằng tay. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 10 ký tự trên bảng 31 ⇒ ~49 bit. Đủ với TTL 10 phút và dùng-một-lần. */
export function newPairingCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
    if (i === 4) out += '-'; // gạch giữa chỉ để dễ đọc, không thuộc mã
  }
  return out;
}

/** Bỏ gạch/khoảng trắng, viết hoa. Người dùng gõ kiểu nào cũng khớp. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Chỉ hash bản ĐÃ chuẩn hoá — cả lúc tạo và lúc đổi. */
export function hashPairingCode(input: string): Buffer {
  return createHash('sha256').update(normalizePairingCode(input)).digest();
}
