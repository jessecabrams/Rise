import type { CoachReview, DocBody, Grade, PendingReview } from './types';
import { getBody, getState, patchDoc, saveBody } from './store';
import { runAi } from './ai';
import { adjustIdea } from './mastery';
import { celebrate } from './game';
import { isOnline } from './online';
import { server } from './api';
import { uid } from './text';

/** Queues an offline answer for the full coach. `update` is the open document's body updater. */
export function queueReview(docId: string, update: (fn: (b: DocBody) => DocBody) => void, item: Omit<PendingReview, 'id' | 'at'>) {
  const full: PendingReview = { ...item, id: uid(), at: Date.now() };
  let count = 0;
  update((b) => {
    const pending = [...(b.pending || []), full].slice(-60);
    count = pending.length;
    return { ...b, pending };
  });
  patchDoc(docId, (d) => (d.pending = count));
}

let running = false;

/** Sends offline answers to the full coach once the device is back online. */
export async function processAllPending() {
  if (running || !isOnline() || !server.has('ai')) return;
  running = true;
  let total = 0;
  try {
    for (const meta of Object.values(getState().docs)) {
      if (meta.pending) total += await processDoc(meta.id);
    }
  } finally {
    running = false;
  }
  if (total) celebrate({ kind: 'note', text: `The coach reviewed ${total} offline ${total === 1 ? 'answer' : 'answers'}. See them in Quiz.` });
}

async function processDoc(docId: string): Promise<number> {
  const body = await getBody(docId);
  if (!body?.pending?.length) {
    patchDoc(docId, (d) => (d.pending = 0));
    return 0;
  }
  const left: PendingReview[] = [];
  const reviews: CoachReview[] = [];
  let lessons = body.lessons;
  for (const item of body.pending) {
    try {
      const g = await runAi<Grade>(item.kind === 'exercise' ? 'exercise' : 'grade', item.payload);
      if (g.offline) {
        left.push(item);
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(g.score)));
      if (item.kind === 'grade' && item.ideaId && typeof item.offlineScore === 'number') adjustIdea(docId, item.ideaId, item.offlineScore, score);
      if (item.kind === 'exercise' && item.lessonId && item.exerciseId) {
        lessons = lessons.map((l) =>
          l.id !== item.lessonId ? l : { ...l, exercises: l.exercises.map((e) => (e.id === item.exerciseId ? { ...e, lastScore: score, lastFeedback: g.feedback } : e)) }
        );
      }
      reviews.push({ id: item.id, at: Date.now(), label: item.label, answer: item.answer, offlineScore: item.offlineScore, score, feedback: g.feedback, missing: g.missing || [] });
    } catch {
      left.push(item);
    }
  }
  const next: DocBody = { ...body, lessons, pending: left, reviews: [...reviews, ...(body.reviews || [])].slice(0, 30) };
  await saveBody(next);
  patchDoc(docId, (d) => (d.pending = left.length));
  window.dispatchEvent(new CustomEvent('rise-body', { detail: docId }));
  return reviews.length;
}
