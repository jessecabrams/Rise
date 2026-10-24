import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { QuizQuestion } from './types';
import { sectionText, uid } from './text';
import { buildIdeas, type MapCtx } from './mastery';
import { runAi } from './ai';
import { patchDoc } from './store';
import { cosine, embed, packReady } from './localml';
import { downloadAudio, sayChunks, voiceKey } from './speech';
import { isOnline, keepStorage } from './online';
import { isIOS } from './localtts';

/* ---------- passage search (works fully offline once the answer pack is downloaded) ---------- */
export interface Passage {
  start: number;
  end: number;
  text: string;
}

export function passages(sentences: string[], size = 650): Passage[] {
  const out: Passage[] = [];
  let a = 0;
  let n = 0;
  for (let i = 0; i < sentences.length; i++) {
    n += sentences[i].length + 1;
    if (n >= size || i === sentences.length - 1) {
      out.push({ start: a, end: i + 1, text: sentences.slice(a, i + 1).join(' ') });
      a = i + 1;
      n = 0;
    }
  }
  return out;
}

interface Index {
  sig: number;
  dim: number;
  data: Float32Array;
}

const idxKey = (id: string) => `rise:vec:${id}`;

export async function buildIndex(id: string, sentences: string[], onPct?: (p: number) => void): Promise<Index> {
  const ps = passages(sentences);
  const vecs: number[][] = [];
  for (let i = 0; i < ps.length; i += 48) {
    vecs.push(...(await embed(ps.slice(i, i + 48).map((p) => p.text))));
    onPct?.(Math.min(1, (i + 48) / ps.length));
  }
  const dim = vecs[0]?.length || 384;
  const data = new Float32Array(vecs.length * dim);
  vecs.forEach((v, k) => data.set(v, k * dim));
  const idx = { sig: sentences.length, dim, data };
  try {
    await idbSet(idxKey(id), idx);
  } catch {
    /* storage blocked: keep in memory only */
  }
  return idx;
}

export async function hasIndex(id: string, sentences: string[]): Promise<boolean> {
  try {
    const idx = await idbGet<Index>(idxKey(id));
    return !!idx && idx.sig === sentences.length;
  } catch {
    return false;
  }
}

const WORD = /[a-z0-9']+/g;
const STOPWORDS = new Set('the a an and or but of to in on for with that this is are was were be it its as at by from you your their they we our not have has had will can into than then so if what how why when who which do does did about'.split(' '));

/** A quick word-overlap search: no model needed, light enough for any phone. */
function keywordPassages(sentences: string[], query: string, k: number): Passage[] {
  const terms = [...new Set((query.toLowerCase().match(WORD) || []).filter((w) => !STOPWORDS.has(w) && w.length > 2))];
  const ps = passages(sentences);
  if (!terms.length) return ps.slice(0, k);
  const df = new Map<string, number>();
  const toks = ps.map((p) => {
    const ws = p.text.toLowerCase().match(WORD) || [];
    const set = new Set(ws);
    for (const tm of terms) if (set.has(tm) || ws.some((w) => w.startsWith(tm))) df.set(tm, (df.get(tm) || 0) + 1);
    return ws;
  });
  const scored = ps.map((p, i) => {
    let s = 0;
    for (const tm of terms) {
      const tf = toks[i].filter((w) => w === tm || w.startsWith(tm)).length;
      if (tf) s += (1 + Math.log(tf)) * Math.log(1 + ps.length / (df.get(tm) || 1));
    }
    return { p, s };
  });
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.p);
}

export async function searchPassages(id: string, sentences: string[], query: string, k = 4, onPct?: (p: number) => void): Promise<Passage[]> {
  if (!packReady() || isIOS()) return keywordPassages(sentences, query, k);
  let idx: Index | undefined;
  try {
    idx = await idbGet<Index>(idxKey(id));
  } catch {
    idx = undefined;
  }
  if (!idx || idx.sig !== sentences.length) idx = await buildIndex(id, sentences, onPct);
  const ps = passages(sentences);
  const [q] = await embed([query]);
  const scored = ps.map((p, i) => ({ p, s: cosine(q, idx!.data.subarray(i * idx!.dim, (i + 1) * idx!.dim)) }));
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.p);
}

export async function removeIndex(id: string) {
  try {
    await idbDel(idxKey(id));
  } catch {
    /* nothing stored */
  }
}

/* ---------- downloading a piece for offline ---------- */
export interface PrepOptions {
  audio: boolean;
}

export interface PrepProgress {
  label: string;
  pct: number;
}

