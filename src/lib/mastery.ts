import type { ChapterMap, DocBody, DocMeta, IdeaNode, IdeaStat } from './types';
import { getState, patchDoc } from './store';
import { award, celebrate } from './game';
import { runAi } from './ai';
import { locate, sectionText, uid, type Chapter, type Structured } from './text';

/** Score at which an idea's star is lit. */
export const LIT = 80;
const DAY = 86_400_000;

/** Current strength of an idea, 0-100. It fades toward 35% of its score; each review makes it fade slower. */
export function strength(st?: IdeaStat, now = Date.now()): number {
  if (!st || !st.n) return 0;
  const halfLife = Math.min(90, 4 * 2 ** (st.n - 1));
  const days = Math.max(0, (now - st.at) / DAY);
  return Math.round(st.s * (0.35 + 0.65 * 0.5 ** (days / halfLife)));
}

export type StarState = 'dark' | 'dim' | 'glow' | 'lit';

export function starState(st?: IdeaStat): StarState {
  if (!st?.n) return 'dark';
  const v = strength(st);
  return v >= LIT ? 'lit' : v >= 50 ? 'glow' : 'dim';
}

/** An idea you once knew well that is slipping. */
export function isFading(st?: IdeaStat): boolean {
  return !!st?.n && st.s >= 60 && strength(st) <= st.s - 15;
}

export function daysUntilFade(st?: IdeaStat): number | null {
  if (!st?.n || st.s < 60) return null;
  for (let d = 0; d <= 400; d++) if (strength(st, st.at + d * DAY) <= st.s - 15) return Math.max(0, Math.ceil(d - (Date.now() - st.at) / DAY));
  return null;
}

export interface ChapterStats {
  pct: number; // 0..1 average strength
  lit: number;
  total: number;
  rays: number; // 0..4, one per quarter of ideas lit
  risen: boolean;
  fading: number;
  practiced: number;
}

export function chapterStats(meta: DocMeta | undefined, cm?: ChapterMap): ChapterStats {
  if (!cm || !cm.ideas.length) return { pct: 0, lit: 0, total: 0, rays: 0, risen: false, fading: 0, practiced: 0 };
  const stats = cm.ideas.map((i) => meta?.ideas?.[i.id]);
  const vals = stats.map((s) => strength(s));
  const lit = vals.filter((v) => v >= LIT).length;
  const total = cm.ideas.length;
  return {
    pct: vals.reduce((a, v) => a + v, 0) / total / 100,
    lit,
    total,
    rays: Math.floor((lit / total) * 4),
    risen: lit === total,
    fading: stats.filter(isFading).length,
    practiced: stats.filter((s) => s?.n).length
  };
}

export function docStats(meta: DocMeta | undefined, body?: DocBody | null) {
  const maps = Object.values(body?.map || {});
  const all = maps.flatMap((m) => m.ideas.map((i) => meta?.ideas?.[i.id]));
  const vals = all.map((s) => strength(s));
  return {
    ideas: all.length,
    lit: vals.filter((v) => v >= LIT).length,
    fading: all.filter(isFading).length,
    pct: all.length ? vals.reduce((a, v) => a + v, 0) / all.length / 100 : 0,
    risen: maps.filter((m) => chapterStats(meta, m).risen).length,
    mapped: maps.length
  };
}

/** Light summary for library cards, computed from synced stats only. */
export function metaSummary(meta: DocMeta) {
  const stats = Object.values(meta.ideas || {});
  return {
    ideas: meta.ideaTotal || 0,
    lit: stats.filter((s) => strength(s) >= LIT).length,
    fading: stats.filter(isFading).length,
    risen: Object.keys(meta.risen || {}).length,
    chapters: meta.chapterTotal || 0
  };
}

/* ---------- building the idea map ---------- */
export interface MapCtx {
  id: string;
  title: string;
  s: Structured;
  bodyRef: { current: DocBody };
  update: (fn: (b: DocBody) => DocBody) => void;
}

export function saveChapterMap(ctx: MapCtx, cm: ChapterMap) {
  const old = ctx.bodyRef.current.map?.[cm.index];
  ctx.update((b) => ({ ...b, map: { ...(b.map || {}), [cm.index]: cm } }));
  const maps = Object.values(ctx.bodyRef.current.map || {});
  patchDoc(ctx.id, (d) => {
    if (old) {
      const keep = new Set(cm.ideas.map((i) => i.id));
      for (const i of old.ideas) if (!keep.has(i.id) && d.ideas) delete d.ideas[i.id];
      if (d.risen) delete d.risen[cm.index];
    }
    d.ideaTotal = maps.reduce((a, m) => a + m.ideas.length, 0);
    d.mappedChapters = maps.length;
  });
}

export function ideasFromList(ctx: MapCtx, ch: Chapter, list: { title: string; summary?: string; explanation?: string; anchor?: string }[]): IdeaNode[] {
  return list
    .filter((i) => i && i.title)
    .slice(0, 6)
    .map((i) => ({
      id: uid(),
      title: i.title.trim(),
      summary: (i.summary || i.explanation || '').trim(),
      anchor: locate(ctx.s.sentences, ch, i.anchor || `${i.title} ${i.summary || i.explanation || ''}`)
    }));
}

