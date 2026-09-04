'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import { MODES } from '@/lib/domain/modes';
import { DEFAULT_CONFIG, type StudyConfig, type StudyMode } from '@/lib/domain/types';

/**
 * Cài đặt học. Server validate lại toàn bộ (POST /api/v1/me) — client có thể gửi bất cứ gì,
 * nên khoảng giá trị ở đây chỉ là tiện dụng, không phải bảo vệ.
 */
const FIELDS: {
  key: keyof Pick<StudyConfig, 'maxNew' | 'maxReview' | 'learnAheadMin' | 'leechThreshold' | 'dayStartHour'>;
  label: string;
  min: number;
  max: number;
  step: number;
  note?: string;
}[] = [
  { key: 'maxNew', label: 'Thẻ mới mỗi ngày', min: 0, max: 9999, step: 5 },
  { key: 'maxReview', label: 'Thẻ ôn mỗi ngày', min: 0, max: 9999, step: 10 },
  {
    key: 'learnAheadMin', label: 'Học sớm (phút)', min: 0, max: 120, step: 5,
    note: 'Hàng chính hết thì học sớm thẻ đang trong bậc thang nếu hạn nằm trong khoảng này.',
  },
  { key: 'leechThreshold', label: 'Ngưỡng leech (lần quên)', min: 2, max: 30, step: 1 },
  {
    key: 'dayStartHour', label: 'Ngày mới bắt đầu lúc (giờ)', min: 0, max: 23, step: 1,
    note: 'Thẻ đến hạn trong "hôm nay" học được từ đầu ngày, không phải chờ đúng giờ.',
  },
];

export default function SettingsForm({ initial }: { initial: StudyConfig }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<StudyConfig>(initial);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = async (patch: Partial<StudyConfig>) => {
    const prev = cfg;
    setCfg({ ...cfg, ...patch });   // optimistic: ô số không được giật khi gõ
    setErr(null);
    try {
      const r = await api.saveConfig(patch);
      setCfg(r.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      router.refresh();             // hạn mức ở trang chính tính ở server
    } catch (e: unknown) {
      setCfg(prev);                 // hỏng thì trả về giá trị cũ, đừng để UI nói dối
      setErr(e instanceof ApiFail ? e.message : 'Không lưu được');
    }
  };

  return (
    <div className="stack">
      <p className="muted">Mặc định lấy theo Anki. Áp dụng từ phiên học tiếp theo.</p>
      {saved && <p className="muted">✓ đã lưu</p>}
      {err && <p className="err">✕ {err}</p>}

      <div className="field">
        <label>Cách ôn tập</label>
        <small className="muted">
          Bật nhiều mode thì mỗi thẻ rút ngẫu nhiên một mode. Thẻ thiếu dữ liệu cho mode
          nào thì tự bỏ qua mode đó — ví dụ không có câu ngữ cảnh thì không điền vào câu được.
        </small>
        <div className="modes">
          {MODES.map((m) => {
            const on = cfg.modes.includes(m.id);
            const last = on && cfg.modes.length === 1;
            return (
              <label key={m.id} className="mode-opt" data-on={on ? '1' : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  // Không cho tắt mode cuối cùng: rỗng thì phiên học không biết hỏi gì.
                  disabled={last}
                  onChange={() => void set({
                    modes: on
                      ? cfg.modes.filter((x) => x !== m.id)
                      : ([...cfg.modes, m.id] as StudyMode[]),
                  })}
                />
                <span>
                  <b>{m.name}</b>
                  <small>{m.hint}</small>
                </span>
              </label>
            );
          })}
        </div>
        {cfg.modes.length === 1 && (
          <small className="muted">Phải bật ít nhất một mode.</small>
        )}
      </div>

      {FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={f.key}>{f.label}</label>
          <input
            id={f.key}
            type="number"
            inputMode="numeric"
            min={f.min}
            max={f.max}
            step={f.step}
            value={cfg[f.key]}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= f.min && v <= f.max) void set({ [f.key]: v });
            }}
          />
          {f.note && <small className="muted">{f.note}</small>}
        </div>
      ))}

      <div className="field">
        <label htmlFor="leechAction">Khi thẻ thành leech</label>
        <select
          id="leechAction"
          value={cfg.leechAction}
          onChange={(e) => void set({ leechAction: e.target.value as StudyConfig['leechAction'] })}
        >
          <option value="tag">Chỉ gắn tag (như Anki)</option>
          <option value="suspend">Gắn tag và treo thẻ</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="retention">Tỷ lệ nhớ mục tiêu (FSRS)</label>
        <select
          id="retention"
          value={cfg.retention}
          onChange={(e) => void set({ retention: Number(e.target.value) })}
        >
          {[0.8, 0.85, 0.9, 0.95].map((r) => (
            <option key={r} value={r}>
              {Math.round(r * 100)}%{r === 0.9 ? ' (mặc định)' : ''}
            </option>
          ))}
        </select>
        <small className="muted">
          Cao hơn = nhớ chắc hơn nhưng ôn dày hơn. Chỉ đổi <b>khoảng lặp</b>, không đổi
          stability nên bậc độ nhớ giữ nguyên.
        </small>
      </div>

      <button className="btn" onClick={() => void set({ ...DEFAULT_CONFIG })}>
        Về mặc định Anki
      </button>

      <p className="muted" style={{ fontSize: 11.5 }}>
        Ngưỡng bậc độ nhớ ({cfg.levelThresholds.join(' / ')} ngày) không nằm ở đây: nó chỉ ảnh
        hưởng hiển thị, không ảnh hưởng lịch ôn — để cạnh các tham số trên sẽ gây hiểu nhầm.
      </p>
    </div>
  );
}
