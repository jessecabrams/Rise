import { useSyncExternalStore } from 'react';

/** Optional on-device coach: a small language model that runs in the browser with WebGPU. */

export const COACH_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Light', size: '0.9 GB', note: 'Best for phones. Quick, simpler feedback.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Strong', size: '2.3 GB', note: 'Best for laptops. Clearer, more useful feedback.' }
] as const;

const KEY = 'rise-offline-coach';

export interface CoachState {
  model: string | null; // downloaded model id
  status: 'none' | 'downloading' | 'ready' | 'loading' | 'error';
  pct: number;
  text: string;
  error: string;
}

function saved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let state: CoachState = { model: saved(), status: saved() ? 'ready' : 'none', pct: 0, text: '', error: '' };
const subs = new Set<() => void>();
function set(p: Partial<CoachState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

export function useCoach(): CoachState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state
  );
}

export const coachReady = () => !!state.model && (state.status === 'ready' || state.status === 'loading');

export function webgpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let engine: any = null;
let engineModel = '';
let loading: Promise<any> | null = null;

async function getEngine(model: string, onProgress?: (pct: number, text: string) => void) {
  if (engine && engineModel === model) return engine;
  if (loading) return loading;
  loading = (async () => {
    const webllm = await import('@mlc-ai/web-llm');
    if (engine) {
      try {
        await engine.unload();
      } catch {
        /* already gone */
      }
    }
    const worker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), { type: 'module' });
    engine = await webllm.CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (r: any) => onProgress?.(r.progress ?? 0, r.text ?? '')
    });
    engineModel = model;
    return engine;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function downloadCoach(model: string) {
  if (!webgpuSupported()) {
    set({ status: 'error', error: 'This browser cannot run an on-device coach. It needs WebGPU: recent Chrome or Edge on a computer, Chrome on Android, or Safari on iOS 26 or later.' });
    return;
  }
  set({ status: 'downloading', pct: 0, text: '', error: '' });
  try {
    await getEngine(model, (pct, text) => set({ pct, text }));
    try {
      localStorage.setItem(KEY, model);
    } catch {
      /* storage blocked */
    }
    set({ model, status: 'ready', pct: 1 });
  } catch (e: any) {
    set({ status: 'error', error: /fetch|network/i.test(e?.message || '') ? 'The download needs a connection. Try again when you have signal.' : e?.message || 'The coach could not load on this device.' });
  }
}

export async function removeCoach() {
  const model = state.model;
  try {
    if (engine) await engine.unload();
  } catch {
    /* ignore */
  }
  engine = null;
  engineModel = '';
  if (model) {
    try {
      const webllm = await import('@mlc-ai/web-llm');
      await webllm.deleteModelAllInfoInCache(model);
    } catch {
      /* nothing cached */
    }
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  set({ model: null, status: 'none', pct: 0, text: '', error: '' });
}

/** Runs a prompt on the on-device coach. `json` asks the model for a JSON object. */
export async function coachChat(system: string, user: string, opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  if (!state.model) throw new Error('No on-device coach is downloaded.');
  const wasReady = state.status === 'ready';
  if (!engine) set({ status: 'loading', text: 'Waking up the on-device coach…' });
  try {
    const eng = await getEngine(state.model, (pct, text) => set({ pct, text }));
    if (wasReady) set({ status: 'ready' });
    const r = await eng.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 500,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    });
    return r.choices?.[0]?.message?.content || '';
  } finally {
    if (state.status === 'loading') set({ status: 'ready' });
  }
}
