import 'server-only';
import { randomBytes } from 'node:crypto';
import { newPairingCode, normalizePairingCode } from '@/lib/server/pairing-code';
import type { Database } from '@/lib/ports/db';
import type { IdentityRepository, User } from '@/lib/ports/identity';
import type { ExistingCard, QueueResult, RecentCard, StudyQueries } from '@/lib/ports/queries';
import type { DedupeKey, NewCardInput, Repos, ReviewLogInput, UnitOfWork } from '@/lib/ports/repositories';
import { DuplicateCard } from '@/lib/ports/repositories';
import type {
  Card, CardProgress, DailyRoom, Deck, DeckSummary, Stats, StudyConfig,
} from '@/lib/domain/types';
import { DEFAULT_CONFIG } from '@/lib/domain/types';
import { normalizeFront, senseKey } from '@/lib/domain/day';
import { isIntraday } from '@/lib/domain/fsrs';
import { levelCounts, memoryLevel } from '@/lib/domain/memory';

/**
 * ADAPTER trong bộ nhớ — CHỈ để phát triển, dựng đúng cùng một port với Postgres.
 *
 * Mục đích: thử luồng đăng nhập Google trước khi có database. Đây là lợi ích cụ thể
 * của việc để tầng dữ liệu sau interface — không phải viết lại gì, chỉ thêm một adapter.
 *
 * ⚠️ GIỚI HẠN, phải biết trước khi tin vào nó:
 *  - Dữ liệu mất khi restart server. Thẻ, tiến độ, phiên đăng nhập: mất hết.
 *  - Không chạy được trên Vercel: mỗi lần gọi function có thể là một instance khác,
 *    nên đăng nhập ở request này sẽ không tồn tại ở request sau.
 *  - `lib/server/db.ts` CHẶN adapter này khi NODE_ENV=production.
 *
 * Giữ state trên globalThis để không mất sau mỗi lần HMR nạp lại module.
 */

interface Store {
  users: Map<string, User & { settings: Partial<StudyConfig> }>;
  oauth: Map<string, string>; // `${provider}:${uid}` -> userId
  sessions: Map<string, { userId: string; expiresAt: Date }>;
  states: Map<string, { codeVerifier: string; nextPath: string; expiresAt: Date }>;
  pairings: Map<string, { userId: string; expiresAt: Date }>;
  decks: Map<string, Deck & { userId: string }>;
  cards: Map<string, Card & { userId: string }>;
  progress: Map<string, CardProgress & { userId: string }>;
  logs: (ReviewLogInput & { userId: string; cardId: string })[];
}

const g = globalThis as unknown as { __rememberMemoryStore?: Store };

function store(): Store {
  g.__rememberMemoryStore ??= {
    users: new Map(), oauth: new Map(), sessions: new Map(), states: new Map(),
    pairings: new Map(),
    decks: new Map(), cards: new Map(), progress: new Map(), logs: [],
  };
  return g.__rememberMemoryStore;
}

const identity: IdentityRepository = {
  async upsertOAuthUser({ provider, providerUid, email, name, avatarUrl }) {
    const s = store();
    const key = `${provider}:${providerUid}`;
    const existingId = s.oauth.get(key);
    if (existingId) {
      const u = s.users.get(existingId)!;
      if (name) u.name = name;
      if (avatarUrl) u.avatarUrl = avatarUrl;
      return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl };
    }

    const byEmail = email ? [...s.users.values()].find((u) => u.email === email) : undefined;
    const user = byEmail ?? {
      id: crypto.randomUUID(),
      email,
      name: name || email?.split('@')[0] || 'Bạn',
      avatarUrl,
      settings: {},
    };
    s.users.set(user.id, user);
    s.oauth.set(key, user.id);
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
  },

  async getUser(userId) {
    const u = store().users.get(userId);
    return u ? { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl } : null;
  },

  async createSession({ userId, ttlMs }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMs);
    store().sessions.set(token, { userId, expiresAt });
    return { token, userId, expiresAt };
  },

  async resolveSession(token) {
    const row = store().sessions.get(token);
    if (!row || row.expiresAt <= new Date()) return null;
    return identity.getUser(row.userId);
  },

  async destroySession(token) {
    store().sessions.delete(token);
  },

  async destroyAllSessions(userId) {
    const s = store();
    for (const [t, row] of s.sessions) if (row.userId === userId) s.sessions.delete(t);
  },

  async saveOAuthState({ state, codeVerifier, nextPath, ttlMs }) {
    const s = store();
    for (const [k, v] of s.states) if (v.expiresAt < new Date()) s.states.delete(k);
    s.states.set(state, { codeVerifier, nextPath, expiresAt: new Date(Date.now() + ttlMs) });
  },

  async takeOAuthState(state) {
    const s = store();
    const row = s.states.get(state);
    s.states.delete(state); // dùng một lần
    return row && row.expiresAt > new Date()
      ? { codeVerifier: row.codeVerifier, nextPath: row.nextPath }
      : null;
  },

  async createPairingCode({ userId, ttlMs }) {
    const s = store();
    for (const [c, v] of s.pairings) if (v.userId === userId || v.expiresAt < new Date()) s.pairings.delete(c);
    // Cùng bộ sinh mã với bản Postgres; khoá lưu là bản đã chuẩn hoá.
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + ttlMs);
    s.pairings.set(normalizePairingCode(code), { userId, expiresAt });
    return { code, expiresAt };
  },

  async claimPairingCode(code) {
    const s = store();
    const key = normalizePairingCode(code);
    const row = s.pairings.get(key);
    s.pairings.delete(key);
    return row && row.expiresAt > new Date() ? row.userId : null;
  },
};

