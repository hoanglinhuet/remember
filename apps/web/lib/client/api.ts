import type {
  AnswerResult, ApiError, Card, Deck, DeckSummary, Me, Rating, ReadingType, Stats, StudyConfig,
  StudyQueue,
} from '@/lib/domain/types';
import type { DeckCardsPage, ExistingCard } from '@/lib/ports/queries';
import type { CardPatch } from '@/lib/ports/repositories';

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
  note?: string | null;
}

/** Thẻ trong deck bị xoá đi đâu — xem `deleteDeck()` ở tầng use case. */
export type DeckDeleteMode = 'move' | 'delete';

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
  renameDeck: (deckId: string, name: string) =>
    call<{ deck: Deck }>(`/decks/${encodeURIComponent(deckId)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),
  deleteDeck: (deckId: string, cards: DeckDeleteMode = 'move') =>
    call<{ cards: number; movedTo: Deck | null }>(
      `/decks/${encodeURIComponent(deckId)}?cards=${cards}`,
      { method: 'DELETE' },
    ),

  deckCards: (deckId: string, opts: { q?: string; limit?: number; offset?: number } = {}) => {
    const sp = new URLSearchParams();
    if (opts.q) sp.set('q', opts.q);
    sp.set('limit', String(opts.limit ?? 50));
    sp.set('offset', String(opts.offset ?? 0));
    return call<DeckCardsPage>(
      `/decks/${encodeURIComponent(deckId || 'none')}/cards?${sp.toString()}`,
    );
  },

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
  updateCard: (cardId: string, patch: CardPatch) =>
    call<{ card: Card }>(`/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteCard: (cardId: string) =>
    call<{ deleted: true }>(`/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' }),

  queue: (deckId?: string | null) =>
    call<StudyQueue>(`/study/queue${deckId ? `?deck=${encodeURIComponent(deckId)}` : ''}`),

  answer: (cardId: string, rating: Rating) =>
    call<AnswerResult>('/study/answer', {
      method: 'POST',
      body: JSON.stringify({ cardId, rating, answeredAt: new Date().toISOString() }),
    }),
};
