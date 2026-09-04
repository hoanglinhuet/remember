export interface User {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}

/** Danh tính: tài khoản OAuth, phiên đăng nhập, chống CSRF cho luồng OAuth. */
export interface IdentityRepository {
  upsertOAuthUser(input: {
    provider: string;
    providerUid: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
  }): Promise<User>;

  getUser(userId: string): Promise<User | null>;

  createSession(input: {
    userId: string;
    ttlMs: number;
    userAgent: string | null;
    kind: 'web' | 'extension';
  }): Promise<Session>;

  resolveSession(token: string): Promise<User | null>;
  destroySession(token: string): Promise<void>;
  destroyAllSessions(userId: string): Promise<void>;

  saveOAuthState(input: { state: string; codeVerifier: string; nextPath: string; ttlMs: number }): Promise<void>;
  /** Lấy VÀ xoá — state chỉ dùng được một lần. */
  takeOAuthState(state: string): Promise<{ codeVerifier: string; nextPath: string } | null>;

  /**
   * Ghép nối extension: web tạo mã ngắn hạn, extension đổi mã lấy session của nó.
   * Chỉ lưu hash của mã, và mã dùng MỘT lần.
   */
  createPairingCode(input: { userId: string; ttlMs: number; label: string | null }): Promise<PairingCode>;
  claimPairingCode(code: string): Promise<string | null>;
}

export interface PairingCode {
  code: string;
  expiresAt: Date;
}
