/**
 * Chuẩn hoá tên miền để so khớp danh sách "tắt highlight".
 *
 * PHẢI giống hệt bản trong extension (`src/background/service-worker.js`), nếu không
 * người dùng tắt highlight ở `www.abc.com` mà trang `abc.com` vẫn sáng — và họ sẽ
 * chỉ thấy "công tắc không ăn".
 *
 * Quy tắc: bỏ scheme, bỏ đường dẫn/port, lowercase, bỏ tiền tố `www.`.
 * `www` là alias của cùng một site trong hầu hết mọi trường hợp thực tế, nên tách
 * hai cái đó thành hai mục chỉ tạo ra lỗi "đã tắt rồi mà vẫn hiện".
 */
export function normalizeHost(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/** Host hợp lệ để lưu: chỉ chữ/số/dấu chấm/gạch, có ít nhất một dấu chấm. */
export function isStorableHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/.test(host);
}
