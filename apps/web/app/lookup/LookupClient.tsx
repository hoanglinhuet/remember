'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import { lookup, POS_LABEL, type LookupResult, type SenseGroup } from '@/lib/client/lookup';
import { speak } from '@/lib/client/speech';
import { IconSpeaker } from '../_components/Icons';
import { senseKey } from '@/lib/domain/day';
import type { ExistingCard } from '@/lib/ports/queries';

const LIST_VISIBLE = 3;
const SENSES_VISIBLE = 3;

function Group({
  group,
  picked,
  toggle,
  isSaved,
}: {
  group: SenseGroup;
  picked: Set<string>;
  toggle: (gloss: string, pos: string | null) => void;
  isSaved: (gloss: string, pos: string | null) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const senses = group.senses;
  const shown = open ? senses : senses.slice(0, SENSES_VISIBLE);
  const hiddenSenses = senses.length - shown.length;
  const hiddenItems = shown.reduce(
    (n, s) => n + Math.max(0, (s.reverse?.length ?? 0) - LIST_VISIBLE),
    0,
  );
  const hidden = hiddenSenses + hiddenItems;

  const vi = group.pos ? POS_LABEL[group.pos] : undefined;
  const raw = group.posRaw ?? group.pos;

  return (
    <div className="lgroup">
      <div className="pos-row">
        {group.isPrimary && <span className="pos" data-pos="primary">bản dịch chính</span>}
        {group.pos && (
          <span className="pos" data-pos={group.pos}>
            {vi ?? raw}
            {/* Giữ loại từ gốc bên cạnh: đối chiếu được với từ điển khác, và khi
                POS_LABEL chưa có nhãn tiếng Việt thì vẫn không mất thông tin. */}
            {vi && raw && raw.toLowerCase() !== vi.toLowerCase() && <small> {raw}</small>}
          </span>
        )}
        {(hidden > 0 || open) && (
          <button className="more" onClick={() => setOpen(!open)}>
            {open ? 'thu gọn' : `xem thêm ${hidden}`}
          </button>
        )}
      </div>

      {group.definition?.gloss && (
        <p className="def">
          {group.definition.gloss}
          {group.definition.example && <i> — “{group.definition.example}”</i>}
        </p>
      )}

      <ul className="lsenses">
        {shown.map((s, i) => (
          <li
            key={i}
            className="lsense"
            aria-selected={picked.has(s.gloss)}
            data-saved={isSaved(s.gloss, group.pos) ? '1' : undefined}
            onClick={() => toggle(s.gloss, group.pos)}
          >
            <span className="lgloss">{s.gloss}</span>
            {isSaved(s.gloss, group.pos) && <span className="saved-mark">✓ đã lưu</span>}
            {s.example && <span className="lex">“{s.example}”</span>}
            {s.reverse && s.reverse.length > 0 && (
              <span className="lrev" title="Các từ gốc cũng dịch thành nghĩa này — dùng để kiểm chứng đúng sắc thái">
                <b>dịch ngược: </b>
                {(open ? s.reverse : s.reverse.slice(0, LIST_VISIBLE)).join(', ')}
              </span>
            )}
            {s.synonyms && s.synonyms.length > 0 && (
              <span className="lrev">
                <b>đồng nghĩa: </b>
                {(open ? s.synonyms : s.synonyms.slice(0, LIST_VISIBLE)).join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LookupClient({ decks }: { decks: { id: string; name: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedPos, setPickedPos] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string>(decks[0]?.id ?? '');
  const [existing, setExisting] = useState<ExistingCard[]>([]);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    setRes(null);
    setPicked(new Set());
    setPickedPos(null);

    // Lấy thẻ đã có SONG SONG với tra từ — biết "đã lưu" càng sớm càng tốt.
    setExisting([]);
    void api
      .existingCards(text, 'auto')
      .then((e) => setExisting(e.cards))
      .catch(() => {});

    const r = await lookup(text);
    setBusy(false);
    if (r.ok) {
      setRes(r.result);
      // Chọn sẵn nghĩa đầu -> lưu thẻ một lần bấm.
      const g = r.result.groups.find((x) => x.senses.length);
      const first = g?.senses[0];
      if (g && first) {
        setPicked(new Set([first.gloss]));
        setPickedPos(g.pos);
      }
    } else {
      setErr(r.attempts.map((a) => `${a.id}: ${a.reason}`).join(' · ') || 'không tra được');
    }
  };

  /** Nghĩa này đã nằm trong một thẻ cùng loại từ chưa? */
  const isSaved = (gloss: string, pos: string | null) => {
    const g = senseKey([gloss]);
    return existing.some(
      (c) => (c.pos ?? '') === (pos ?? '') && senseKey(c.back).split('|').includes(g),
    );
  };

  /** Đúng bộ nghĩa đang chọn đã có thẻ chưa? (khớp khoá dedupe của server) */
  const savedExactly = picked.size
    ? existing.find(
        (c) => (c.pos ?? '') === (pickedPos ?? '') && c.backKey === senseKey([...picked]),
      ) ?? null
    : null;

  const toggle = (gloss: string, pos: string | null) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(gloss)) next.delete(gloss);
      else {
        next.add(gloss);
        setPickedPos(pos);
      }
      return next;
    });
  };

  const save = async () => {
    const front = q.trim();
    if (!front || !res) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.createCard({
        deckId: deckId || null,
        front,
        back: picked.size ? [...picked] : [res.primary],
        reading: res.reading,
        readingType: res.readingType,
        pos: pickedPos,
        langFrom: res.detectedLang ?? 'auto',
        langTo: 'vi',
        sourceTitle: 'Tra trên web app',
      });
      setMsg(`đã lưu vào "${r.deckName ?? 'deck đầu tiên'}"`);
      // Ghi nhận ngay để nút đổi thành "đã lưu" mà không cần gọi lại API.
      setExisting((prev) => [
        ...prev,
        {
          id: r.id, pos: pickedPos, back: [...picked],
          backKey: senseKey([...picked]), deckName: r.deckName,
          createdAt: new Date().toISOString(),
        },
      ]);
      router.refresh(); // số liệu ở trang chính tính ở server, cần làm mới
    } catch (e: unknown) {
      if (e instanceof ApiFail && e.code === 'duplicate') {
        const deck = (e.detail?.deckName as string | undefined) ?? null;
        setMsg(`thẻ đã có sẵn${deck ? ` trong "${deck}"` : ''}`);
      } else {
        setErr(e instanceof ApiFail ? e.message : 'Không lưu được');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="stack" onSubmit={run}>
        <div className="row">
          <input
            className="lq"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nhập từ hoặc cụm từ…"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
          <button className="btn primary" type="submit" disabled={busy || !q.trim()}>
            {busy ? '…' : 'Tra'}
          </button>
        </div>
      </form>

      {err && <p className="err">✕ {err}</p>}

      {res && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="lhead">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="term" style={{ fontSize: 24 }}>{q.trim()}</div>
              {res.reading && (
                <div className="ipa" title={res.readingType === 'ipa' ? 'Phiên âm IPA' : 'Chuyển tự'}>
                  {res.readingType === 'ipa' ? `/${res.reading}/` : res.reading}
                </div>
              )}
              {existing.length > 0 && (
                <span
                  className="saved-chip"
                  title={existing
                    .map((c) => `${c.pos ?? '—'}: ${c.back.join(', ')}${c.deckName ? ` @${c.deckName}` : ''}`)
                    .join('\n')}
                >
                  {existing.length === 1 ? '✓ đã lưu' : `✓ đã lưu ${existing.length} thẻ`}
                </span>
              )}
            </div>
            <button className="speakbtn" onClick={() => speak(q.trim(), res.detectedLang)} aria-label="Đọc">
              <IconSpeaker size={20} />
            </button>
          </div>

          {res.groups.map((g, i) => (
            <Group key={i} group={g} picked={picked} toggle={toggle} isSaved={isSaved} />
          ))}

          <div className="row">
            <button
              className="btn primary"
              onClick={() => void save()}
              disabled={saving || !picked.size || Boolean(savedExactly)}
              title={savedExactly
                ? `Đã có thẻ này${savedExactly.deckName ? ` trong "${savedExactly.deckName}"` : ''}`
                : undefined}
            >
              {saving ? '…' : savedExactly ? '✓ đã lưu' : '＋ Lưu thẻ'}
            </button>
            <select
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {msg && <p className="muted">✓ {msg}</p>}
          <p className="muted" style={{ textAlign: 'right' }}>
            {res.detectedLang ? `${res.detectedLang} → vi · ` : ''}
            {res.providerId}
            {res.fromCache ? ' · cache' : ''}
            {res.license ? ` · ${res.license}` : ''}
          </p>
        </div>
      )}
    </>
  );
}
