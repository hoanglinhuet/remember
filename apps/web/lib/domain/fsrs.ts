import { createEmptyCard, fsrs, generatorParameters, State } from 'ts-fsrs';
import type { Card as FsrsCard, Grade } from 'ts-fsrs';
import type { CardProgress, CardState, Rating, StudyConfig } from './types';

/**
 * Bọc ts-fsrs. Thuần, không I/O — chạy được ở cả route handler (Node) và browser.
 *
 * Server là nơi tính thật khi chấm điểm (ADR-26). Client dùng cùng module này chỉ để
 * hiện khoảng lặp dự kiến trên 4 nút, nên hai bên không thể lệch công thức.
 *
 * learning_steps / relearning_steps mặc định của ts-fsrs là ["1m","10m"] / ["10m"] —
 * trùng mặc định Anki, nên không đặt lại.
 */

const engines = new Map<number, ReturnType<typeof fsrs>>();

function engineFor(retention: number) {
  let e = engines.get(retention);
  if (!e) {
    e = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true }));
    engines.set(retention, e);
  }
  return e;
}

const STATE_NAME: Record<number, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const NAME_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export const RATINGS: { key: Rating; label: string; hint: string; tone: string }[] = [
  { key: 1, label: 'Lại', hint: 'không nhớ', tone: 'again' },
  { key: 2, label: 'Khó', hint: 'nhớ chật vật', tone: 'hard' },
  { key: 3, label: 'Được', hint: 'nhớ được', tone: 'good' },
  { key: 4, label: 'Dễ', hint: 'nhớ ngay', tone: 'easy' },
];

export function isIntraday(state: CardState): boolean {
  return state === 'learning' || state === 'relearning';
}

function toFsrsCard(p: CardProgress | null, now: Date): FsrsCard {
  if (!p) return createEmptyCard(now);
  return {
    due: p.due ? new Date(p.due) : now,
    stability: p.stability ?? 0,
    difficulty: p.difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: p.reps,
    lapses: p.lapses,
    state: NAME_STATE[p.state],
    last_review: p.lastReview ? new Date(p.lastReview) : undefined,
    learning_steps: 0,
  } as FsrsCard;
}

function toProgress(cardId: string, c: FsrsCard, suspended: boolean): CardProgress {
  return {
    cardId,
    state: STATE_NAME[c.state] ?? 'new',
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ? new Date(c.last_review).toISOString() : null,
    suspended,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyProgress(cardId: string, now: Date = new Date()): CardProgress {
  return toProgress(cardId, createEmptyCard(now), false);
}

/**
 * Chấm điểm một thẻ. Trả cả tiến độ mới và bản ghi log để caller ghi trong CÙNG transaction —
 * log là nguồn của thống kê và FSRS optimizer, không được lệch với tiến độ.
 */
export function grade(
  cardId: string,
  current: CardProgress | null,
  rating: Rating,
  config: StudyConfig,
  now: Date = new Date(),
): {
  progress: CardProgress;
  log: { rating: Rating; reviewedAt: string; scheduledDays: number; elapsedDays: number; stateBefore: CardState };
  leech: boolean;
  suspended: boolean;
} {
  const engine = engineFor(config.retention);
  // Rating 1..4 của mình khớp đúng enum Grade của ts-fsrs (Again..Easy).
  const { card, log } = engine.next(toFsrsCard(current, now), now, rating as Grade);

  // Leech: quá ngưỡng lapses thì gắn tag, treo thẻ nếu người dùng chọn (FR-C4).
  const leech = card.lapses >= config.leechThreshold && rating === 1;
  const suspended = leech && config.leechAction === 'suspend';

  return {
    progress: toProgress(cardId, card, suspended),
    log: {
      rating,
      reviewedAt: now.toISOString(),
      scheduledDays: log.scheduled_days,
      elapsedDays: log.elapsed_days,
      stateBefore: current?.state ?? 'new',
    },
    leech,
    suspended,
  };
}

/** Khoảng lặp dự kiến cho từng mức, hiện trên nút (FR-C1). Chạy ở client. */
export function previewIntervals(
  current: CardProgress | null,
  retention: number,
  now: Date = new Date(),
): Record<Rating, Date> {
  const preview = engineFor(retention).repeat(toFsrsCard(current, now), now);
  const out = {} as Record<Rating, Date>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const item = preview[r as Grade];
    if (item) out[r] = item.card.due;
  }
  return out;
}

/**
 * Dựng lại tiến độ bằng cách phát lại toàn bộ log của thẻ — dùng cho Undo.
 * Chậm hơn lưu snapshot nhưng không thể lệch với log. Fuzz của ts-fsrs seed theo
 * trạng thái thẻ nên phát lại cho ra đúng cùng kết quả (đã đo: lệch 0 phút).
 */
export function replay(
  cardId: string,
  logs: { rating: Rating; reviewedAt: string }[],
  config: StudyConfig,
): CardProgress {
  if (!logs.length) return emptyProgress(cardId);
  const engine = engineFor(config.retention);
  const first = logs[0]!;
  let card = createEmptyCard(new Date(first.reviewedAt));
  for (const l of logs) {
    card = engine.next(card, new Date(l.reviewedAt), l.rating as Grade).card;
  }
  return toProgress(cardId, card, false);
}
