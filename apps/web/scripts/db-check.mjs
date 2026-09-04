/**
 * Kiểm tra một DATABASE_URL trước khi tin vào nó.
 *
 * Bốn thứ mà cấu hình sai KHÔNG báo lỗi, chỉ âm thầm hỏng:
 *   1. Kết nối bằng role chủ ⇒ **RLS bị bỏ qua** (chủ sở hữu bảng bỏ qua RLS)
 *   2. Trên Supabase, `anon` (khoá công khai) vẫn đọc được bảng ⇒ lộ session token
 *   3. Thiếu migration ⇒ lỗi lúc chạy, không phải lúc cấu hình
 *   4. Dùng direct connection IPv6-only ⇒ chạy được ở máy bạn, chết trên Vercel
 *
 * Chạy: npm run db:check
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

// Nạp .env.local mà không cần thêm dependency.
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const text = readFileSync(join(here, '..', '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      process.env[m[1]] ??= value;
    }
  } catch {
    /* không có .env.local cũng được, có thể biến đã đặt sẵn */
  }
}

loadEnv();

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('✕ Chưa có DATABASE_URL (kiểm tra apps/web/.env.local)');
  process.exit(1);
}

/** In host/port/user nhưng KHÔNG in mật khẩu. */
function describe(raw) {
  try {
    const u = new URL(raw);
    return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: u.pathname.slice(1) };
  } catch {
    return null;
  }
}

const at = describe(url);
console.log('\n== chuỗi kết nối ==');
if (at) {
  console.log(`  host  ${at.host}:${at.port}`);
  console.log(`  user  ${at.user}`);
  console.log(`  db    ${at.db}`);
} else {
  console.log('  (không phân tích được URL — vẫn thử kết nối)');
}

if (at && /^db\..*\.supabase\.co$/.test(at.host)) {
  console.log('  ⚠️  direct connection của Supabase: IPv6-only ở project mới.');
  console.log('      Chạy được ở máy bạn nhưng Vercel function có thể ENETUNREACH.');
  console.log('      Nên đổi sang transaction pooler cổng 6543.');
}
if (at && at.host.includes('pooler.supabase.com') && at.port !== '6543') {
  console.log(`  ⚠️  đang dùng pooler cổng ${at.port} (session mode).`);
  console.log('      Serverless nên dùng 6543 (transaction mode).');
}

const sql = postgres(url, { max: 1, connect_timeout: 10, prepare: false, onnotice: () => {} });

