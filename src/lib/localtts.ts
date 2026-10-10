import { useSyncExternalStore } from 'react';

/** The Natural voice: a neural voice that runs on the device, so everything can be read aloud offline. */

const FLAG = 'rise-natural-voice-v1';
export const NATURAL_MB = 95;

export const NATURAL_VOICES = [
  { id: 'af_heart', name: 'Heart', desc: 'Warm, expressive. American.' },
  { id: 'af_bella', name: 'Bella', desc: 'Bright and friendly. American.' },
  { id: 'am_michael', name: 'Michael', desc: 'Calm and grounded. American.' },
  { id: 'am_fenrir', name: 'Fenrir', desc: 'Deep and steady. American.' },
  { id: 'bf_emma', name: 'Emma', desc: 'Clear and composed. British.' },
  { id: 'bm_george', name: 'George', desc: 'Classic narrator. British.' }
];

export interface NaturalState {
  status: 'none' | 'downloading' | 'ready' | 'error';
  pct: number;
  error: string;
}

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

let state: NaturalState = { status: readFlag() ? 'ready' : 'none', pct: 0, error: '' };
const subs = new Set<() => void>();
function set(p: Partial<NaturalState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

export function useNatural(): NaturalState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state
  );
}

export const neuralReady = () => state.status === 'ready';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; onProgress?: (p: any) => void }>();

function w(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.(m);
    else {
      pending.delete(m.id);
      m.type === 'done' ? p.res(m.result) : p.rej(new Error(m.error || 'The Natural voice stopped unexpectedly.'));
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.rej(new Error(e.message || 'The Natural voice could not start.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call<T>(msg: any, onProgress?: (p: any) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej, onProgress });
    w().postMessage({ ...msg, id });
  });
}

export async function downloadNatural() {
  if (state.status === 'downloading') return;
  set({ status: 'downloading', pct: 0, error: '' });
  const files = new Map<string, number>();
  try {
    await call(
      { type: 'load' },
      (p) => {
        files.set(p.file, p.loaded);
        let loaded = 0;
        for (const v of files.values()) loaded += v;
        set({ pct: Math.min(0.9, loaded / (NATURAL_MB * 1e6)) });
      }
    );
    set({ pct: 0.92 });
    await call({ type: 'warm', voices: NATURAL_VOICES.map((v) => v.id) });
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      /* storage blocked */
    }
    set({ status: 'ready', pct: 1 });
  } catch (e: any) {
    set({ status: 'error', error: /fetch|network/i.test(e?.message || '') ? 'The download needs a connection. Try again when you have signal.' : e?.message || 'The Natural voice could not load on this device.' });
  }
}

export async function removeNatural() {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  await purgeCache(/Kokoro/i, ['kokoro-voices']);
  worker?.terminate();
  worker = null;
  set({ status: 'none', pct: 0, error: '' });
}

/** Speaks one sentence with the Natural voice. Returns WAV audio. */
export function neuralSpeak(text: string, voice: string): Promise<Blob> {
  if (!neuralReady()) return Promise.reject(new Error('The Natural voice is not downloaded.'));
  return call<Blob>({ type: 'speak', text, voice });
}

/** Deletes cached model files whose URL matches, and whole caches by name. */
export async function purgeCache(match: RegExp, wholeCaches: string[] = []) {
  try {
    for (const name of await caches.keys()) {
      if (wholeCaches.includes(name)) {
        await caches.delete(name);
        continue;
      }
      if (!name.includes('transformers')) continue;
      const c = await caches.open(name);
      for (const req of await c.keys()) if (match.test(req.url)) await c.delete(req);
    }
  } catch {
    /* nothing cached */
  }
}
