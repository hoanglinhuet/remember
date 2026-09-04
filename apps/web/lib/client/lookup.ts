/**
 * Tra từ — gọi TRỰC TIẾP từ trình duyệt, KHÔNG qua API của mình (ADR-12, ADR-19).
 *
 * Vì sao không proxy qua route handler: một IP (server) gọi thay cho tất cả user
 * ⇒ Google chặn IP đó là toàn hệ thống mất chức năng dịch. Gọi từ client thì mỗi
 * người dùng một IP.
 *
 * ĐÃ KIỂM CHỨNG (curl kèm header Origin, 2026-09-01):
 *   translate.googleapis.com/translate_a/single -> Access-Control-Allow-Origin: *
 *   freedictionaryapi.com/api/v1/entries/en/... -> access-control-allow-origin: <origin>
 *
 * ⚠️ translate_a là endpoint KHÔNG CHÍNH THỨC của Google (ADR-10): không key, ngoài ToS,
 * có thể chặn hoặc đổi format bất kỳ lúc nào ⇒ luôn có fallback và lỗi là LỖI MỀM.
 */

export interface Sense {
  gloss: string;
  example?: string | null;
  /** Các từ gốc cũng dịch thành nghĩa này — dùng kiểm chứng đúng sắc thái (FR-A1). */
  reverse?: string[];
  synonyms?: string[];
}

export interface SenseGroup {
  pos: string | null;
  posRaw: string | null;
  definition: { gloss: string; example: string | null } | null;
  senses: Sense[];
  isPrimary?: boolean;
}

export interface LookupResult {
  providerId: string;
  detectedLang: string | null;
  primary: string;
  reading: string | null;
  readingType: 'ipa' | 'translit' | null;
  groups: SenseGroup[];
  license: string | null;
  fromCache: boolean;
  fetchedAt: string;
}

export type LookupOutcome =
  | { ok: true; result: LookupResult }
  | { ok: false; attempts: { id: string; reason: string }[] };

const TIMEOUT_MS = 5000;
const CACHE_PREFIX = 'lookup:';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const POS_CANON: Record<string, string> = {
  noun: 'noun', n: 'noun', verb: 'verb', v: 'verb',
  adjective: 'adjective', adj: 'adjective', adverb: 'adverb', adv: 'adverb',
  pronoun: 'pronoun', preposition: 'preposition', conjunction: 'conjunction',
  interjection: 'interjection', exclamation: 'interjection',
  determiner: 'determiner', article: 'determiner', numeral: 'numeral', number: 'numeral',
  phrase: 'phrase', idiom: 'idiom', abbreviation: 'abbreviation',
  prefix: 'affix', suffix: 'affix', particle: 'particle',
};

export const POS_LABEL: Record<string, string> = {
  noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ',
  pronoun: 'đại từ', preposition: 'giới từ', conjunction: 'liên từ',
  interjection: 'thán từ', determiner: 'từ hạn định', numeral: 'số từ',
  phrase: 'cụm từ', idiom: 'thành ngữ', abbreviation: 'viết tắt', affix: 'phụ tố',
  particle: 'tiểu từ',
};

function canonPos(raw: unknown): string | null {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  return POS_CANON[k] ?? k;
}