let problems = 0;
const bad = (m) => { problems++; console.log(`  ✕ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

try {
  console.log('\n== kết nối ==');
  const [info] = await sql`
    select current_user as role, current_database() as db,
           version() as version, inet_server_addr()::text as server_ip`;
  ok(`kết nối được — role ${info.role}, db ${info.db}`);
  console.log(`    ${String(info.version).split(' ').slice(0, 2).join(' ')}${info.server_ip ? ` @ ${info.server_ip}` : ''}`);

  // ------------------------------------------------------------- migration
  console.log('\n== migration ==');
  const tables = (await sql`
    select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename);
  const need = ['users', 'oauth_accounts', 'sessions', 'oauth_states', 'decks', 'cards',
    'card_states', 'review_logs', 'pairing_codes'];
  const missing = need.filter((t) => !tables.includes(t));
  if (missing.length) bad(`thiếu bảng: ${missing.join(', ')} → chạy 001/003`);
  else ok(`đủ ${need.length} bảng`);

  const [dedupe] = await sql`
    select count(*)::int as n from pg_indexes
    where schemaname = 'public' and indexname = 'cards_dedupe'`;
  if (dedupe.n) ok('khoá dedupe theo nghĩa (004) đã có');
  else bad('thiếu index cards_dedupe → chạy 004');

  // ------------------------------------------------------------------- RLS
  console.log('\n== RLS ==');
  const noRls = (await sql`
    select tablename from pg_tables t
    where schemaname = 'public'
      and tablename not in ('sessions', 'oauth_states', 'pairing_codes')
      and not exists (select 1 from pg_class c
                      where c.relname = t.tablename and c.relrowsecurity)`)
    .map((r) => r.tablename);
  if (noRls.length) bad(`bảng dữ liệu chưa bật RLS: ${noRls.join(', ')}`);
  else ok('mọi bảng dữ liệu đã bật RLS');

  // Chủ sở hữu bảng BỎ QUA RLS. Kiểm bằng phép thử ĐỐI CHỨNG, không suy từ tên role:
  // đếm cùng một bảng dưới hai ngữ cảnh user khác nhau. RLS có hiệu lực thì hai số
  // phải KHÁC nhau. Không được lấy "tổng thật" bằng một count thường — count đó cũng
  // bị RLS lọc, và sẽ ra 0 làm ta tưởng bảng rỗng.
  const [owner] = await sql`
    select pg_get_userbyid(relowner) as owner, relforcerowsecurity as forced
    from pg_class where relname = 'cards' and relkind = 'r'`;
  // Chưa chạy 001 thì không có bảng nào để soi — bỏ qua, phần migration đã báo lỗi rồi.
  if (!owner) {
    console.log('    (chưa có bảng cards — chạy migration trước)');
  } else {
  console.log(`    chủ bảng cards: ${owner.owner}${owner.forced ? ' (force rls)' : ''}`);

  // Ước lượng của planner KHÔNG qua RLS — dùng để biết bảng có dữ liệu hay không.
  const [est] = await sql`
    select greatest(reltuples, 0)::bigint as n from pg_class where relname = 'cards'`;

  const FAKE = '00000000-0000-0000-0000-000000000000';
  const count = (uid) => sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${uid}, true)`;
    const [r] = await tx`select count(*)::int as n from cards`;
    return r.n;
  });

  // `users` đọc được không cần ngữ cảnh (policy có nhánh `app_user_id() is null`).
  const someone = (await sql`select id from users limit 1`)[0]?.id ?? null;
  const asFake = await count(FAKE);
  const asReal = someone ? await count(someone) : null;

  if (Number(est.n) === 0 && asFake === 0 && !asReal) {
    console.log('    ⚠️  chưa có dữ liệu để kết luận RLS. Thêm một thẻ rồi chạy lại.');
  } else if (asReal === null) {
    console.log('    ⚠️  chưa có user nào — kết luận RLS sau khi đăng nhập lần đầu.');
  } else if (asFake === 0 && asReal > 0) {
    ok(`RLS CÓ hiệu lực (user thật thấy ${asReal} thẻ, user giả thấy 0)`);
  } else if (asFake > 0 && asFake === asReal) {
    bad(`RLS BỊ BỎ QUA — user giả vẫn thấy ${asFake} thẻ, đúng bằng user thật.`);
    console.log(`      Đang kết nối bằng chủ sở hữu bảng (${owner.owner}); chủ bảng bỏ qua RLS.`);
    console.log('      Đổi user trong DATABASE_URL sang remember_app.');
    console.log('      Code vẫn đúng vì mọi query đều lọc user_id, nhưng mất lớp phòng thủ thứ hai.');
  } else {
    bad(`RLS cho kết quả lạ: user thật ${asReal}, user giả ${asFake}, planner ước ${est.n}`);
  }
  }

  // -------------------------------------------------- PostgREST (Supabase)
  console.log('\n== phơi ra internet (chỉ Supabase) ==');
  const roles = (await sql`
    select rolname from pg_roles where rolname in ('anon', 'authenticated')`)
    .map((r) => r.rolname);
  if (!roles.length) {
    ok('không có role anon/authenticated — đây không phải Supabase, không có PostgREST');
  } else {
    const leaked = await sql`
      select grantee, table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
      group by grantee, table_name order by table_name`;
    if (!leaked.length) ok(`${roles.join('/')} không còn quyền nào trên public (005 đã chạy)`);
    else {
      bad(`${leaked.length} cặp (role, bảng) còn phơi qua PostgREST bằng anon key CÔNG KHAI:`);
      for (const r of leaked.slice(0, 12)) console.log(`      ${r.grantee} → ${r.table_name}`);
      if (leaked.length > 12) console.log(`      … và ${leaked.length - 12} dòng nữa`);
      console.log('      Chạy infra/postgres/005_supabase_lockdown.sql');
    }
  }

  // ------------------------------------------------------------ append-only
  console.log('\n== review_logs append-only ==');
  const [canWrite] = await sql`
    select count(*)::int as n from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'review_logs'
      and grantee = 'remember_app' and privilege_type in ('UPDATE', 'DELETE')`;
  if (canWrite.n === 0) ok('remember_app không có quyền update/delete');
  else bad('remember_app vẫn sửa/xoá được review_logs → chạy lại 002');

} catch (e) {
  bad(`không kết nối được: ${e.code ?? ''} ${e.message}`);
  if (e.code === 'ENETUNREACH' || e.code === 'ETIMEDOUT') {
    console.log('      Thường là direct connection IPv6-only. Đổi sang pooler cổng 6543.');
  }
  if (e.code === '28P01') {
    console.log('      Sai mật khẩu, hoặc pooler không nhận role tự tạo.');
    console.log('      Thử user postgres.<project-ref> để phân biệt hai nguyên nhân.');
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(problems ? `\n✕ ${problems} vấn đề\n` : '\n✓ tất cả đều ổn\n');
process.exit(problems ? 1 : 0);
