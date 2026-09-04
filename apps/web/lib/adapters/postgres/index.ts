import 'server-only';
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';
import { hashPairingCode, newPairingCode } from '@/lib/server/pairing-code';
import type { Database } from '@/lib/ports/db';
import type { IdentityRepository, User } from '@/lib/ports/identity';
import type { ExistingCard, QueueResult, RecentCard, StudyQueries } from '@/lib/ports/queries';
import type { DedupeKey, NewCardInput, Repos, ReviewLogInput, UnitOfWork } from '@/lib/ports/repositories';
import { DuplicateCard } from '@/lib/ports/repositories';
import type {
  Card, CardProgress, CardState, DailyRoom, Deck, DeckSummary, QueueItem, Stats, StudyConfig,
} from '@/lib/domain/types';
import { DEFAULT_CONFIG } from '@/lib/domain/types';
import type { GlossOption } from '@/lib/domain/types';
import { dayEnd, dayStart, normalizeFront, senseKey } from '@/lib/domain/day';
import { isIntraday } from '@/lib/domain/fsrs';
import { levelCounts, memoryLevel } from '@/lib/domain/memory';

/**
 * ADAPTER Postgres — cài đặt duy nhất của các port.
 *
 * File DUY NHẤT trong toàn bộ app biết SQL. Chạy trên bất kỳ Postgres nào:
 * chỉ cần DATABASE_URL.
 */

let pool: ReturnType<typeof postgres> | null = null;

function db() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL chưa đặt');
  pool = postgres(url, {
    max: 3,              // serverless: mỗi instance giữ ít kết nối
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,      // pooler chế độ transaction không hỗ trợ prepared statement
    onnotice: () => {},
    // DB_DEBUG=1: in từng câu lệnh gửi đi. Với DB ở xa, thứ quyết định độ trễ là SỐ
    // LẦN khứ hồi, không phải query nào chậm — mà số đó không đoán được từ code vì
    // BEGIN/COMMIT/set_config đều tính. Đếm rồi hãy tối ưu.
    ...(process.env.DB_DEBUG === '1'
      ? {
          debug: (_conn: number, query: string) => {
            const q = query.replace(/\s+/g, ' ').trim().slice(0, 70);
            console.log(`[db] ${q}`);
          },
        }
      : {}),
  });
  return pool;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Sql = postgres.Sql | postgres.TransactionSql;

// ------------------------------------------------------- ánh xạ hàng ↔ miền

function toUser(r: Row): User {
  return {
    id: r.id,
    email: r.email ?? null,
    name: r.name || (r.email ? String(r.email).split('@')[0] : 'Bạn') || 'Bạn',
    avatarUrl: r.avatar_url ?? null,
  };
}

