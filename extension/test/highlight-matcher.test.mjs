// Kiểm tra đúng phần "khớp từ" của highlight.js — phần duy nhất chạy được ngoài browser.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(fronts) {
  const list = [...new Set(fronts.map((f) => String(f).trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

const hits = (re, text) => {
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((m) => m[0]);
};

const re = build(['give', 'give up', 'book', 'kiên cường', 'c++', 'ad-hoc']);
const cases = [
  ['cụm thắng từ đơn', hits(re, 'I will not give up now'), ['give up']],
  ['từ đơn vẫn khớp', hits(re, 'give me a book'), ['give', 'book']],
  ['không khớp giữa từ', hits(re, 'booking bookmark forgive'), []],
  ['hoa/thường', hits(re, 'Book BOOK Give Up'), ['Book', 'BOOK', 'Give Up']],
  ['tiếng Việt có dấu', hits(re, 'sự kiên cường đó'), ['kiên cường']],
  ['không cắt giữa từ tiếng Việt', hits(re, 'kiên cườngx superkiên cường'), []],
  ['escape ký tự regex', hits(re, 'viết c++ và ad-hoc'), ['c++', 'ad-hoc']],
];

let bad = 0;
for (const [name, got, want] of cases) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(got)}${ok ? '' : ` (mong ${JSON.stringify(want)})`}`);
}

// Vì sao không dùng \b: \b định nghĩa theo [A-Za-z0-9_], nên chữ có dấu bị coi là
// ranh giới ⇒ khớp cả khi từ nằm dính vào chữ khác.
console.log('\n\\b   trong "cườngx":', /\bcường\b/giu.test('cườngx'));
console.log('lookaround trong "cườngx":', build(['cường']).test('cườngx'));

process.exit(bad ? 1 : 0);
