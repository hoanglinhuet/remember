/**
 * Dò đúng chuỗi kết nối pooler của Supabase, từ chuỗi direct connection đang có.
 *
 * Vì sao cần: direct connection `db.<ref>.supabase.co` là IPv6-only ở project mới
 * (đã đo: chỉ có AAAA, không có A record), nên máy/Vercel không có IPv6 sẽ không
 * kết nối được. Pooler có IPv4 nhưng host chứa mã region mà chuỗi direct không nói.
 *
 * Script chỉ đọc `.env.local`, thử từng ứng viên, và IN RA host/port/user —
 * KHÔNG bao giờ in mật khẩu.
 *
 * Chạy: node scripts/db-find-pooler.mjs [--write]
 *   --write : ghi chuỗi tìm được vào .env.local (giữ lại bản cũ thành comment)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env.local');
const raw = readFileSync(envPath, 'utf8');

const line = /^\s*DATABASE_URL\s*=\s*(.*)$/m.exec(raw);
if (!line) {
  console.error('✕ Không thấy DATABASE_URL trong .env.local');
  process.exit(1);
}
const current = line[1].trim().replace(/^["']|["']$/g, '');
const u = new URL(current);

const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1]
  ?? /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username))?.[1];
if (!ref) {
  console.error(`✕ Không rút được project-ref từ host "${u.hostname}"`);
  console.error('  Chuỗi phải có dạng db.<ref>.supabase.co, hoặc user postgres.<ref>');
  process.exit(1);
}
console.log(`project-ref: ${ref}`);

// Region không nằm trong chuỗi direct connection, nên phải thử. Xếp ap-southeast-1
// lên đầu vì AAAA của project này thuộc dải APAC (2406:da12 = AWS Singapore).
const REGIONS = [
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
  'sa-east-1', 'ca-central-1',
];

/** Ứng viên: transaction pooler (6543) trước, rồi session pooler (5432). */
function candidates() {
  const out = [];
  for (const region of REGIONS) {
    for (const prefix of ['aws-0', 'aws-1']) {
      for (const port of [6543, 5432]) {
        out.push({ host: `${prefix}-${region}.pooler.supabase.com`, port, region });
      }
    }
  }
  return out;
}

/** Đổi host/port/user nhưng giữ nguyên mật khẩu — không đọc, không in. */
function rebuild({ host, port }) {
  const next = new URL(current);
  next.hostname = host;
  next.port = String(port);
  next.username = `postgres.${ref}`;
  next.searchParams.set('sslmode', 'require');
  return next.toString();
}

import { promises as dns } from 'node:dns';

async function resolves(host) {
  try {
    await dns.resolve4(host);
    return true;
  } catch {
    return false;
  }
}

let found = null;
const tried = new Set();

for (const c of candidates()) {
  if (tried.has(c.host)) {
    // Region này đã biết là không phân giải được, khỏi thử cổng thứ hai.
  } else {
    tried.add(c.host);
    if (!(await resolves(c.host))) continue;
  }
  if (!(await resolves(c.host))) continue;

  process.stdout.write(`  thử ${c.host}:${c.port} … `);
  const sql = postgres(rebuild(c), { max: 1, connect_timeout: 8, prepare: false, onnotice: () => {} });
  try {
    const [r] = await sql`select current_user as who, current_database() as db`;
    console.log(`✓ kết nối được (role ${r.who}, db ${r.db})`);
    found = { ...c, url: rebuild(c) };
    await sql.end({ timeout: 3 });
    break;
  } catch (e) {
    // 28P01 = sai mật khẩu / role không được pooler chấp nhận.
    // Các lỗi khác thường là project không ở region này.
    console.log(`✕ ${e.code ?? e.message?.slice(0, 60)}`);
    await sql.end({ timeout: 3 }).catch(() => {});
  }
}

if (!found) {
  console.log('\n✕ Không tìm được pooler nào nhận kết nối.');
  console.log('  Lấy chuỗi chính xác ở: Supabase → Project Settings → Database');
  console.log('  → Connection string → Transaction pooler.');
  process.exit(1);
}

console.log(`\n✓ Dùng chuỗi này (region ${found.region}, cổng ${found.port}):`);
console.log(`    host  ${found.host}:${found.port}`);
console.log(`    user  postgres.${ref}`);
if (found.port !== 6543) {
  console.log('  ⚠️  Đây là session pooler. Transaction pooler (6543) mới đúng cho serverless.');
}

if (process.argv.includes('--write')) {
  const next = raw.replace(
    /^(\s*DATABASE_URL\s*=.*)$/m,
    `# chuỗi cũ (direct connection, IPv6-only — Vercel không kết nối được):\n#$1\nDATABASE_URL=${found.url}`,
  );
  writeFileSync(envPath, next, 'utf8');
  console.log('\n✓ Đã ghi vào .env.local (chuỗi cũ giữ lại thành comment)');
} else {
  console.log('\n  Chạy lại với --write để ghi vào .env.local');
}
