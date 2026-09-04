/**
 * Đo độ trễ thật tới database, tách riêng từng thành phần.
 *
 * Vì sao cần: từ khi chuyển sang Supabase (Seoul), mỗi round trip mất hàng chục–hàng
 * trăm ms. Adapter bọc MỌI lần đọc trong transaction để `set_config` có hiệu lực cho
 * RLS, nên một lần "đọc" thực chất là BEGIN + set_config + SELECT + COMMIT = 4 round
 * trip. Con số ở đây cho biết nên tối ưu chỗ nào — hay có đáng tối ưu không.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const text = readFileSync(join(here, '..', '.env.local'), 'utf8');
  const m = /^\s*DATABASE_URL\s*=\s*(.*)$/m.exec(text);
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '');
}
const url = process.env.DATABASE_URL;
if (!url) { console.error('✕ thiếu DATABASE_URL'); process.exit(1); }

console.log(`host: ${new URL(url).hostname}:${new URL(url).port}\n`);

const ms = (t) => `${t.toFixed(0)}ms`;
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function timeIt(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return { median: median(out), min: Math.min(...out), max: Math.max(...out) };
}

// ---------------------------------------------------- 1. mở kết nối lần đầu
{
  const t = performance.now();
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await sql`select 1`;
  const cold = performance.now() - t;
  await sql.end({ timeout: 5 });
  console.log(`kết nối lạnh (TCP + TLS + auth + 1 query) : ${ms(cold)}`);
}

const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
await sql`select 1`; // hâm nóng

// ------------------------------------------- 2. một round trip trên kết nối nóng
const rt = await timeIt(10, () => sql`select 1`);
console.log(`1 round trip (kết nối đã mở)              : ${ms(rt.median)}  [${ms(rt.min)}–${ms(rt.max)}]`);

// ----------------------------------- 3. transaction rỗng = BEGIN + COMMIT
const tx = await timeIt(10, () => sql.begin(async (t) => { await t`select 1`; }));
console.log(`transaction (BEGIN+query+COMMIT)          : ${ms(tx.median)}`);

// ------------------- 4. đúng hình dạng adapter đang dùng cho mỗi lần đọc
const asRead = await timeIt(10, () => sql.begin(async (t) => {
  await t`select set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`;
  await t`select 1`;
}));
console.log(`như adapter: BEGIN+set_config+query+COMMIT : ${ms(asRead.median)}`);

// --------------- 5. gộp set_config vào cùng câu lệnh -> bớt 1 round trip
const merged = await timeIt(10, () => sql.begin(async (t) => {
  await t`select set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true), 1`;
}));
console.log(`gộp set_config + query thành 1 câu        : ${ms(merged.median)}`);

console.log(`\nphí mỗi round trip ≈ ${ms(rt.median)}`);
console.log(`⇒ mỗi lần đọc kiểu adapter tốn ≈ ${(asRead.median / rt.median).toFixed(1)} round trip`);
console.log(`⇒ gộp lại tiết kiệm ≈ ${ms(asRead.median - merged.median)} mỗi lần đọc`);

await sql.end({ timeout: 5 });
