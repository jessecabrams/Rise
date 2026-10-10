import { buildPrompt, clip, parseJson, type AiTask } from '../../api/_prompts';
import { api, server } from './api';
import { isNetworkError, isOnline, noteNetworkFailure } from './online';
import { gradeOffline } from './grader';
import { coachChat, coachReady } from './localllm';
import { packReady } from './localml';

let samplerPromise: Promise<any> | null = null;

/** Inside the Claude app preview, Rise can borrow Claude through the page's `sample` capability. */
function sampler(): Promise<any> {
  if (!samplerPromise) {
    const c = (window as any).claude;
    samplerPromise = c?.use ? Promise.resolve(c.use('sample')).catch(() => null) : Promise.resolve(null);
  }
  return samplerPromise;
}

export type AiRoute = 'server' | 'claude' | null;

export async function aiRoute(): Promise<AiRoute> {
  if (server.has('ai')) return 'server';
  return (await sampler()) ? 'claude' : null;
}

/** Thrown when something needs the full coach and the device is offline. */
export class OfflineError extends Error {
  offline = true;
}

export const isOfflineError = (e: unknown): e is OfflineError => !!(e as any)?.offline;

export async function runAi<T>(task: AiTask, payload: unknown): Promise<T> {
  if (!isOnline()) return runOffline<T>(task, payload);
  const route = await aiRoute();
  try {
    if (route === 'server') {
      const r = await api<{ result: T }>('/api/ai', { method: 'POST', body: { task, payload } });
      return r.result;
    }
    if (route === 'claude') {
      const s = await sampler();
      const p = buildPrompt(task, payload);
      const r = await s([{ role: 'user', content: `${p.system}\n\n${p.user}` }], {
        modelTier: p.tier === 'fast' ? 'quick' : 'default'
      });
      return parseJson<T>(r.text);
    }
  } catch (e) {
    if (isNetworkError(e)) {
      noteNetworkFailure();
      return runOffline<T>(task, payload);
    }
    throw e;
  }
  if (!server.state.reachable && (packReady() || coachReady())) return runOffline<T>(task, payload);
  throw new Error('The learning coach needs an AI key. Add ANTHROPIC_API_KEY in your Vercel settings, then reopen Rise.');
}

const LOCAL_SYSTEM = 'You are Rise, a warm, direct learning coach. Short sentences. Plain words. Never use em dashes.';

async function runOffline<T>(task: AiTask, p: any): Promise<T> {
  if (task === 'grade') {
    if (!packReady() && !coachReady()) throw new OfflineError('Grading offline needs the offline answers download. Turn it on in Settings while you have signal.');
    if (packReady()) return (await gradeOffline({ question: p.question, answer: p.answer, keyPoints: p.keyPoints || [], idealAnswer: p.idealAnswer || '' })) as T;
  }
  if ((task === 'grade' || task === 'exercise') && coachReady()) {
    const raw = await coachChat(
      `${LOCAL_SYSTEM} Judge understanding, not wording. Reply with JSON only.`,
      `${task === 'exercise' ? `EXERCISE: ${p.prompt}` : `QUESTION: ${p.question}\nA STRONG ANSWER SHOWS: ${(p.keyPoints || []).join(' | ')}`}
${p.text ? `MATERIAL: ${clip(p.text, 3000)}` : ''}
MY RESPONSE: ${p.answer || p.response}
Return {"score": 0-100, "feedback": "2-3 short sentences, specific and encouraging", "gotRight": ["short phrase"], "missing": ["short phrase"]}`,
      { json: true, maxTokens: 350 }
    );
    const r = parseJson<any>(raw);
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    return {
      score,
      verdict: score >= 90 ? 'nailed' : score >= 70 ? 'solid' : score >= 40 ? 'partial' : 'missed',
      gotRight: r.gotRight || [],
      missing: r.missing || [],
      feedback: `${r.feedback || ''} On-device coach. The full coach reviews it when you are back online.`,
      followUp: '',
      offline: true
    } as T;
  }
  if (task === 'quiz' && coachReady()) {
    const raw = await coachChat(
      `${LOCAL_SYSTEM} Reply with JSON only.`,
      `Write ${Math.min(p.count || 3, 4)} open-ended questions that test understanding of this material.
${p.ideas?.length ? `Each question tests one of these ideas. Set ideaId to its id: ${p.ideas.map((i: any) => `${i.id}: ${i.title}`).join('; ')}` : ''}
MATERIAL: ${clip(p.text, 3500)}
Return {"questions": [{"kind": "explain", "question": "...", "idealAnswer": "1-2 sentences", "keyPoints": ["2-3 short phrases"], "ideaId": "id or empty"}]}`,
      { json: true, maxTokens: 900 }
    );
    return parseJson<T>(raw);
  }
  if (task === 'exercise') throw new OfflineError('saved');
  throw new OfflineError(
    task === 'quiz'
      ? 'This part is not downloaded for offline. Download it while you have signal, or turn on the on-device coach in Settings.'
      : 'Building maps, guides and new exercises needs a connection. Everything you already built still works offline.'
  );
}