function toCard(r: Row): Card {
  return {
    id: r.id,
    deckId: r.deck_id ?? null,
    front: r.front,
    normalizedFront: r.normalized_front,
    back: Array.isArray(r.back) ? r.back : [],
    reading: r.reading ?? null,
    readingType: r.reading_type ?? null,
    pos: r.pos ?? null,
    langFrom: r.lang_from,
    langTo: r.lang_to,
    contextSentence: r.context_sentence ?? null,
    sourceUrl: r.source_url ?? null,
    sourceTitle: r.source_title ?? null,
    tags: r.tags ?? [],
    note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toProgress(r: Row): CardProgress {
  return {
    cardId: r.card_id,
    state: r.state as CardState,
    due: r.due ? new Date(r.due).toISOString() : null,
    stability: r.stability ?? null,
    difficulty: r.difficulty ?? null,
    reps: r.reps ?? 0,
    lapses: r.lapses ?? 0,
    lastReview: r.last_review ? new Date(r.last_review).toISOString() : null,
    suspended: Boolean(r.suspended),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toDeck(r: Row): Deck {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const hashToken = (t: string) => createHash('sha256').update(t).digest();


/**
 * Đặt `app.user_id` cho phiên DB hiện tại. RLS đọc biến này thay cho `auth.uid()`
 * của Supabase — quên lọc user_id ở tầng code thì DB vẫn chặn.
 */
async function scope(sql: Sql, userId: string) {
  await sql`select set_config('app.user_id', ${userId}, true)`;
}

// ------------------------------------------------------------ repositories

function makeRepos(sql: Sql, userId: string): Repos {
  const settings = {
    async get(): Promise<StudyConfig> {
      const rows = await sql`select settings from users where id = ${userId}`;
      return { ...DEFAULT_CONFIG, ...((rows[0]?.settings ?? {}) as Partial<StudyConfig>) };
    },
    async save(patch: Partial<StudyConfig>): Promise<StudyConfig> {
      const next = { ...(await settings.get()), ...patch };
      await sql`update users set settings = ${sql.json(next as never)} where id = ${userId}`;
      return next;
    },
  };

  const decks = {
    async list(): Promise<Deck[]> {
      const rows = await sql`
        select id, name, parent_id, sort_order, updated_at from decks
        where user_id = ${userId} and deleted_at is null
        order by sort_order, name`;
      return rows.map(toDeck);
    },
    async ensureAtLeastOne(): Promise<Deck[]> {
      const list = await decks.list();
      if (list.length) return list;
      await sql`
        insert into decks (id, user_id, name, sort_order)
        values (${crypto.randomUUID()}, ${userId}, 'Mặc định', 0)`;
      return decks.list();
    },
    async create(name: string, sortOrder: number): Promise<Deck> {
      const rows = await sql`
        insert into decks (id, user_id, name, sort_order)
        values (${crypto.randomUUID()}, ${userId}, ${name}, ${sortOrder})
        returning id, name, parent_id, sort_order, updated_at`;
      return toDeck(rows[0]!);
    },
  };

  const cards = {
    async create(input: NewCardInput, deckId: string): Promise<Card> {
      const id = input.id ?? crypto.randomUUID();
      const normalized = normalizeFront(input.front);
      const langFrom = input.langFrom ?? 'auto';
      const langTo = input.langTo ?? 'vi';
      const pos = input.pos ?? null;
      const backKey = senseKey(input.back);

      // Kiểm trùng TRƯỚC khi insert. Bắt lỗi 23505 rồi mới truy vấn là sai:
      // statement lỗi làm ABORT cả transaction, nên query tiếp theo cũng lỗi
      // ("current transaction is aborted") và 409 biến thành 500.
      const dup = await cards.findDuplicate({
        normalizedFront: normalized, pos, backKey, langFrom, langTo,
      });
      if (dup && dup.id !== id) throw new DuplicateCard(dup.id, dup.deckName);

      try {
        const rows = await sql`
          insert into cards (id, user_id, deck_id, front, normalized_front, back, back_key,
                             reading, reading_type, pos, lang_from, lang_to, context_sentence,
                             source_url, source_title)
          values (${id}, ${userId}, ${deckId}, ${input.front}, ${normalized},
                  ${sql.json(input.back as never)}, ${backKey}, ${input.reading ?? null},
                  ${input.readingType ?? null}, ${pos},
                  ${langFrom}, ${langTo},
                  ${input.contextSentence ?? null}, ${input.sourceUrl ?? null},
                  ${input.sourceTitle ?? null})
          on conflict (id) do update set
            deck_id = excluded.deck_id, front = excluded.front, back = excluded.back,
            back_key = excluded.back_key, reading = excluded.reading,
            reading_type = excluded.reading_type, pos = excluded.pos
          returning *`;
        return toCard(rows[0]!);
      } catch (e) {
        // Vẫn giữ nhánh này cho tình huống đua: hai request cùng lúc vượt qua
        // bước kiểm trùng ở trên. KHÔNG truy vấn thêm ở đây — transaction đã abort.
        if ((e as { code?: string }).code === '23505') {
          throw new DuplicateCard(null, null);
        }
        throw e;
      }
    },
    async exists(cardId: string): Promise<boolean> {
      const rows = await sql`
        select 1 from cards
        where id = ${cardId} and user_id = ${userId} and deleted_at is null`;
      return rows.length > 0;
    },
    async addTag(cardId: string, tag: string): Promise<void> {
      await sql`
        update cards set tags = array_append(tags, ${tag})
        where id = ${cardId} and user_id = ${userId} and not (${tag} = any(tags))`;
    },
    async findDuplicate(key: DedupeKey) {
      // So đúng bộ khoá của index cards_dedupe: coalesce(pos,'') để NULL khớp NULL.
      const rows = await sql`
        select c.id, d.name as deck_name from cards c
        left join decks d on d.id = c.deck_id
        where c.user_id = ${userId} and c.normalized_front = ${key.normalizedFront}
          and coalesce(c.pos, '') = ${key.pos ?? ''}
          and c.back_key = ${key.backKey}
          and c.lang_from = ${key.langFrom} and c.lang_to = ${key.langTo}
          and c.deleted_at is null
        limit 1`;
      const r = rows[0];
      return r ? { id: r.id as string, deckName: (r.deck_name as string | null) ?? null } : null;
    },
  };

  const progress = {
    async get(cardId: string): Promise<CardProgress | null> {
      const rows = await sql`
        select * from card_states where card_id = ${cardId} and user_id = ${userId}`;
      return rows[0] ? toProgress(rows[0]) : null;
    },
    async save(p: CardProgress): Promise<void> {
      await sql`
        insert into card_states (card_id, user_id, state, due, stability, difficulty,
                                 reps, lapses, last_review, suspended)
        values (${p.cardId}, ${userId}, ${p.state}, ${p.due}, ${p.stability}, ${p.difficulty},
                ${p.reps}, ${p.lapses}, ${p.lastReview}, ${p.suspended})
        on conflict (card_id) do update set
          state = excluded.state, due = excluded.due, stability = excluded.stability,
          difficulty = excluded.difficulty, reps = excluded.reps, lapses = excluded.lapses,
          last_review = excluded.last_review, suspended = excluded.suspended`;
    },
    async initIfMissing(cardId: string): Promise<void> {
      await sql`
        insert into card_states (card_id, user_id, state)
        values (${cardId}, ${userId}, 'new') on conflict (card_id) do nothing`;
    },
  };

  const logs = {
    async append(cardId: string, log: ReviewLogInput): Promise<void> {
      await sql`
        insert into review_logs (id, user_id, card_id, rating, reviewed_at,
                                 scheduled_days, state_before)
        values (${crypto.randomUUID()}, ${userId}, ${cardId}, ${log.rating},
                ${log.reviewedAt}, ${log.scheduledDays}, ${log.stateBefore})`;
    },
  };

  return { cards, decks, progress, logs, settings };
}

const unitOfWork: UnitOfWork = {
  async transaction<T>(userId: string, fn: (repos: Repos) => Promise<T>): Promise<T> {
    return db().begin(async (tx) => {
      await scope(tx, userId);
      return fn(makeRepos(tx, userId));
    }) as Promise<T>;
  },
};

// -------------------------------------------------------------- read model

function makeQueries(userId: string): StudyQueries {
  /** Đọc cũng chạy trong transaction để `set_config` có hiệu lực cho RLS. */
  function read<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return db().begin(async (tx) => {
      await scope(tx, userId);
      return fn(tx);
    }) as Promise<T>;
  }

  /**
   * Cài đặt của user, ĐÃ MEMOIZE.
   *
   * `makeQueries()` được gọi một lần cho mỗi request (`db.queriesFor(user.id)`), nên
   * cache này có phạm vi một request — KHÔNG phải cache toàn cục, không có nguy cơ
   * đọc cài đặt cũ của request khác.
   *
   * Vì sao cần: trước đây `config()` bị gọi 3–4 lần trong MỘT request (buildQueue gọi,
   * dailyRoom gọi, deckSummaries gọi…), mỗi lần là một transaction riêng. Đã đo với DB
   * ở Seoul: một transaction = BEGIN + set_config + query + COMMIT = 4 round trip ×
   * 88ms = 352ms. Bốn lần gọi lặp = hơn 1 giây thuần phí mạng.
   */
  // `cached` chỉ được gán SAU khi đọc xong; `inflight` giữ lượt đọc đang bay để hai
  // lời gọi song song không thành hai query. KHÔNG được dùng chung một biến cho cả
  // hai: `configOnce ??= read(...)` gán promise trước khi thân hàm chạy, nên nếu
  // `configIn` cũng đọc biến đó thì nó trả về chính promise đang chờ nó → deadlock.
  // (Đã mắc đúng lỗi này: request treo cho tới khi timeout.)
  let cached: StudyConfig | null = null;
  let inflight: Promise<StudyConfig> | null = null;

  async function readSettings(tx: Sql): Promise<StudyConfig> {
    const rows = await tx`select settings from users where id = ${userId}`;
    return { ...DEFAULT_CONFIG, ...((rows[0]?.settings ?? {}) as Partial<StudyConfig>) };
  }

  function config(): Promise<StudyConfig> {
    if (cached) return Promise.resolve(cached);
    inflight ??= read(readSettings).then((c) => {
      cached = c;
      return c;
    });
    return inflight;
  }

  /**
   * Đọc cài đặt trong một transaction ĐANG MỞ — để gộp cùng các query khác.
   * Dùng chung bộ đệm với `config()`: một request thường mở nhiều transaction (mỗi
   * use case một cái) và trước đây transaction nào cũng đọc lại `users.settings`.
   * Đã đếm: `/decks` mở 3 transaction, đọc `settings` 2 lần.
   */
  async function configIn(tx: postgres.TransactionSql): Promise<StudyConfig> {
    if (cached) return cached;
    cached = await readSettings(tx);
    return cached;
  }

  /** Hạn mức trong ngày, trong một transaction ĐANG MỞ. */
  async function roomIn(tx: postgres.TransactionSql, cfg: StudyConfig, now: Date): Promise<DailyRoom> {
    const from = dayStart(now, cfg.dayStartHour);
    const rows = await tx`
      select
        count(distinct card_id) filter (where state_before = 'new') as new_cards,
        count(*) filter (where state_before is distinct from 'new') as reviews
      from review_logs where user_id = ${userId} and reviewed_at >= ${from}`;
    const newToday = Number(rows[0]?.new_cards ?? 0);
    const reviewsToday = Number(rows[0]?.reviews ?? 0);
    return {
      newToday, reviewsToday,
      newLeft: Math.max(0, cfg.maxNew - newToday),
      reviewLeft: Math.max(0, cfg.maxReview - reviewsToday),
    };
  }

  const queries: StudyQueries = {
    settings: config,

    async dailyRoom(now = new Date()): Promise<DailyRoom> {
      // Một transaction cho cả cài đặt và hạn mức, thay vì hai.
      return read(async (tx) => roomIn(tx, await configIn(tx), now));
    },

    async deckSummaries(now = new Date()): Promise<DeckSummary[]> {
      // Cài đặt đọc TRONG transaction này, không gọi `config()` ở ngoài — gọi ở ngoài
      // là mở thêm một transaction chỉ để đọc một dòng (4 round trip).
      const [cfg, deckRows, cardRows] = await read(async (tx) => Promise.all([
        configIn(tx),
        tx`
          select id, name, parent_id, sort_order, updated_at from decks
          where user_id = ${userId} and deleted_at is null order by sort_order, name`,
        tx`
          select c.id, c.deck_id, s.state, s.due, s.stability, s.reps, s.suspended
          from cards c left join card_states s on s.card_id = c.id
          where c.user_id = ${userId} and c.deleted_at is null`,
      ]));
      const endOfDay = dayEnd(now, cfg.dayStartHour);

      const blank = () => ({
        total: 0, due: 0, fresh: 0, suspended: 0,
        levels: [0, 0, 0, 0, 0] as [number, number, number, number, number],
      });
      const map = new Map<string | null, DeckSummary>(
        deckRows.map((d) => [d.id as string, { ...toDeck(d), ...blank() }]),
      );
      // NULL OBJECT: thẻ có deck_id lạ vẫn phải học được, gom vào một nhóm ảo.
      const orphan: DeckSummary = {
        id: '', name: 'Không có deck', parentId: null, sortOrder: 999,
        updatedAt: new Date(0).toISOString(), ...blank(),
      };

      for (const r of cardRows) {
        const row = map.get(r.deck_id ?? null) ?? orphan;
        row.total++;
        if (r.suspended) { row.suspended++; continue; }

        const p = r.state
          ? { state: r.state as CardState, reps: r.reps ?? 0, stability: r.stability ?? null }
          : null;
        const li = (memoryLevel(p, cfg.levelThresholds) - 1) as 0 | 1 | 2 | 3 | 4;
        row.levels[li] += 1;

        if (!r.state || r.state === 'new') row.fresh++;
        else if (isIntraday(r.state)) { if (r.due && new Date(r.due) <= now) row.due++; }
        else if (r.due && new Date(r.due) < endOfDay) row.due++;
      }

      const out = [...map.values()];
      if (orphan.total) out.push(orphan);
      return out;
    },

    async buildQueue(opts, now = new Date()): Promise<QueueResult> {
      // MỘT transaction cho tất cả. Trước đây là 4 transaction lồng nhau (config →
      // dailyRoom → config lần nữa → rows), mỗi cái 4 round trip. Đã đo với DB ở
      // Seoul (88ms/round trip): 4 transaction = 1.4s thuần phí mạng cho một lần
      // mở màn học. Gộp lại còn 1 BEGIN + 1 set_config + 3 query + 1 COMMIT.
      const { cfg, room, rows } = await read(async (tx) => {
        // Thẻ KHÔNG phụ thuộc cài đặt, nên gửi song song với cài đặt: postgres.js
        // pipeline hai truy vấn trên cùng kết nối thành một lượt gửi. Hạn mức phải
        // chờ cài đặt (cần `dayStartHour` để biết mốc đầu ngày) nên vẫn tuần tự.
        const [cfg, rows] = await Promise.all([
          configIn(tx),
          tx`
            select c.*, s.state, s.due, s.stability, s.difficulty, s.reps, s.lapses,
                   s.last_review, s.suspended, s.updated_at as s_updated
            from cards c left join card_states s on s.card_id = c.id
            where c.user_id = ${userId} and c.deleted_at is null
              and coalesce(s.suspended, false) = false
              ${opts.deckId ? tx`and c.deck_id = ${opts.deckId}` : tx``}`,
        ]);
        const room = await roomIn(tx, cfg, now);
        return { cfg, room, rows };
      });

      const endOfDay = dayEnd(now, cfg.dayStartHour);
      const due: QueueItem[] = [];
      const fresh: QueueItem[] = [];
      const learning: QueueItem[] = [];

      for (const r of rows) {
        const item: QueueItem = {
          card: toCard(r),
          progress: r.state
            ? toProgress({ ...r, card_id: r.id, updated_at: r.s_updated ?? r.updated_at })
            : null,
        };
        const st = item.progress;
        if (!st || st.state === 'new') fresh.push(item);
        else if (isIntraday(st.state)) learning.push(item);
        else if (st.due && new Date(st.due) < endOfDay) due.push(item);
      }

      const byDue = (a: QueueItem, b: QueueItem) =>
        new Date(a.progress?.due ?? 0).getTime() - new Date(b.progress?.due ?? 0).getTime();
      due.sort(byDue);
      learning.sort(byDue);
      fresh.sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt));

      const items = due.slice(0, room.reviewLeft);
      const newOnes = fresh.slice(0, room.newLeft);

      // Xen thẻ mới vào giữa thẻ ôn thay vì dồn cuối phiên.
      if (newOnes.length) {
        const step = Math.max(1, Math.floor((items.length + newOnes.length) / newOnes.length));
        let at = 0;
        for (const it of newOnes) {
          at = Math.min(items.length, at + step);
          items.splice(at, 0, it);
        }
      }

      // Nhiễu lấy từ MỌI thẻ đã đọc ở trên (cả deck), không chỉ thẻ vào hàng đợi.
      // `rows` đã có sẵn nên không phát sinh truy vấn nào.
      const glossPool: GlossOption[] = [];
      for (const r of rows) {
        const gloss = (r.back as string[] | null)?.[0];
        if (gloss) glossPool.push({ gloss, pos: (r.pos as string | null) ?? null });
      }

      return {
        items, learning,
        counts: { due: due.length, fresh: fresh.length, learning: learning.length },
        glossPool: glossPool.slice(0, 300),
        // Trả kèm để route không phải gọi dailyRoom() lần nữa (thêm 1 transaction).
        room, config: cfg,
      };
    },

    async recentCards(limit: number): Promise<RecentCard[]> {
      const rows = await read((tx) => tx`
        select c.*, d.name as deck_name from cards c
        left join decks d on d.id = c.deck_id
        where c.user_id = ${userId} and c.deleted_at is null
        order by c.created_at desc limit ${limit}`);
      return rows.map((r) => ({ ...toCard(r), deckName: (r.deck_name as string | null) ?? null }));
    },

    async cardsByFront(front: string, langFrom: string, langTo: string): Promise<ExistingCard[]> {
      const rows = await read((tx) => tx`
        select c.id, c.pos, c.back, c.back_key, c.created_at, d.name as deck_name
        from cards c left join decks d on d.id = c.deck_id
        where c.user_id = ${userId} and c.normalized_front = ${normalizeFront(front)}
          and c.lang_from = ${langFrom} and c.lang_to = ${langTo}
          and c.deleted_at is null
        order by c.created_at`);
      return rows.map((r) => ({
        id: r.id as string,
        pos: (r.pos as string | null) ?? null,
        back: Array.isArray(r.back) ? (r.back as string[]) : [],
        backKey: (r.back_key as string) ?? '',
        deckName: (r.deck_name as string | null) ?? null,
        createdAt: new Date(r.created_at).toISOString(),
      }));
    },

    async stats(now = new Date()): Promise<Stats> {
      // Mốc đầu ngày cần `dayStartHour`, nên cài đặt phải đọc trước hai truy vấn kia.
      // Vẫn nằm trong CÙNG transaction để không mất thêm BEGIN/set_config/COMMIT.
      const { cfg, counts, progressRows } = await read(async (tx) => {
        const cfg = await configIn(tx);
        const from = dayStart(now, cfg.dayStartHour);
        const [counts, progressRows] = await Promise.all([
          tx`
            select
              (select count(*) from cards where user_id = ${userId} and deleted_at is null) as cards,
              (select count(*) from review_logs where user_id = ${userId}) as logs,
              (select count(*) from review_logs
                where user_id = ${userId} and reviewed_at >= ${from}) as today`,
          tx`select * from card_states where user_id = ${userId}`,
        ]);
        return { cfg, counts, progressRows };
      });
      const from = dayStart(now, cfg.dayStartHour);
      const endOfDay = dayEnd(now, cfg.dayStartHour);

      const all = progressRows.map(toProgress);
      const live = all.filter((p) => !p.suspended);
      const c = counts[0]!;

      return {
        cards: Number(c.cards ?? 0),
        logs: Number(c.logs ?? 0),
        today: Number(c.today ?? 0),
        learning: live.filter((p) => isIntraday(p.state)).length,
        review: live.filter((p) => p.state === 'review').length,
        suspended: all.filter((p) => p.suspended).length,
        leeches: all.filter((p) => p.lapses >= cfg.leechThreshold).length,
        due: live.filter((p) => {
          if (p.state === 'new' || !p.due) return false;
          return isIntraday(p.state) ? new Date(p.due) <= now : new Date(p.due) < endOfDay;
        }).length,
        levels: levelCounts(all, cfg.levelThresholds),
      };
    },
  };

  return queries;
}

// --------------------------------------------------------------- danh tính

const identity: IdentityRepository = {
  async upsertOAuthUser({ provider, providerUid, email, name, avatarUrl }) {
    return db().begin(async (tx) => {
      const found = await tx`
        select u.* from oauth_accounts a
        join users u on u.id = a.user_id
        where a.provider = ${provider} and a.provider_uid = ${providerUid} limit 1`;
      if (found[0]) {
        const updated = await tx`
          update users set name = coalesce(${name}, name),
                           avatar_url = coalesce(${avatarUrl}, avatar_url)
          where id = ${found[0].id} returning *`;
        return toUser(updated[0] ?? found[0]);
      }

      // Cùng email nhưng chưa nối provider này -> nối vào user cũ, đừng tạo trùng.
      const byEmail = email ? await tx`select * from users where email = ${email} limit 1` : [];
      const user = byEmail[0] ?? (await tx`
        insert into users (email, name, avatar_url)
        values (${email}, ${name}, ${avatarUrl}) returning *`)[0];

      await tx`
        insert into oauth_accounts (provider, provider_uid, user_id, email)
        values (${provider}, ${providerUid}, ${user!.id}, ${email})
        on conflict (provider, provider_uid) do nothing`;
      return toUser(user!);
    }) as Promise<User>;
  },

  async getUser(userId) {
    const rows = await db()`select * from users where id = ${userId} and deleted_at is null`;
    return rows[0] ? toUser(rows[0]) : null;
  },

  async createSession({ userId, ttlMs, userAgent, kind }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMs);
    await db()`
      insert into sessions (token_hash, user_id, expires_at, user_agent, kind)
      values (${hashToken(token)}, ${userId}, ${expiresAt}, ${userAgent}, ${kind})`;
    return { token, userId, expiresAt };
  },

  /**
   * Xác thực token: MỘT round trip cho cả gia hạn last_seen và lấy user.
   *
   * Trước đây là hai lượt (update ... returning, rồi getUser) — với DB ở khác region
   * thì mỗi lượt là 88ms, và đây là đường đi của MỌI request có xác thực. CTE gộp lại
   * an toàn vì `users` chỉ được đọc sau khi `s` đã cho ra `user_id`: join phụ thuộc
   * dữ liệu nên thứ tự là xác định, không phải trông vào thứ tự đánh giá.
   */
  async resolveSession(token) {
    if (!token) return null;
    const rows = await db()`
      with s as (
        update sessions set last_seen = now()
        where token_hash = ${hashToken(token)} and expires_at > now()
        returning user_id
      )
      select u.* from users u join s on u.id = s.user_id
      where u.deleted_at is null`;
    return rows[0] ? toUser(rows[0]) : null;
  },

  async destroySession(token) {
    if (token) await db()`delete from sessions where token_hash = ${hashToken(token)}`;
  },

  async destroyAllSessions(userId) {
    await db()`delete from sessions where user_id = ${userId}`;
  },

  async saveOAuthState({ state, codeVerifier, nextPath, ttlMs }) {
    const sql = db();
    await sql`delete from oauth_states where expires_at < now()`;
    await sql`
      insert into oauth_states (state, code_verifier, next_path, expires_at)
      values (${state}, ${codeVerifier}, ${nextPath}, ${new Date(Date.now() + ttlMs)})`;
  },

  async takeOAuthState(state) {
    const rows = await db()`
      delete from oauth_states where state = ${state} and expires_at > now()
      returning code_verifier, next_path`;
    const r = rows[0];
    return r ? { codeVerifier: r.code_verifier as string, nextPath: (r.next_path as string) ?? '/' } : null;
  },

  async createPairingCode({ userId, ttlMs, label }) {
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + ttlMs);
    const sql = db();
    // Dọn mã hết hạn nhân tiện; bảng này nhỏ nên không cần cron.
    await sql`delete from pairing_codes where expires_at < now()`;
    // Một tài khoản chỉ giữ một mã đang chờ: tạo mã mới thì mã cũ hết tác dụng.
    await sql`delete from pairing_codes where user_id = ${userId}`;
    // Hash BẢN ĐÃ CHUẨN HOÁ (bỏ dấu gạch) — vì lúc đổi mã cũng chuẩn hoá trước khi hash.
    // Hash chuỗi có gạch ở đây là lỗi cũ: hai bên hash hai chuỗi khác nhau nên
    // mã đúng vẫn báo "không đúng hoặc đã hết hạn".
    await sql`
      insert into pairing_codes (code_hash, user_id, expires_at, label)
      values (${hashPairingCode(code)}, ${userId}, ${expiresAt}, ${label})`;
    // Trả về bản CÓ gạch cho người đọc; người dùng gõ kiểu nào cũng được.
    return { code, expiresAt };
  },

  async claimPairingCode(code) {
    const rows = await db()`
      delete from pairing_codes
      where code_hash = ${hashPairingCode(code)} and expires_at > now()
      returning user_id`;
    return (rows[0]?.user_id as string | undefined) ?? null;
  },
};

export const postgresDatabase: Database = {
  identity,
  uow: unitOfWork,
  queriesFor: makeQueries,
  async ping() {
    try {
      await db()`select 1`;
      return true;
    } catch {
      return false;
    }
  },
  async close() {
    await pool?.end({ timeout: 5 });
    pool = null;
  },
};
