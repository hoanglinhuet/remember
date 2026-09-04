'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import { RATINGS, previewIntervals } from '@/lib/domain/fsrs';
import { humanInterval } from '@/lib/domain/day';
import { levelInfo, memoryLevel, stabilityText } from '@/lib/domain/memory';
import {
  checkAnswer, clozeParts, distractors, modeInfo, pickMode, shuffle,
  type AnswerCheck,
} from '@/lib/domain/modes';
import type { GlossOption, QueueItem, Rating, StudyConfig, StudyMode } from '@/lib/domain/types';
import { speak } from '@/lib/client/speech';

/**
 * Phiên ôn kiểu Anki: hàng đợi ĐỘNG. Thẻ trả lời "Lại" quay lại trong cùng phiên khi hết
 * bậc thang relearning — đó là toàn bộ mục đích của relearning steps.
 *
 * Bỏ offline-first (ADR-20) nghĩa là ghi thất bại = lượt chấm KHÔNG xảy ra:
 * hiện lỗi và CHẶN chấm tiếp cho tới khi thử lại thành công.
 *
 * SÁU MODE: mỗi thẻ rút ngẫu nhiên một mode trong (đã bật ∩ dùng được với thẻ đó).
 * Mode chỉ đổi CÁCH HỎI. Rating gửi cho FSRS vẫn do người dùng bấm — gõ đúng không
 * có nghĩa là "dễ", và máy không có cách nào biết được điều đó.
 */

interface Pending {
  id: string;
  due: number;
}

const TYPING: StudyMode[] = ['typeVi', 'dictation', 'typeEn', 'cloze'];

