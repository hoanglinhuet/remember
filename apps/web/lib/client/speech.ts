/**
 * Đọc thành tiếng: ưu tiên giọng nữ của translate.google.com, lùi về Web Speech API.
 *
 * ĐÃ ĐO: `translate_tts` trả 404 + `text/html` khi request có header `Referer`
 * (chặn hotlink) ⇒ Chrome áp Opaque Response Blocking ⇒ ERR_BLOCKED_BY_ORB.
 * Không có Referer thì trả 200 + `audio/mpeg`.
 * `new Audio()` KHÔNG có thuộc tính `referrerPolicy`, nên phải chặn ở cấp trang:
 * `metadata.referrer = 'no-referrer'` trong app/layout.tsx.
 */

const FEMALE_HINTS = [
  'zira', 'hazel', 'susan', 'linda', 'heera',
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'ava',
  'female', 'nữ', 'hoaimy', 'hoai my', 'linh',
  'google us english', 'google uk english female',
];

let audio: HTMLAudioElement | null = null;
/** Google TTS chết một lần thì thôi, khỏi chờ lỗi mỗi lần bấm nút đọc. */
let googleTtsOk = true;

function ttsUrl(text: string, lang: string, rate: number): string {
  const q = text.slice(0, 200);
  const tl = lang.split('-')[0] ?? 'en';
  return (
    'https://translate.google.com/translate_tts' +
    `?ie=UTF-8&client=tw-ob&idx=0&total=1&textlen=${q.length}` +
    // `ttsspeed` chỉ nhận vài mức; <1 cho ra giọng chậm hẳn, dùng cho mode nghe-rồi-gõ.
    (rate < 1 ? '&ttsspeed=0.24' : '') +
    `&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`
  );
}

function pickVoice(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  const base = (lang.split('-')[0] ?? 'en').toLowerCase();
  const forLang = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(base));
  const female = forLang.find((v) => FEMALE_HINTS.some((h) => v.name?.toLowerCase().includes(h)));
  return female ?? forLang[0] ?? null;
}

function speakLocal(text: string, lang: string, rate = 0.92): void {
  const synth = window.speechSynthesis;
  if (!synth) return;

  const u = new SpeechSynthesisUtterance(text);
  const map: Record<string, string> = { en: 'en-US', vi: 'vi-VN' };
  u.lang = lang.length === 2 ? (map[lang] ?? lang) : lang;
  u.rate = rate;

  const run = () => {
    const v = pickVoice(synth, lang);
    if (v) u.voice = v;
    synth.speak(u);
  };
  // iOS/Android nạp danh sách giọng chậm: lần gọi đầu getVoices() có thể rỗng.
  if (synth.getVoices().length) run();
  else synth.addEventListener('voiceschanged', run, { once: true });
}

/**
 * @param rate 1 = bình thường, <1 = chậm (mode nghe-rồi-gõ cần nghe từng âm).
 */
export function speak(text: string, lang: string | null, rate = 1): void {
  if (!text || typeof window === 'undefined') return;
  const code = lang && lang !== 'auto' ? lang : 'en';

  window.speechSynthesis?.cancel();
  audio?.pause();

  if (!googleTtsOk) {
    speakLocal(text, code, rate * 0.92);
    return;
  }

  audio = new Audio(ttsUrl(text, code, rate));

  let fellBack = false;
  const fallback = (why: string) => {
    if (fellBack) return;
    fellBack = true;
    googleTtsOk = false;
    console.info('[Remember] giọng Google không dùng được (%s) -> giọng hệ thống', why);
    speakLocal(text, code, rate * 0.92);
  };

  // Gắn listener TRƯỚC play(): bị ORB chặn thì 'error' bắn ra gần như tức thì.
  audio.addEventListener('error', () => fallback('audio lỗi / ORB'), { once: true });
  audio.play().catch((e: unknown) => fallback(String((e as Error)?.name ?? e)));
}