function makeRepos(userId: string): Repos {
  const s = store();
  const mine = <T extends { userId: string }>(m: Map<string, T>) =>
    [...m.values()].filter((x) => x.userId === userId);

  const settings = {
    async get(): Promise<StudyConfig> {
      return { ...DEFAULT_CONFIG, ...(s.users.get(userId)?.settings ?? {}) };
    },
    async save(patch: Partial<StudyConfig>): Promise<StudyConfig> {
      const u = s.users.get(userId);
      if (u) u.settings = { ...u.settings, ...patch };
      return settings.get();
    },
  };

  const decks = {
    async list(): Promise<Deck[]> {
      return mine(s.decks)
        .map(({ userId: _u, ...d }) => d)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    },
    async ensureAtLeastOne(): Promise<Deck[]> {
      const list = await decks.list();
      if (list.length) return list;
      return [await decks.create('Mặc định', 0)];
    },
    async create(name: string, sortOrder: number): Promise<Deck> {
      const deck: Deck = {
        id: crypto.randomUUID(), name, parentId: null, sortOrder,
        updatedAt: new Date().toISOString(),
      };
      s.decks.set(deck.id, { ...deck, userId });
      return deck;
    },
  };

  const cards = {
    async create(input: NewCardInput, deckId: string): Promise<Card> {
      const normalized = normalizeFront(input.front);
      const langFrom = input.langFrom ?? 'auto';
      const langTo = input.langTo ?? 'vi';
      const id = input.id ?? crypto.randomUUID();

      // Cùng bộ khoá với bản Postgres: từ + loại từ + bộ nghĩa + cặp ngôn ngữ.
      const clash = await cards.findDuplicate({
        normalizedFront: normalized,
        pos: input.pos ?? null,
        backKey: senseKey(input.back),
        langFrom,
        langTo,
      });
      if (clash && clash.id !== id) throw new DuplicateCard(clash.id, clash.deckName);

      const now = new Date().toISOString();
      const card: Card = {
        id, deckId, front: input.front, normalizedFront: normalized,
        back: input.back, reading: input.reading ?? null, readingType: input.readingType ?? null,
        pos: input.pos ?? null, langFrom, langTo,
        contextSentence: input.contextSentence ?? null, sourceUrl: input.sourceUrl ?? null,
        sourceTitle: input.sourceTitle ?? null, tags: [], note: null,
        createdAt: s.cards.get(id)?.createdAt ?? now, updatedAt: now,
      };
      s.cards.set(id, { ...card, userId });
      return card;
    },
    async exists(cardId: string) {
      return s.cards.get(cardId)?.userId === userId;
    },
    async addTag(cardId: string, tag: string) {
      const c = s.cards.get(cardId);
      if (c && c.userId === userId && !c.tags.includes(tag)) c.tags.push(tag);
    },
    async findDuplicate(key: DedupeKey) {
      const c = mine(s.cards).find(
        (x) => x.normalizedFront === key.normalizedFront
          && (x.pos ?? '') === (key.pos ?? '')
          && senseKey(x.back) === key.backKey
          && x.langFrom === key.langFrom && x.langTo === key.langTo,
      );
      return c ? { id: c.id, deckName: s.decks.get(c.deckId ?? '')?.name ?? null } : null;
    },
  };

  const progress = {
    async get(cardId: string): Promise<CardProgress | null> {
      const p = s.progress.get(cardId);
      if (!p || p.userId !== userId) return null;
      const { userId: _u, ...rest } = p;
      return rest;
    },
    async save(p: CardProgress) {
      s.progress.set(p.cardId, { ...p, userId });
    },
    async initIfMissing(cardId: string) {
      if (s.progress.has(cardId)) return;
      s.progress.set(cardId, {
        cardId, userId, state: 'new', due: null, stability: null, difficulty: null,
        reps: 0, lapses: 0, lastReview: null, suspended: false,
        updatedAt: new Date().toISOString(),
      });
    },
  };

  const logs = {
    async append(cardId: string, log: ReviewLogInput) {
      s.logs.push({ ...log, cardId, userId });
    },
  };

  return { cards, decks, progress, logs, settings };
}

/**
 * Không có transaction thật — bộ nhớ thì không rollback được.
 * Chấp nhận vì adapter này chỉ để thử luồng đăng nhập, không phải để tin dữ liệu.
 */
const uow: UnitOfWork = {
  async transaction<T>(userId: string, fn: (repos: Repos) => Promise<T>): Promise<T> {
    return fn(makeRepos(userId));
  },
};

