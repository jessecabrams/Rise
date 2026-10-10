import { useSyncExternalStore } from 'react';

/** The on-device "offline answers" pack: a small embedding model for grading and Whisper for voice answers. */

const FLAG = 'rise-offline-answers-v1';
export const ANSWER_PACK_MB = 105;

export interface PackState {
  status: 'none' | 'downloading' | 'ready' | 'error';
  pct: number;
  error: string;
}

let state: PackState = { status: readFlag() ? 'ready' : 'none', pct: 0, error: '' };
const subs = new Set<() => void>();
function set(p: Partial<PackState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function usePack(): PackState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state
  );
}

export const packReady = () => state.status === 'ready';

/* ---------- worker plumbing ---------- */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; onProgress?: (p: any) => void }>();

function w(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.(m);
    else {
      pending.delete(m.id);
      if (m.type === 'done') p.res(m.result);
      else p.rej(new Error(m.error || 'The on-device model stopped unexpectedly.'));
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.rej(new Error(e.message || 'The on-device model could not start.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call<T>(msg: any, onProgress?: (p: any) => void, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej, onProgress });
    w().postMessage({ ...msg, id }, transfer);
  });
}

/** Downloads both models (needs a connection once). */
export async function downloadAnswerPack() {
  if (state.status === 'downloading') return;
  set({ status: 'downloading', pct: 0, error: '' });
  const files = new Map<string, { loaded: number; total: number }>();
  const onProgress = (p: any) => {
    files.set(`${p.which}/${p.file}`, { loaded: p.loaded, total: p.total });
    let loaded = 0;
    for (const f of files.values()) loaded += f.loaded;
    set({ pct: Math.min(0.99, loaded / (ANSWER_PACK_MB * 1e6)) });
  };
  try {
    await call({ type: 'load', which: 'embed' }, onProgress);
    await call({ type: 'load', which: 'asr' }, onProgress);
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      /* storage blocked */
    }
    set({ status: 'ready', pct: 1 });
  } catch (e: any) {
    set({ status: 'error', error: friendly(e.message) });
  }
}

export async function removeAnswerPack() {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  const { purgeCache } = await import('./localtts');
  await purgeCache(/all-MiniLM|whisper/i);
  worker?.terminate();
  worker = null;
  set({ status: 'none', pct: 0, error: '' });
}

function friendly(msg: string) {
  if (/fetch|network|Failed/i.test(msg)) return 'The download needs a connection. Try again when you have signal.';
  return msg;
}

export function embed(texts: string[]): Promise<number[][]> {
  return call<number[][]>({ type: 'embed', texts });
}

export const cosine = (a: number[] | Float32Array, b: number[] | Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Decodes recorded audio to 16 kHz mono and transcribes it on the device. */
export async function transcribeLocal(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  ctx.close().catch(() => {});
  const frames = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, frames), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const audio = rendered.getChannelData(0).slice();
  return call<string>({ type: 'transcribe', audio }, undefined, [audio.buffer]);
}