export default function StudySession({ deckId }: { deckId: string | null }) {
  const router = useRouter();
  const main = useRef<QueueItem[]>([]);
  const learning = useRef<Pending[]>([]);
  const byId = useRef(new Map<string, QueueItem>());
  /** Nghĩa của cả deck, để dựng đáp án nhiễu — hàng đợi hôm nay thường quá ít. */
  const glossPool = useRef<GlossOption[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [config, setConfig] = useState<StudyConfig | null>(null);
  const [item, setItem] = useState<QueueItem | null>(null);
  const [mode, setMode] = useState<StudyMode>('recognition');
  const [revealed, setRevealed] = useState(false);
  const [input, setInput] = useState('');
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [wait, setWait] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [left, setLeft] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const typing = TYPING.includes(mode);

  /** Dựng câu hỏi cho một thẻ: rút mode, và với trắc nghiệm thì trộn đáp án. */
  const setUp = useCallback((next: QueueItem, cfg: StudyConfig | null) => {
    const nearby = distractors(next.card, glossPool.current);
    const picked = pickMode(cfg?.modes ?? ['recognition'], next.card, nearby.length);
    setMode(picked);
    setOptions(picked === 'choice' ? shuffle([next.card.back[0] ?? '', ...nearby]) : []);
    setInput('');
    setCheck(null);
    setChosen(null);
    setRevealed(false);
    setItem(next);
  }, []);

  const advance = useCallback(() => {
    const now = Date.now();
    learning.current.sort((a, b) => a.due - b.due);
    setLeft(main.current.length + learning.current.length);

    const show = (i: QueueItem | null) => {
      setWait(null);
      if (i) setUp(i, config);
      else setItem(null);
    };

    const first = learning.current[0];
    if (first && first.due <= now) {
      learning.current.shift();
      show(byId.current.get(first.id) ?? null);
      return;
    }
    const next = main.current.shift();
    if (next) {
      show(next);
      return;
    }
    if (first) {
      const ms = first.due - now;
      const ahead = (config?.learnAheadMin ?? 20) * 60_000;
      if (ms <= ahead) {
        learning.current.shift();
        show(byId.current.get(first.id) ?? null);
        return;
      }
      setItem(null);
      setWait(ms);
      return;
    }
    setItem(null);
    setWait(null);
  }, [config, setUp]);

  useEffect(() => {
    let alive = true;
    api
      .queue(deckId)
      .then((q) => {
        if (!alive) return;
        main.current = q.items;
        learning.current = q.learning.map((i) => ({
          id: i.card.id,
          due: new Date(i.progress?.due ?? 0).getTime(),
        }));
        for (const i of [...q.items, ...q.learning]) byId.current.set(i.card.id, i);
        glossPool.current = q.glossPool ?? [];
        setConfig(q.config);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof ApiFail ? e.message : 'Không tải được hàng đợi');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [deckId]);

  useEffect(() => {
    if (!loading && config) advance();
  }, [loading, config, advance]);

  useEffect(() => {
    if (wait == null) return;
    const tick = setInterval(() => setWait((w) => (w == null ? null : w - 1000)), 1000);
    const go = setTimeout(advance, Math.max(0, wait) + 200);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [wait, advance]);

  // Nghe-rồi-gõ: phát ngay khi thẻ hiện ra, vì từ đang bị ẩn thì không có gì để bấm.
  useEffect(() => {
    if (item && mode === 'dictation' && !revealed) {
      speak(item.card.front, item.card.langFrom);
    }
  }, [item, mode, revealed]);

  // Ô nhập tự focus để gõ được ngay, không phải chạm thêm một lần trên điện thoại.
  useEffect(() => {
    if (item && typing && !revealed) inputRef.current?.focus();
  }, [item, typing, revealed]);

  const intervals = useMemo(() => {
    if (!item || !revealed || !config) return null;
    return previewIntervals(item.progress, config.retention);
  }, [item, revealed, config]);

  /** Đáp án hợp lệ của mode hiện tại. */
  const accepted = useMemo(() => {
    if (!item) return [];
    return mode === 'typeVi' ? item.card.back : [item.card.front];
  }, [item, mode]);

  const submit = useCallback(() => {
    if (!item || revealed || !input.trim()) return;
    setCheck(checkAnswer(input, accepted));
    setRevealed(true);
    // Bỏ focus để phím 1–4 chấm điểm được, không gõ tiếp vào ô nhập.
    inputRef.current?.blur();
  }, [item, revealed, input, accepted]);

  const choose = useCallback((gloss: string) => {
    if (!item || revealed) return;
    setChosen(gloss);
    setCheck(checkAnswer(gloss, item.card.back));
    setRevealed(true);
  }, [item, revealed]);

  const answer = useCallback(
    async (rating: Rating) => {
      if (!item || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.answer(item.card.id, rating);

        if (res.suspended) setFlash(`🪤 "${item.card.front}" bị treo (${res.progress.lapses} lần quên)`);
        else if (res.leech) setFlash(`🪤 "${item.card.front}" gắn tag leech (${res.progress.lapses} lần quên)`);
        else if (res.backInMs != null && res.progress.due) {
          setFlash(`↻ quay lại sau ${humanInterval(res.progress.due)}`);
        } else setFlash(null);

        // Cập nhật tiến độ trong bộ nhớ để lần gặp lại hiện đúng bậc và khoảng lặp.
        const cached = byId.current.get(item.card.id);
        if (cached) byId.current.set(item.card.id, { ...cached, progress: res.progress });

        if (res.backInMs != null && res.progress.due) {
          learning.current.push({ id: item.card.id, due: new Date(res.progress.due).getTime() });
        }
        setDone((n) => n + 1);
        advance();
      } catch (e: unknown) {
        // Server-authoritative: ghi hỏng nghĩa là lượt chấm không xảy ra.
        setError(e instanceof ApiFail ? e.message : 'Không lưu được');
      } finally {
        setBusy(false);
      }
    },
    [item, busy, advance],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        router.push('/');
        return;
      }
      if (!item) return;

      // Đang gõ trong ô nhập: chỉ Enter có nghĩa, mọi phím khác để cho ô nhập.
      const inField = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (inField) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
        return;
      }

      if (!revealed && !typing && mode !== 'choice' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && e.key >= '1' && e.key <= '4') {
        const r = RATINGS[Number(e.key) - 1];
        if (r) void answer(r.key);
      }
      if (e.key.toLowerCase() === 'r') speak(item.card.front, item.card.langFrom);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, revealed, typing, mode, answer, submit, router]);

  const goHome = () => router.push('/');

  if (loading) return <p className="muted">Đang tải hàng đợi…</p>;

  if (error && !item) {
    return (
      <div className="done stack">
        <div className="big">⚠️</div>
        <h2 style={{ margin: 0 }}>{error}</h2>
        <button className="btn" onClick={() => window.location.reload()}>Thử lại</button>
        <button className="btn primary" onClick={goHome}>Về trang chính</button>
      </div>
    );
  }

  if (wait != null) {
    const secs = Math.max(0, Math.ceil(wait / 1000));
    return (
      <div className="done stack">
        <div className="big">⏳</div>
        <h2 style={{ margin: 0 }}>
          Thẻ tiếp theo sau {secs > 60 ? `${Math.ceil(secs / 60)} phút` : `${secs}s`}
        </h2>
        <p className="muted">
          Còn {learning.current.length} thẻ đang trong bậc thang học lại. Anki cũng chờ như vậy —
          khoảng nghỉ ngắn là một phần của cơ chế.
        </p>
        <button className="btn primary" onClick={goHome}>Tạm nghỉ</button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="done stack">
        <div className="big">{done ? '🎉' : '😴'}</div>
        <h2 style={{ margin: 0 }}>{done ? `Xong ${done} lượt ôn` : 'Không có thẻ đến hạn'}</h2>
        <p className="muted">
          {done
            ? 'FSRS sẽ nhắc đúng lúc trước khi bạn quên.'
            : 'Hết hạn mức hôm nay, hoặc chưa có thẻ nào tới hạn.'}
        </p>
        <button className="btn primary" onClick={goHome}>Về trang chính</button>
      </div>
    );
  }

  const { card, progress } = item;
  const level = memoryLevel(progress, config?.levelThresholds);
  const total = done + left + 1;
  const info = modeInfo(mode);
  const cloze = mode === 'cloze' ? clozeParts(card.contextSentence, card.front) : null;
  // Mode nào hỏi bằng nghĩa/âm thì phải ẩn từ, không thì không còn gì để đoán.
  const hideFront = !revealed && (mode === 'dictation' || mode === 'typeEn' || mode === 'cloze');

  return (
    <div className="study">
      <div className="row">
        <button className="icon ghost" onClick={goHome} aria-label="Thoát">✕</button>
        <span className="muted">
          còn {left + 1}
          {learning.current.length ? ` · ${learning.current.length} học lại` : ''}
        </span>
        <span className="spacer" />
        {/* Nút đọc phải ẩn khi từ đang bị ẩn: bấm là nghe ra đáp án ngay. */}
        {!hideFront && (
          <button className="icon ghost" onClick={() => speak(card.front, card.langFrom)} aria-label="Đọc">
            🔊
          </button>
        )}
      </div>

      <div className="progress">
        <i style={{ width: `${(done / total) * 100}%` }} />
      </div>

      {error && <p className="err">✕ {error} — bấm lại nút vừa chọn để thử lại</p>}
      {!error && flash && <p className="flash">{flash}</p>}

      <div
        className="face"
        data-mode={mode}
        onClick={() => !revealed && !typing && mode !== 'choice' && setRevealed(true)}
      >
        <span className="mode-badge">{info.task}</span>

        {/* ------------------------------------------------------------ câu hỏi */}

        {mode === 'dictation' && !revealed && (
          <div className="listen">
            <button
              className="listen-btn"
              onClick={(e) => { e.stopPropagation(); speak(card.front, card.langFrom); }}
              aria-label="Phát lại"
            >
              🔊
            </button>
            <button
              className="btn ghost"
              onClick={(e) => { e.stopPropagation(); speak(card.front, card.langFrom, 0.5); }}
            >
              🐢 phát chậm
            </button>
          </div>
        )}

        {mode === 'typeEn' && !revealed && (
          <div className="ask-back">
            <ul>
              {card.back.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {card.pos && <span className="pos">{card.pos}</span>}
          </div>
        )}

        {cloze && !revealed && (
          <p className="ctx cloze">
            {cloze.before}
            <span className="blank">{input.trim() || '＿'.repeat(Math.min(6, card.front.length))}</span>
            {cloze.after}
          </p>
        )}

        {!hideFront && <div className="term">{card.front}</div>}
        {/* IPA cũng phải ẩn ở mode nghe: nhìn phiên âm là gõ ra được từ. */}
        {!hideFront && card.reading && (
          <div className="ipa">{card.readingType === 'ipa' ? `/${card.reading}/` : card.reading}</div>
        )}

        {typing && !revealed && (
          <form
            className="answer"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'typeVi' ? 'gõ nghĩa tiếng Việt…' : 'gõ từ tiếng Anh…'}
              // Tắt sửa chính tả: iOS tự sửa thì không bao giờ gõ sai được, bài tập vô nghĩa.
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
            />
            <button className="btn primary" type="submit" disabled={!input.trim()}>
              Kiểm tra
            </button>
          </form>
        )}

        {mode === 'choice' && !revealed && (
          <div className="choices" onClick={(e) => e.stopPropagation()}>
            {options.map((o, i) => (
              <button key={i} onClick={() => choose(o)}>{o}</button>
            ))}
          </div>
        )}

        {/* ------------------------------------------------------------ đáp án */}

        {revealed ? (
          <>
            {check && (
              <p className="check" data-kind={check.kind}>
                {check.kind === 'exact' && '✓ đúng'}
                {check.kind === 'near' && `≈ gần đúng — bạn gõ “${chosen ?? input}”, đúng là “${check.best}”`}
                {check.kind === 'wrong' &&
                  ((chosen ?? input).trim()
                    ? `✕ bạn ${chosen ? 'chọn' : 'gõ'} “${chosen ?? input}”`
                    : '✕ chưa trả lời')}
              </p>
            )}

            {card.pos && <span className="pos">{card.pos}</span>}
            {/* Bậc độ nhớ chỉ hiện SAU khi mở đáp án: thấy trước sẽ tự chấm điểm lệch đi. */}
            <span className="lvl" data-level={level}>
              <span className="lvl-bars" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} data-on={i <= level ? '1' : ''} />
                ))}
              </span>
              <span className="lvl-text">
                {levelInfo(level).name}
                {level > 1 && stabilityText(progress) && <small> · {stabilityText(progress)}</small>}
              </span>
            </span>
            {progress && progress.lapses >= (config?.leechThreshold ?? 8) && (
              <span className="leech">🪤 leech · đã quên {progress.lapses} lần</span>
            )}
            <div className="hr" />
            <div className="back">
              {card.back.length ? (
                <ul>
                  {card.back.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : (
                <span className="muted">(mặt sau trống)</span>
              )}
            </div>
            {card.contextSentence && <Ctx sentence={card.contextSentence} term={card.front} />}
          </>
        ) : (
          mode === 'recognition' && <span className="tap-hint">chạm để xem nghĩa</span>
        )}
      </div>

      {revealed ? (
        <div className="grades">
          {RATINGS.map((r) => {
            const due = intervals?.[r.key];
            return (
              <button key={r.key} data-tone={r.tone} disabled={busy} onClick={() => void answer(r.key)}>
                {r.label}
                <small>{due ? humanInterval(due) : r.hint}</small>
              </button>
            );
          })}
        </div>
      ) : mode === 'recognition' ? (
        <button className="btn primary" style={{ minHeight: 62 }} onClick={() => setRevealed(true)}>
          Xem nghĩa
        </button>
      ) : null}

      {revealed && check && (
        <p className="muted" style={{ textAlign: 'center', fontSize: 11.5 }}>
          Gõ đúng vẫn phải tự chấm: chỉ bạn biết vừa rồi là nhớ ngay hay phải nghĩ mãi.
        </p>
      )}
    </div>
  );
}

function Ctx({ sentence, term }: { sentence: string; term: string }) {
  const at = sentence.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return <p className="ctx">{sentence}</p>;
  return (
    <p className="ctx">
      {sentence.slice(0, at)}
      <mark>{sentence.slice(at, at + term.length)}</mark>
      {sentence.slice(at + term.length)}
    </p>
  );
}