function makeQueries(userId: string): StudyQueries {
  const s = store();
  const mineCards = () => [...s.cards.values()].filter((c) => c.userId === userId);
  const mineProgress = () => [...s.progress.values()].filter((p) => p.userId === userId);

  const queries: StudyQueries = {
    async settings(): Promise<StudyConfig> {
      return { ...DEFAULT_CONFIG, ...(s.users.get(userId)?.settings ?? {}) };
    },

    async dailyRoom(): Promise<DailyRoom> {
      const cfg = DEFAULT_CONFIG;
      const todays = s.logs.filter((l) => l.userId === userId);
      const newToday = new Set(todays.filter((l) => l.stateBefore === 'new').map((l) => l.cardId)).size;
      const reviewsToday = todays.filter((l) => l.stateBefore !== 'new').length;
      return {
        newToday, reviewsToday,
        newLeft: Math.max(0, cfg.maxNew - newToday),
        reviewLeft: Math.max(0, cfg.maxReview - reviewsToday),
      };
    },

    async deckSummaries(now = new Date()): Promise<DeckSummary[]> {
      const decks = [...s.decks.values()].filter((d) => d.userId === userId);
      const byCard = new Map(mineProgress().map((p) => [p.cardId, p]));

      return decks.map(({ userId: _u, ...d }) => {
        const cards = mineCards().filter((c) => c.deckId === d.id);
        const row: DeckSummary = {
          ...d, total: cards.length, due: 0, fresh: 0, suspended: 0, levels: [0, 0, 0, 0, 0],
        };
        for (const c of cards) {
          const p = byCard.get(c.id) ?? null;
          if (p?.suspended) { row.suspended++; continue; }
          const li = (memoryLevel(p, DEFAULT_CONFIG.levelThresholds) - 1) as 0 | 1 | 2 | 3 | 4;
          row.levels[li] += 1;
          if (!p || p.state === 'new') row.fresh++;
          else if (p.due && new Date(p.due) <= now) row.due++;
        }
        return row;
      });
    },

    async buildQueue(opts, now = new Date()): Promise<QueueResult> {
      const cfg = { ...DEFAULT_CONFIG, ...(s.users.get(userId)?.settings ?? {}) };
      const room = await queries.dailyRoom(now);
      const byCard = new Map(mineProgress().map((p) => [p.cardId, p]));
      const items = [];
      const learning = [];
      let due = 0;
      let fresh = 0;

      for (const c of mineCards()) {
        if (opts.deckId && c.deckId !== opts.deckId) continue;
        const p = byCard.get(c.id) ?? null;
        if (p?.suspended) continue;
        const { userId: _u, ...card } = c;
        const item = { card, progress: p ? { ...p } : null };

        if (!p || p.state === 'new') { fresh++; items.push(item); }
        else if (isIntraday(p.state)) { learning.push(item); }
        else if (p.due && new Date(p.due) <= now) { due++; items.push(item); }
      }
      const glossPool = mineCards()
        .filter((c) => (!opts.deckId || c.deckId === opts.deckId) && c.back[0])
        .map((c) => ({ gloss: c.back[0]!, pos: c.pos }));
      return {
        items, learning,
        counts: { due, fresh, learning: learning.length },
        glossPool: glossPool.slice(0, 300),
        room, config: cfg,
      };
    },

    async recentCards(limit: number): Promise<RecentCard[]> {
      return mineCards()
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(({ userId: _u, ...c }) => ({
          ...c,
          deckName: s.decks.get(c.deckId ?? '')?.name ?? null,
        }));
    },

    async cardsByFront(front: string, langFrom: string, langTo: string): Promise<ExistingCard[]> {
      const key = normalizeFront(front);
      return mineCards()
        .filter((c) => c.normalizedFront === key && c.langFrom === langFrom && c.langTo === langTo)
        .map((c) => ({
          id: c.id,
          pos: c.pos,
          back: c.back,
          backKey: senseKey(c.back),
          deckName: s.decks.get(c.deckId ?? '')?.name ?? null,
          createdAt: c.createdAt,
        }));
    },

    async stats(): Promise<Stats> {
      const all = mineProgress();
      const live = all.filter((p) => !p.suspended);
      return {
        cards: mineCards().length,
        logs: s.logs.filter((l) => l.userId === userId).length,
        today: s.logs.filter((l) => l.userId === userId).length,
        due: live.filter((p) => p.due && new Date(p.due) <= new Date()).length,
        learning: live.filter((p) => isIntraday(p.state)).length,
        review: live.filter((p) => p.state === 'review').length,
        suspended: all.filter((p) => p.suspended).length,
        leeches: all.filter((p) => p.lapses >= DEFAULT_CONFIG.leechThreshold).length,
        levels: levelCounts(all, DEFAULT_CONFIG.levelThresholds),
      };
    },
  };
  return queries;
}

export const memoryDatabase: Database = {
  identity,
  uow,
  queriesFor: makeQueries,
  async ping() {
    return true;
  },
  async close() {
    delete g.__rememberMemoryStore;
  },
};