const SINGLE_WORD = /^[a-zA-Z][a-zA-Z'-]*$/;
export const isSingleWord = (t: string) => SINGLE_WORD.test(t.trim());

async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------ Google Translate

interface GoogleResponse {
  sentences?: { trans?: string; src_translit?: string }[];
  dict?: { pos?: string; entry?: { word?: string; reverse_translation?: string[] }[] }[];
  definitions?: { pos?: string; entry?: { gloss?: string; example?: string }[] }[];
  alternative_translations?: { alternative?: { word_postproc?: string }[] }[];
  src?: string;
}

async function google(text: string, langTo: string): Promise<LookupResult | null> {
  const dt = ['t', 'bd', 'rm', 'md', 'ex', 'at'].map((d) => `dt=${d}`).join('&');
  const data = await getJson<GoogleResponse>(
    `https://translate.googleapis.com/translate_a/single?client=gtx&dj=1&hl=en` +
      `&sl=auto&tl=${encodeURIComponent(langTo)}&${dt}&q=${encodeURIComponent(text)}`,
  );

  const primary = (data.sentences ?? []).map((s) => s.trans ?? '').join('').trim();
  if (!primary) return null;

  // src_translit là chuyển tự (romaji, pinyin…), KHÔNG phải IPA -> UI không bọc //.
  const reading = (data.sentences ?? []).find((s) => s.src_translit)?.src_translit ?? null;

  const defByPos = new Map<string | null, { gloss: string; example: string | null }>();
  for (const d of data.definitions ?? []) {
    const pos = canonPos(d.pos);
    const first = (d.entry ?? [])[0];
    if (!first?.gloss || defByPos.has(pos)) continue;
    defByPos.set(pos, { gloss: first.gloss, example: first.example ?? null });
  }

  const groups: SenseGroup[] = [];
  for (const d of data.dict ?? []) {
    const pos = canonPos(d.pos);
    const senses: Sense[] = (d.entry ?? [])
      .slice(0, 10)
      .map((e) => ({ gloss: e.word ?? '', reverse: (e.reverse_translation ?? []).slice(0, 8) }))
      .filter((s) => s.gloss);
    if (!senses.length) continue;
    groups.push({ pos, posRaw: d.pos ?? null, definition: defByPos.get(pos) ?? null, senses });
    defByPos.delete(pos);
  }
  for (const [pos, definition] of defByPos) {
    groups.push({ pos, posRaw: pos, definition, senses: [{ gloss: definition.gloss }] });
  }

  // Bản dịch chính đôi khi KHÔNG nằm trong data.dict (vd "resilient" -> primary "đàn hồi"
  // nhưng dict chỉ có "bật lên"/"dội lên"). Không đưa vào thì nghĩa thông dụng nhất lại
  // không chọn được để làm mặt sau thẻ.
  const inSenses = groups.some((g) =>
    g.senses.some((x) => x.gloss.toLowerCase() === primary.toLowerCase()),
  );
  if (groups.length && !inSenses) {
    groups.unshift({ pos: null, posRaw: null, definition: null, senses: [{ gloss: primary }], isPrimary: true });
  }

  if (!groups.length) {
    const alts = (data.alternative_translations?.[0]?.alternative ?? [])
      .map((a) => String(a.word_postproc ?? '').trim())
      .filter((w, i, arr) => w && w.toLowerCase() !== primary.toLowerCase() && arr.indexOf(w) === i)
      .slice(0, 3);
    groups.push({
      pos: null, posRaw: null, definition: null,
      senses: [{ gloss: primary }, ...alts.map((w) => ({ gloss: w }))],
    });
  }

  return {
    providerId: 'Google Translate',
    detectedLang: data.src ?? null,
    primary,
    reading,
    readingType: reading ? 'translit' : null,
    groups,
    license: null,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------- freedictionaryapi.com

interface FreeDictResponse {
  entries?: {
    partOfSpeech?: string;
    pronunciations?: { type?: string; text?: string }[];
    senses?: { definition?: string; examples?: (string | { text?: string })[]; quotes?: { text?: string }[]; synonyms?: string[] }[];
    synonyms?: string[];
  }[];
}

type FreeEntry = NonNullable<FreeDictResponse['entries']>[number];

/** Trả IPA đã bỏ dấu / hoặc [ ] ở hai đầu — UI tự bọc lại, tránh thành //x//. */
function firstIpa(entry: FreeEntry): string | null {
  const list = entry.pronunciations ?? [];
  const ipa = list.find((p) => String(p.type).toLowerCase() === 'ipa' && p.text);
  const raw = (ipa ?? list.find((p) => p.text))?.text;
  return raw ? raw.trim().replace(/^[/[]+|[/\]]+$/g, '').trim() || null : null;
}

function senseExample(s: NonNullable<FreeEntry['senses']>[number]): string | null {
  const ex = (s.examples ?? []).find((e) => (typeof e === 'string' ? e : e?.text));
  if (ex) return typeof ex === 'string' ? ex : (ex.text ?? null);
  return (s.quotes ?? [])[0]?.text ?? null;
}

async function freeDict(text: string): Promise<FreeDictResponse | null> {
  if (!isSingleWord(text)) return null;
  const data = await getJson<FreeDictResponse>(
    `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(text.trim().toLowerCase())}`,
  );
  return data.entries?.length ? data : null;
}

/** Bù IPA + định nghĩa gốc theo loại từ (Google không trả IPA cho chữ Latin). */
async function enrich(result: LookupResult, text: string): Promise<void> {
  if (!isSingleWord(text)) return;
  if (result.detectedLang && result.detectedLang !== 'en') return;

  const data = await freeDict(text);
  if (!data?.entries) return;

  for (const entry of data.entries) {
    const ipa = firstIpa(entry);
    if (!ipa) continue;
    // IPA thật đáng tin hơn chuyển tự của Google -> ghi đè cả khi đã có translit.
    if (!result.reading || result.readingType !== 'ipa') {
      result.reading = ipa;
      result.readingType = 'ipa';
    }
    break;
  }

  const defByPos = new Map<string | null, { gloss: string; example: string | null }>();
  for (const entry of data.entries) {
    const pos = canonPos(entry.partOfSpeech);
    if (defByPos.has(pos)) continue;
    const s = (entry.senses ?? []).find((x) => x.definition);
    if (s?.definition) defByPos.set(pos, { gloss: s.definition, example: senseExample(s) });
  }
  for (const g of result.groups) {
    if (!g.definition && g.pos && defByPos.has(g.pos)) g.definition = defByPos.get(g.pos) ?? null;
  }
  if (defByPos.size) {
    result.license = result.license
      ? `${result.license} · Wiktionary CC BY-SA 4.0`
      : 'Wiktionary · CC BY-SA 4.0';
  }
}

/** Dự phòng khi Google chết: chỉ có định nghĩa tiếng Anh, không có nghĩa tiếng Việt. */
async function freeDictOnly(text: string): Promise<LookupResult | null> {
  const data = await freeDict(text);
  if (!data?.entries) return null;

  const buckets = new Map<string | null, { posRaw: string | null; senses: Sense[] }>();
  let reading: string | null = null;

  for (const entry of data.entries) {
    reading ??= firstIpa(entry);
    const pos = canonPos(entry.partOfSpeech);
    let bucket = buckets.get(pos);
    if (!bucket) {
      bucket = { posRaw: entry.partOfSpeech ?? null, senses: [] };
      buckets.set(pos, bucket);
    }
    for (const s of entry.senses ?? []) {
      if (!s.definition || bucket.senses.length >= 8) continue;
      if (bucket.senses.some((x) => x.gloss === s.definition)) continue;
      bucket.senses.push({
        gloss: s.definition,
        example: senseExample(s),
        synonyms: (s.synonyms?.length ? s.synonyms : entry.synonyms ?? []).slice(0, 8),
      });
    }
  }

  const groups: SenseGroup[] = [...buckets]
    .filter(([, b]) => b.senses.length)
    .map(([pos, b]) => ({ pos, posRaw: b.posRaw, definition: null, senses: b.senses }));
  if (!groups.length) return null;

  return {
    providerId: 'freedictionaryapi.com',
    detectedLang: 'en',
    primary: groups[0]!.senses[0]!.gloss,
    reading,
    readingType: reading ? 'ipa' : null,
    groups,
    license: 'Wiktionary · CC BY-SA 4.0',
    fromCache: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------- cache

function readCache(key: string): LookupResult | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const box = JSON.parse(raw) as { v: LookupResult; exp: number };
    return box.exp > Date.now() ? box.v : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: LookupResult): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ v: value, exp: Date.now() + CACHE_TTL_MS }));
  } catch {
    // localStorage đầy (quota Safari nhỏ) -> dọn hết cache tra từ rồi bỏ qua.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  }
}

