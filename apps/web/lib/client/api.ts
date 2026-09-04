import type {
  AnswerResult, ApiError, DeckSummary, Me, Rating, ReadingType, Stats, StudyConfig, StudyQueue,
} from '@/lib/domain/types';
import type { ExistingCard } from '@/lib/ports/queries';

export interface NewCard {
  deckId?: string | null;
  front: string;
  back: string[];
  reading?: string | null;
  readingType?: ReadingType | null;
  pos?: string | null;
  langFrom?: string;
  langTo?: string;
  contextSentence?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

/**
 * Client gọi API. KHÔNG import gì từ lib/server - `import 'server-only'` bên đó sẽ
 * làm build fail nếu lỡ tay, nên ranh giới được cưỡng chế chứ không dựa vào kỷ luật.
 *
 * Cùng origin nên cookie httpOnly tự đi kèm, không cần đụng tới token.
 */

export class ApiFail extends Error {
  constructor(
    readonly code: ApiError['error'],
    message: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      credentials: 'same-origin',
    });
  } catch {
    // Bỏ offline-first (ADR-20) nghĩa là mất mạng phải nói thẳng, không giả vờ chạy được.
    throw new ApiFail('server_error', 'Mất kết nối mạng', 0);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body ?? {}) as Partial<ApiError>;
    throw new ApiFail(e.error ?? 'server_error', e.message ?? `Lỗi ${res.status}`, res.status, e.detail);
  }
  return body as T;
}

export const api = {
  me: () => call<Me>('/me'),
  saveConfig: (patch: Partial<StudyConfig>) =>
    call<{ config: StudyConfig }>('/me', { method: 'POST', body: JSON.stringify(patch) }),

  decks: () => call<{ decks: DeckSummary[] }>('/decks'),
  createDeck: (name: string) =>
    call<{ deck: { id: string; name: string }; existed: boolean }>('/decks', {
      method: 'POST', body: JSON.stringify({ name }),
    }),

  stats: () => call<Stats>('/stats'),

  createPairingCode: () =>
    call<{ code: string; expiresAt: string; ttlMinutes: number }>('/pair/create', {
      method: 'POST',
    }),

  existingCards: (front: string, langFrom: string, langTo = 'vi') =>
    call<{ cards: ExistingCard[] }>(
      `/cards/existing?front=${encodeURIComponent(front)}`
      + `&langFrom=${encodeURIComponent(langFrom)}&langTo=${encodeURIComponent(langTo)}`,
    ),

  createCard: (card: NewCard) =>
    call<{ id: string; deckId: string; deckName: string | null }>('/cards', {
      method: 'POST', body: JSON.stringify(card),
    }),

  queue: (deckId?: string | null) =>
    call<StudyQueue>(`/study/queue${deckId ? `?deck=${encodeURIComponent(deckId)}` : ''}`),

  answer: (cardId: string, rating: Rating) =>
    call<AnswerResult>('/study/answer', {
      method: 'POST',
      body: JSON.stringify({ cardId, rating, answeredAt: new Date().toISOString() }),
    }),
};