/** Builds everything a piece needs offline: idea map, question bank, search index and optional voice audio. */
export async function prepareOffline(ctx: MapCtx, opts: PrepOptions, onProgress: (p: PrepProgress) => void, cancel: { current: boolean }) {
  if (!isOnline()) throw new Error('Downloading for offline needs a connection. Try again when you have signal.');
  const chs = ctx.chs;
  const audioWeight = opts.audio ? 0.4 : 0;
  const aiWeight = (1 - audioWeight) * 0.9;
  const steps = chs.length * 2;
  let done = 0;
  const tick = (label: string) => onProgress({ label, pct: (done / steps) * aiWeight });

  const where = (ch: (typeof chs)[number]) => (chs.length > 1 ? `chapter ${ch.index + 1}` : 'your piece');
  // Several chapters at once: the coach can work on three in parallel.
  const together = async (fn: (ch: (typeof chs)[number]) => Promise<void>) => {
    let next = 0;
    const lane = async () => {
      while (next < chs.length && !cancel.current) {
        const ch = chs[next++];
        await fn(ch);
        done++;
      }
    };
    await Promise.all([lane(), lane(), lane()]);
  };
  await together(async (ch) => {
    if (ctx.bodyRef.current.map?.[ch.index]) return;
    tick(`Mapping ideas in ${where(ch)}…`);
    await buildIdeas(ctx, ch);
  });
  if (cancel.current) return;
  await together(async (ch) => {
    const cm = ctx.bodyRef.current.map?.[ch.index];
    if (!cm || ctx.bodyRef.current.bank?.[ch.index]?.length) return;
    tick(`Writing offline questions for ${where(ch)}…`);
    const r = await runAi<{ questions: Omit<QuizQuestion, 'id'>[] }>('bank', {
      title: ctx.title,
      chapter: ch.title,
      text: sectionText(ctx.s.sentences, ch),
      ideas: cm.ideas.map(({ id, title, summary }) => ({ id, title, summary }))
    });
    const valid = new Set(cm.ideas.map((i) => i.id));
    const qs: QuizQuestion[] = (r.questions || [])
      .filter((q) => q.question && q.ideaId && valid.has(q.ideaId))
      .map((q) => ({ ...q, id: uid(), keyPoints: q.keyPoints || [], idealAnswer: q.idealAnswer || '' }));
    ctx.update((b) => ({ ...b, bank: { ...(b.bank || {}), [ch.index]: qs } }));
  });
  if (cancel.current) return;
  onProgress({ label: 'Indexing for offline search…', pct: aiWeight });
  // Phones skip this: it's slow and memory-hungry there, and Ask falls back to a quick word search.
  if (packReady() && !isIOS()) {
    await buildIndex(ctx.id, ctx.s.sentences, (p) => onProgress({ label: 'Indexing for offline search…', pct: aiWeight + p * (1 - audioWeight - aiWeight) }));
  }
  let audio: string | undefined;
  if (opts.audio && voiceKey()) {
    audio = voiceKey()!;
    // The reading itself, plus every offline quiz question, so questions are read in the same voice.
    const questionClips = Object.values(ctx.bodyRef.current.bank || {})
      .flat()
      .flatMap((q) => sayChunks(q.question));
    await downloadAudio(
      [...ctx.s.sentences, ...new Set(questionClips)],
      (p) => onProgress({ label: `Downloading voice audio · ${Math.round(p * 100)}%`, pct: 1 - audioWeight + p * audioWeight }),
      cancel
    );
    if (cancel.current) return;
  }
  patchDoc(ctx.id, (d) => {
    d.offline = { at: Date.now(), chapters: chs.length, ...(audio ? { audio, audioAt: Date.now() } : d.offline?.audio ? { audio: d.offline.audio, audioAt: d.offline.audioAt } : {}) };
  });
  await keepStorage();
  onProgress({ label: 'Ready offline', pct: 1 });
}

/* ---------- picking questions from the offline bank ---------- */
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function bankFor(bank: Record<string, QuizQuestion[]> | undefined, chapterIdx: number[], opts: { count: number; idea?: string; perIdea?: string[]; avoid?: string[] }): QuizQuestion[] {
  const pool = chapterIdx.flatMap((c) => bank?.[c] || []);
  const recent = new Set(opts.avoid || []);
  const fresh = (list: QuizQuestion[]) => [...shuffle(list.filter((q) => !recent.has(q.question))), ...shuffle(list.filter((q) => recent.has(q.question)))];
  const copy = (q: QuizQuestion) => ({ ...q, id: uid() });
  if (opts.idea) return fresh(pool.filter((q) => q.ideaId === opts.idea)).slice(0, opts.count).map(copy);
  if (opts.perIdea) return opts.perIdea.map((id) => fresh(pool.filter((q) => q.ideaId === id))[0]).filter(Boolean).map(copy);
  // Spread across ideas: round-robin one question per idea.
  const byIdea = new Map<string, QuizQuestion[]>();
  for (const q of fresh(pool)) byIdea.set(q.ideaId || '', [...(byIdea.get(q.ideaId || '') || []), q]);
  const out: QuizQuestion[] = [];
  while (out.length < opts.count && [...byIdea.values()].some((l) => l.length)) {
    for (const l of shuffle([...byIdea.values()])) if (l.length && out.length < opts.count) out.push(l.shift()!);
  }
  return out.map(copy);
}
