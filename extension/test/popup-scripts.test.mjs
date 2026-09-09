/**
 * Bảo vệ popup khỏi lớp lỗi "script chết trước khi chạy dòng đầu tiên".
 *
 * LỖI THẬT ĐÃ GẶP: `account.js` và `popup.js` cùng là classic script ⇒ dùng chung
 * global scope. Cả hai khai báo `el` và `render` ở cấp cao nhất, nên khi nạp
 * `popup.js` trình duyệt ném `SyntaxError: Identifier 'el' has already been declared`
 * NGAY LÚC KHỞI TẠO — popup.js không chạy một dòng nào. Hệ quả nhìn từ ngoài: ô tick
 * highlight bấm không ăn, không có API call, không có log, danh sách thẻ trống.
 *
 * Test này kiểm hai điều, và một trong hai là đủ để lớp lỗi đó không xảy ra:
 *   1. mọi script trong popup.html được nạp bằng `type="module"` (mỗi file một scope);
 *   2. nếu còn classic script, thì chúng KHÔNG trùng tên khai báo ở cấp cao nhất —
 *      kiểm bằng cách chạy thật trong một vm context dùng chung.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const here = import.meta.dirname;
const popupDir = join(here, '..', 'src', 'popup');
const html = readFileSync(join(popupDir, 'popup.html'), 'utf8');

const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => {
  const attrs = m[1];
  const src = /src="([^"]+)"/.exec(attrs)?.[1];
  return { src, module: /type="module"/.test(attrs) };
}).filter((s) => s.src);

let bad = 0;
const check = (ok, msg) => {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

check(scripts.length > 0, `tìm thấy ${scripts.length} script trong popup.html`);

// --- 1. Kiểu nạp -------------------------------------------------------------
const classic = scripts.filter((s) => !s.module);
check(classic.length === 0,
  classic.length === 0
    ? 'mọi script đều type="module" (mỗi file một scope)'
    : `còn classic script: ${classic.map((s) => s.src).join(', ')}`);

// --- 2. Nếu còn classic script: chứng minh chúng không đụng nhau -------------
if (classic.length > 1) {
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => {} }) }),
    chrome: new Proxy({}, { get: () => new Proxy({}, { get: () => () => {} }) }),
    URL, Blob: class {}, setTimeout, clearTimeout,
  });
  context.window = context;

  for (const s of classic) {
    const code = readFileSync(join(popupDir, s.src), 'utf8');
    try {
      new vm.Script(code, { filename: s.src }).runInContext(context);
      console.log(`PASS  ${s.src} nạp được trong scope dùng chung`);
    } catch (e) {
      // So bằng `e.name`, KHÔNG dùng `instanceof`: lỗi từ trong vm thuộc realm khác
      // nên `e instanceof SyntaxError` luôn false — đã đo, và nó làm test báo PASS
      // cho đúng cái nó phải bắt.
      // ReferenceError/TypeError là do stub DOM quá thô — không phải lỗi đang tìm.
      if (e.name === 'SyntaxError') {
        bad++;
        console.log(`FAIL  ${s.src} ĐỤNG TÊN với script nạp trước: ${e.message}`);
      } else {
        console.log(`PASS  ${s.src} không đụng tên (dừng vì stub DOM: ${e.constructor.name})`);
      }
    }
  }
}

// --- 3. Cảnh báo sớm: trùng tên ở cấp cao nhất giữa các file -----------------
// Với module thì trùng tên là hợp lệ, nhưng in ra vẫn hữu ích: nếu ai đó đổi lại
// thành classic script thì đây chính là danh sách sẽ nổ.
const declRe = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
const byFile = new Map();
for (const s of scripts) {
  const code = readFileSync(join(popupDir, s.src), 'utf8');
  byFile.set(s.src, new Set([...code.matchAll(declRe)].map((m) => m[1])));
}
const files = [...byFile.keys()];
for (let i = 0; i < files.length; i++) {
  for (let j = i + 1; j < files.length; j++) {
    const shared = [...byFile.get(files[i])].filter((n) => byFile.get(files[j]).has(n));
    if (shared.length) {
      console.log(`      (ghi nhận) ${files[i]} và ${files[j]} trùng tên: ${shared.join(', ')}`
        + ' — an toàn vì đang là module, sẽ nổ nếu đổi về classic script');
    }
  }
}

process.exit(bad ? 1 : 0);