const inflight = new Map<string, Promise<LookupOutcome>>();

export async function lookup(text: string, langTo = 'vi'): Promise<LookupOutcome> {
  const q = text.trim();
  if (!q) return { ok: false, attempts: [{ id: 'input', reason: 'rỗng' }] };

  const key = `${langTo}|${q.toLowerCase()}`;
  const hit = readCache(key);
  if (hit) return { ok: true, result: { ...hit, fromCache: true } };

  const running = inflight.get(key);
  if (running) return running;

  const job = (async (): Promise<LookupOutcome> => {
    const attempts: { id: string; reason: string }[] = [];
    const chain: [string, () => Promise<LookupResult | null>][] = [
      ['Google Translate', () => google(q, langTo)],
      ['freedictionaryapi.com', () => freeDictOnly(q)],
    ];

    for (const [id, fn] of chain) {
      try {
        const result = await fn();
        if (!result) {
          attempts.push({ id, reason: 'không có kết quả' });
          continue;
        }
        if (id !== 'freedictionaryapi.com') {
          try { await enrich(result, q); } catch { /* IPA là phần thêm, không phải điều kiện */ }
        }
        writeCache(key, result);
        return { ok: true, result };
      } catch (e) {
        const err = e as Error;
        attempts.push({ id, reason: err?.name === 'AbortError' ? 'quá 5s' : String(err?.message ?? e) });
      }
    }
    return { ok: false, attempts };
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
