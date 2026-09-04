import { env, hasDb, hasGoogle, isConfigured, originOf, usingMemoryDb } from '@/lib/server/env';
import { getDb } from '@/lib/server/db';


/**
 * Công khai. Hai việc: cron keepalive (nhà cung cấp free hay ngủ khi không có query),
 * và tự chẩn đoán — in ra ĐÚNG redirect URI cần dán vào Google Cloud Console.
 * KHÔNG trả về giá trị secret, chỉ trả về việc chúng có tồn tại hay không.
 */
export async function GET(req: Request) {
  const origin = originOf(req);
  const dbOk = isConfigured ? await getDb().ping() : null;

  return Response.json({
    ok: isConfigured && dbOk === true,
    configured: isConfigured,
    hasDatabaseUrl: hasDb,
    storage: usingMemoryDb ? 'memory (DEV — mất khi restart)' : 'postgres',
    hasGoogleCredentials: hasGoogle,
    databaseReachable: dbOk,
    allowedExtensionIds: env.allowedExtensionIds.length,
    origin,
    // Dán chuỗi này vào Google Cloud Console → Authorized redirect URIs
    googleRedirectUri: `${origin}/api/v1/auth/callback`,
    time: new Date().toISOString(),
  });
}
