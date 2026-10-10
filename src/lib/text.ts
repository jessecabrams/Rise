export interface Para {
  start: number; // global index of the first sentence
  sentences: string[];
  heading?: number; // 1-3 when this paragraph is a chapter or section heading
}

const HEAD_MARK = /^(#{1,3})\s+/;
const HEAD_WORD = /^(chapter|part|section|lesson|module|unit|book|appendix|epilogue|prologue|introduction|conclusion|afterword|foreword|preface)\b/i;

/** Returns a heading level for a block, or 0. `next` is the following block, used to tell headings from list items. */
function headingLevel(block: string, next: string | undefined): number {
  const m = block.match(HEAD_MARK);
  if (m) return m[1].length;
  const t = block.trim();
  const words = t.split(/\s+/).length;
  if (t.length > 90 || words > 12) return 0;
  const nextIsBody = !!next && next.replace(HEAD_MARK, '').length > 120;
  if (HEAD_WORD.test(t) && nextIsBody) return 1;
  if (/[.!?,;"”’)]$/.test(t)) return 0;
  if (!/^[A-Z0-9"“'‘]/.test(t)) return 0;
  return nextIsBody ? 2 : 0;
}

export interface Structured {
  paras: Para[];
  sentences: string[];
}

export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const seg: any =
  typeof Intl !== 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter('en', { granularity: 'sentence' }) : null;

export function splitSentences(paragraph: string): string[] {
  const p = paragraph.replace(/\s+/g, ' ').trim();
  if (!p) return [];
  let parts: string[];
  if (seg) {
    parts = Array.from(seg.segment(p) as Iterable<{ segment: string }>, (s) => s.segment.trim());
  } else {
    parts = (p.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g) || [p]).map((s) => s.trim());
  }
  const out: string[] = [];
  for (const part of parts.filter(Boolean)) {
    if (out.length && part.length < 4) out[out.length - 1] += ' ' + part;
    else out.push(...splitLong(part));
  }
  return out;
}

function splitLong(s: string, max = 420): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(', '));
    if (cut < max * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const cache = new Map<string, Structured>();

export function structure(text: string, key?: string): Structured {
  if (key && cache.has(key)) return cache.get(key)!;
  const paras: Para[] = [];
  const sentences: string[] = [];
  const blocks = normalize(text)
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  blocks.forEach((block, k) => {
    const level = headingLevel(block, blocks[k + 1]);
    const ss = splitSentences(block.replace(HEAD_MARK, ''));
    if (!ss.length) return;
    paras.push({ start: sentences.length, sentences: ss, ...(level ? { heading: level } : {}) });
    sentences.push(...ss);
  });
  const result = { paras, sentences };
  if (key) cache.set(key, result);
  return result;
}

export function forget(key: string) {
  cache.delete(key);
}

export function countWords(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

export function wordAt(sentence: string, charIndex: number): [number, number] | null {
  if (charIndex < 0 || charIndex >= sentence.length) return null;
  let start = charIndex;
  while (start > 0 && /\S/.test(sentence[start - 1])) start--;
  while (start < sentence.length && /\s/.test(sentence[start])) start++;
  let end = start;
  while (end < sentence.length && /\S/.test(sentence[end])) end++;
  return end > start ? [start, end - start] : null;
}

export interface Chapter {
  index: number;
  title: string;
  /** Short label for menus, like "Ch 3 · Retrieval is the workout". */
  label: string;
  start: number;
  end: number; // exclusive
  chars: number;
}

const MIN_BODY = 200;
const MAX_CHAPTER = 24000;
const PART = 12000;

/** Splits a run of sentences into parts of about `size` characters. */
function bySize(sentences: string[], start: number, end: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  let a = start;
  let n = 0;
  for (let i = start; i < end; i++) {
    n += sentences[i].length + 1;
    if (n >= size || i === end - 1) {
      out.push([a, i + 1]);
      a = i + 1;
      n = 0;
    }
  }
  return out;
}

const chapterCache = new Map<Structured, Chapter[]>();

/** Finds the chapters in the material from its headings, falling back to even parts for long unstructured text. */
export function chapters(s: Structured, docTitle = ''): Chapter[] {
  const hit = chapterCache.get(s);
  if (hit) return hit;
  const raw: { title: string; start: number; chars: number }[] = [];
  let cur = { title: '', start: 0, chars: 0 };
  for (const p of s.paras) {
    if (p.heading) {
      const t = p.sentences.join(' ');
      if (cur.chars < MIN_BODY) {
        cur.title = t; // a heading with little or no text under it folds into the next one
      } else {
        raw.push(cur);
        cur = { title: t, start: p.start, chars: 0 };
      }
    } else {
      cur.chars += p.sentences.reduce((a, x) => a + x.length + 1, 0);
    }
  }
  raw.push(cur);

  const total = s.sentences.length;
  const plain = raw.length === 1 || raw.length > 120;
  let spans: { title: string; start: number; end: number }[];
  if (plain) {
    const whole = s.sentences.reduce((a, x) => a + x.length + 1, 0);
    spans =
      whole > 15000
        ? bySize(s.sentences, 0, total, PART).map(([a, b], i) => ({ title: `Part ${i + 1}: “${s.sentences[a].split(/\s+/).slice(0, 5).join(' ')}…”`, start: a, end: b }))
        : [{ title: raw[0].title && raw.length === 1 ? raw[0].title : 'Whole piece', start: 0, end: total }];
  } else {
    spans = [];
    raw.forEach((r, i) => {
      const end = i + 1 < raw.length ? raw[i + 1].start : total;
      if (r.chars > MAX_CHAPTER) {
        const parts = bySize(s.sentences, r.start, end, PART);
        parts.forEach(([a, b], k) => spans.push({ title: `${r.title || 'Untitled'} (part ${k + 1} of ${parts.length})`, start: a, end: b }));
      } else spans.push({ title: r.title, start: r.start, end });
    });
  }

  const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
  const out = spans
    .filter((x) => x.end > x.start)
    .map((x, index) => {
      let title = clean(x.title);
      if (!title || (index === 0 && spans.length > 1 && docTitle && title.toLowerCase() === docTitle.toLowerCase())) title = index === 0 && spans.length > 1 ? 'Introduction' : title || 'Whole piece';
      const chars = s.sentences.slice(x.start, x.end).reduce((a, y) => a + y.length + 1, 0);
      const short = title.length > 40 ? title.slice(0, 38).replace(/\s+\S*$/, '') + '…' : title;
      return { index, title, label: spans.length > 1 ? `Ch ${index + 1} · ${short}` : short, start: x.start, end: x.end, chars };
    });
  chapterCache.set(s, out);
  return out;
}

export function sectionText(sentences: string[], c: { start: number; end: number }): string {
  return sentences.slice(c.start, c.end).join(' ');
}

const STOP = new Set('the a an and or but of to in on for with that this is are was were be it its as at by from you your their they we our not have has had will can into than then so if'.split(' '));
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Finds the sentence in a chapter that best matches a quoted phrase. */
export function locate(sentences: string[], c: { start: number; end: number }, phrase: string): number {
  const want = new Set(words(phrase));
  if (!want.size) return c.start;
  let best = c.start;
  let bestScore = 0;
  for (let i = c.start; i < c.end; i++) {
    let score = 0;
    for (const w of words(sentences[i])) if (want.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function minutesFor(words: number, rate = 1): number {
  return Math.max(1, Math.round(words / (165 * rate)));
}

export function titleFrom(text: string, fallback = 'Untitled'): string {
  const line = normalize(text).split('\n').find((l) => l.trim().length > 2) || fallback;
  const clean = line.replace(/^#+\s*/, '').trim();
  return clean.length > 80 ? clean.slice(0, 77).replace(/\s+\S*$/, '') + '…' : clean;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
