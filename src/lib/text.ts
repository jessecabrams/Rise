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

export interface HeadingInfo {
  start: number; // sentence index of the heading
  title: string;
  level: number;
  chars: number; // body text until the next heading of any level
}

/** Every heading in the material, in order, with how much text sits under it. */
export function headings(s: Structured): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  for (const p of s.paras) {
    if (p.heading) out.push({ start: p.start, title: p.sentences.join(' ').replace(/\s+/g, ' ').trim(), level: p.heading, chars: 0 });
    else if (out.length) out[out.length - 1].chars += p.sentences.reduce((a, x) => a + x.length + 1, 0);
  }
  return out;
}

const NUM = '([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[- ]\\w+|thirty)';
const CHAPTER_RE = new RegExp(`^(chapter|ch\\.?)\\s*${NUM}\\b`, 'i');
const PART_RE = new RegExp(`^(part|book)\\s+${NUM}\\b`, 'i');
/** "1. Title", "3 Title", "IV. Title", but not "1.2 Title". */
const NUMBERED_RE = /^([0-9]{1,2}|[IVXL]{1,6})[.:)]?\s+(?![0-9])\S/;
const MATTER_RE = /^(prologue|epilogue|introduction|conclusion|preface|foreword|afterword|appendix|acknowledg|notes|bibliography|index)\b/i;

/** Picks which headings start a chapter: real "Chapter N" headings when present, otherwise the top heading level. */
function chapterStarts(all: HeadingInfo[]): Set<number> {
  // A heading that repeats ("Summary", "Try This") is a section inside each chapter, never a chapter.
  const key = (h: HeadingInfo) => h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const count = new Map<string, number>();
  all.forEach((h) => count.set(key(h), (count.get(key(h)) || 0) + 1));
  const unique = all.filter((h) => count.get(key(h)) === 1);
  const hs = unique.length >= 2 ? unique : all;
  const chapterWord = hs.filter((h) => CHAPTER_RE.test(h.title));
  if (chapterWord.length >= 2) {
    return new Set(hs.filter((h) => CHAPTER_RE.test(h.title) || PART_RE.test(h.title) || MATTER_RE.test(h.title)).map((h) => h.start));
  }
  const levels = [...new Set(hs.map((h) => h.level))].sort((a, b) => a - b);
  // Everything at one level (older imports flattened headings): look for other signs of a chapter title.
  if (levels.length === 1 && hs.length > 8) {
    const numbered = hs.filter((h) => NUMBERED_RE.test(h.title));
    if (numbered.length >= 2 && numbered.length <= hs.length * 0.6) return new Set(hs.filter((h) => NUMBERED_RE.test(h.title) || PART_RE.test(h.title) || MATTER_RE.test(h.title)).map((h) => h.start));
    const caps = hs.filter((h) => /[A-Z]/.test(h.title) && h.title === h.title.toUpperCase());
    if (caps.length >= 2 && caps.length <= hs.length * 0.6) return new Set(caps.map((h) => h.start));
  }
  for (const L of levels) {
    const top = hs.filter((h) => h.level <= L);
    if (top.length >= 2) return new Set(top.map((h) => h.start));
  }
  return new Set(hs.map((h) => h.start));
}

const chapterCache = new WeakMap<Structured, Map<string, Chapter[]>>();

/**
 * Finds the big chapters in the material. Subheadings stay inside their chapter.
 * `override` is a hand-picked list of heading positions that start chapters.
 */
export function chapters(s: Structured, docTitle = '', override?: number[] | null): Chapter[] {
  const key = override?.length ? override.join(',') : 'auto';
  let byKey = chapterCache.get(s);
  const hit = byKey?.get(key);
  if (hit) return hit;

  const hs = headings(s);
  const totalChars = s.sentences.reduce((a, x) => a + x.length + 1, 0);
  const manual = !!override?.length;
  const starts = manual ? new Set(override) : chapterStarts(hs);
  // In long books, a "chapter" with almost no text is a divider like "Part One": fold it into the next.
  const minBody = manual ? 0 : Math.min(3000, Math.max(200, totalChars / 120));

  const raw: { title: string; start: number; chars: number; strong: boolean }[] = [];
  let cur = { title: '', start: 0, chars: 0, strong: false };
  for (const p of s.paras) {
    const isStart = p.heading && starts.has(p.start);
    if (isStart) {
      const t = p.sentences.join(' ');
      const strong = CHAPTER_RE.test(t);
      if (cur.chars <= minBody && (cur.chars > 0 || cur.title) && raw.length + 1 > 0 && (cur.chars === 0 || !manual)) {
        // Too little text so far (a title page, a "Part One" divider): merge it into this chapter and use this
        // chapter's title, unless the earlier one was a real "Chapter N" heading.
        if (!cur.strong || strong) {
          cur.title = t;
          cur.strong = strong;
        }
      } else {
        if (cur.chars > 0 || cur.title) raw.push(cur);
        cur = { title: t, start: p.start, chars: 0, strong };
      }
    } else if (!p.heading || !starts.has(p.start)) {
      cur.chars += p.sentences.reduce((a, x) => a + x.length + 1, 0);
    }
  }
  raw.push(cur);
  const list = raw.filter((r, i) => i === 0 || r.start > raw[i - 1].start);

  const total = s.sentences.length;
  let spans: { title: string; start: number; end: number }[];
  if (list.length <= 1) {
    spans =
      totalChars > 15000 && !hs.length
        ? bySize(s.sentences, 0, total, PART).map(([a, b], i) => ({ title: `Part ${i + 1}: “${s.sentences[a].split(/\s+/).slice(0, 5).join(' ')}…”`, start: a, end: b }))
        : [{ title: list[0]?.title || 'Whole piece', start: 0, end: total }];
  } else {
    spans = list.map((r, i) => ({ title: r.title, start: i === 0 ? 0 : r.start, end: i + 1 < list.length ? list[i + 1].start : total }));
  }

  const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
  const out = spans
    .filter((x) => x.end > x.start)
    .map((x, index, arr) => {
      let title = clean(x.title);
      if (!title || (index === 0 && arr.length > 1 && docTitle && title.toLowerCase() === docTitle.toLowerCase())) title = index === 0 && arr.length > 1 ? 'Introduction' : title || 'Whole piece';
      const chars = s.sentences.slice(x.start, x.end).reduce((a, y) => a + y.length + 1, 0);
      const short = title.length > 40 ? title.slice(0, 38).replace(/\s+\S*$/, '') + '…' : title;
      return { index, title, label: arr.length > 1 ? `Ch ${index + 1} · ${short}` : short, start: x.start, end: x.end, chars };
    });
  if (!byKey) chapterCache.set(s, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** Which chapter a sentence belongs to. */
export function chapterAt(chs: Chapter[], sentence: number): Chapter | undefined {
  return chs.find((c) => sentence >= c.start && sentence < c.end) || chs[chs.length - 1];
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
