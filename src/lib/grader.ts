import type { Grade } from './types';
import { cosine, embed } from './localml';
import { coachChat, coachReady } from './localllm';
import { splitSentences } from './text';
import { parseJson } from '../../api/_prompts';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ramp = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo));

const FEEDBACK: Record<Grade['verdict'], string> = {
  nailed: "You covered the heart of it. That's understanding, not just recognition.",
  solid: 'Strong. Most of it is there. Add the piece below and it is complete.',
  partial: 'The shape is there. A few key pieces are missing. Check the list below, then say it again.',
  missed: 'Not there yet, and that is useful to know. Hear the passage again, then explain it in your own words.'
};

export const verdictFor = (score: number): Grade['verdict'] => (score >= 90 ? 'nailed' : score >= 70 ? 'solid' : score >= 40 ? 'partial' : 'missed');

const OFFLINE_NOTE = 'Quick offline check. The full coach reviews it when you are back online.';

/**
 * Grades an answer on the device. Measures how much of each key point the answer covers
 * using sentence embeddings, then (if the on-device coach is downloaded) asks it for feedback.
 */
export async function gradeOffline(a: { question: string; answer: string; keyPoints: string[]; idealAnswer: string }): Promise<Grade> {
  const points = (a.keyPoints.length ? a.keyPoints : splitSentences(a.idealAnswer).slice(0, 4)).filter(Boolean);
  const target = points.length ? points : [a.question];
  const sents = splitSentences(a.answer);
  const chunks = [a.answer, ...sents, ...sents.slice(1).map((s, i) => `${sents[i]} ${s}`)].filter((x) => x.trim());
  const vecs = await embed([...target, a.idealAnswer || target.join(' '), ...chunks]);
  const pv = vecs.slice(0, target.length);
  const iv = vecs[target.length];
  const cv = vecs.slice(target.length + 1);
  const cover = pv.map((p) => ramp(Math.max(...cv.map((c) => cosine(p, c))), 0.32, 0.64));
  const avgCover = cover.reduce((x, y) => x + y, 0) / cover.length;
  const idealSim = ramp(cosine(iv, cv[0]), 0.3, 0.75);
  let score = Math.round(100 * (0.7 * avgCover + 0.3 * idealSim));
  const words = (a.answer.match(/\S+/g) || []).length;
  if (words < 5) score = Math.min(score, 20);
  else if (words < 12) score = Math.min(score, 70);

  const gotRight = target.filter((_, i) => cover[i] >= 0.7);
  const missing = target.filter((_, i) => cover[i] < 0.5);
  let feedback = FEEDBACK[verdictFor(score)];

  if (coachReady()) {
    try {
      const raw = await coachChat(
        'You are a warm, direct learning coach. Judge understanding, not wording. Reply with JSON only. No em dashes.',
        `QUESTION: ${a.question}\nA STRONG ANSWER SHOWS: ${target.join(' | ')}\nMY ANSWER: ${a.answer}\nReturn {"score": 0-100, "feedback": "2 short sentences, specific to my answer"}`,
        { json: true, maxTokens: 220 }
      );
      const r = parseJson<{ score: number; feedback: string }>(raw);
      if (typeof r.score === 'number') score = Math.round(clamp(0.5 * score + 0.5 * r.score, 0, 100));
      if (r.feedback) feedback = r.feedback;
    } catch {
      /* keep the embedding grade */
    }
  }

  return {
    score: clamp(score, 0, 100),
    verdict: verdictFor(score),
    gotRight,
    missing,
    feedback: `${feedback} ${OFFLINE_NOTE}`,
    followUp: '',
    offline: true
  } as Grade;
}