export async function buildIdeas(ctx: MapCtx, ch: Chapter): Promise<ChapterMap> {
  const r = await runAi<{ ideas: { title: string; summary: string; anchor?: string }[] }>('ideas', {
    title: ctx.title,
    chapter: ch.title,
    text: sectionText(ctx.s.sentences, ch)
  });
  const ideas = ideasFromList(ctx, ch, r.ideas || []);
  if (!ideas.length) throw new Error('The coach did not find clear ideas in this chapter. Try again.');
  const cm: ChapterMap = { index: ch.index, title: ch.title, ideas, builtAt: Date.now() };
  saveChapterMap(ctx, cm);
  award('Mapped a chapter', 10, { chaptersMapped: 1 });
  return cm;
}

/* ---------- recording understanding ---------- */
export interface IdeaDelta {
  ideaId: string;
  title: string;
  before: number;
  after: number;
  lit: boolean;
  revived: boolean;
  risen: string | null;
}

/** Updates an idea's mastery from one graded answer and fires the star, sunrise and mastery moments. */
export function recordIdea(docId: string, body: DocBody, ideaId: string, score: number): IdeaDelta | null {
  const maps = Object.values(body.map || {});
  const cm = maps.find((m) => m.ideas.some((i) => i.id === ideaId));
  const meta = getState().docs[docId];
  if (!cm || !meta) return null;
  const idea = cm.ideas.find((i) => i.id === ideaId)!;
  const old = meta.ideas?.[ideaId];
  const before = strength(old);
  const wasFading = isFading(old);
  const s = Math.max(0, Math.min(100, Math.round(old?.n ? before * 0.4 + score * 0.6 : score)));
  const next: IdeaStat = { s, n: (old?.n || 0) + 1, at: Date.now(), best: Math.max(old?.best || 0, s), ch: cm.index };
  patchDoc(docId, (d) => {
    d.ideas = { ...(d.ideas || {}), [ideaId]: next };
  });

  const lit = s >= LIT && (old?.best ?? 0) < LIT;
  const revived = wasFading && s >= 70;
  const after = getState().docs[docId];
  let risen: string | null = null;
  if (chapterStats(after, cm).risen && !after.risen?.[cm.index]) {
    risen = cm.title;
    patchDoc(docId, (d) => {
      d.risen = { ...(d.risen || {}), [cm.index]: Date.now() };
    });
  }
  const now = getState().docs[docId];
  const total = now.chapterTotal || maps.length;
  const book = !now.mastered && maps.length >= total && maps.every((m) => chapterStats(now, m).risen);
  if (book) patchDoc(docId, (d) => (d.mastered = Date.now()));

  const xp = (lit ? 20 : 0) + (revived ? 10 : 0) + (risen ? 60 : 0) + (book ? 200 : 0);
  if (xp) {
    award(book ? 'Mastered the whole piece' : risen ? 'A chapter sun rose' : lit ? 'Lit an idea star' : 'Revived a fading star', xp, {
      ideasLit: lit ? 1 : 0,
      fadingRevived: revived ? 1 : 0,
      chaptersRisen: risen ? 1 : 0,
      booksMastered: book ? 1 : 0
    });
  }
  if (lit) celebrate({ kind: 'star', title: idea.title });
  if (risen) celebrate({ kind: 'risen', title: risen, chapter: cm.index });
  if (book) celebrate({ kind: 'book', title: now.title });
  return { ideaId, title: idea.title, before, after: s, lit, revived, risen };
}

/** Corrects an idea's score once the full coach has re-graded an answer that was graded offline. */
export function adjustIdea(docId: string, ideaId: string, offlineScore: number, coachScore: number) {
  patchDoc(docId, (d) => {
    const st = d.ideas?.[ideaId];
    if (!st) return;
    const s = Math.max(0, Math.min(100, Math.round(st.s + 0.6 * (coachScore - offlineScore))));
    d.ideas![ideaId] = { ...st, s, best: Math.max(st.best, s) };
  });
}

/** Ideas that most need practice: fading first, then weakest practiced, then a few new ones. */
export function reviewPicks(meta: DocMeta | undefined, body: DocBody, max = 5): IdeaNode[] {
  const all = Object.values(body.map || {}).flatMap((m) => m.ideas);
  const st = (i: IdeaNode) => meta?.ideas?.[i.id];
  const fading = all.filter((i) => isFading(st(i))).sort((a, b) => strength(st(a)) - strength(st(b)));
  const weak = all.filter((i) => st(i)?.n && !isFading(st(i)) && strength(st(i)) < LIT).sort((a, b) => strength(st(a)) - strength(st(b)));
  const fresh = all.filter((i) => !st(i)?.n);
  const out: IdeaNode[] = [];
  for (const i of [...fading, ...weak, ...fresh]) if (out.length < max && !out.includes(i)) out.push(i);
  return out;
}
