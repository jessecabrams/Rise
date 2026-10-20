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
  stage: string;
}

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

let state: NaturalState = { status: readFlag() ? 'ready' : 'none', pct: 0, error: '', stage: '' };
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

/* ---------- a small pool of voice workers ---------- */
// On a computer, two or three workers run side by side so the next sentences are ready before they're needed.
// On a phone, one is all it can manage.

/** True on iPhone and iPad, where the Natural voice is usually too heavy to run. */
export const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const POOL = (() => {
  if (typeof navigator === 'undefined' || isIOS() || /Android/i.test(navigator.userAgent)) return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
})();

export interface NeuralClip {
  mime: string;
  bytes: ArrayBuffer;
}

interface Job {
  seq: number;
  pri: number;
  msg: any;
  res: (v: any) => void;
  rej: (e: Error) => void;
  onProgress?: (p: any) => void;
  timeout?: number;
}

interface Slot {
  w: Worker;
  busy: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const slots: Slot[] = [];
const queue: Job[] = [];
let seq = 0;

function spawn(i: number): Slot {
  const w = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  const slot: Slot = { w, busy: null, timer: null };
  w.onmessage = (e) => {
    const m = e.data;
    const job = slot.busy;
    if (!job || m.id !== job.seq) return;
    if (m.type === 'progress') return job.onProgress?.(m);
    if (slot.timer) clearTimeout(slot.timer);
    slot.busy = null;
    m.type === 'done' ? job.res(m.result) : job.rej(new Error(m.error || 'The Natural voice stopped unexpectedly.'));
    pump();
  };
  w.onerror = (e) => {
    const job = slot.busy;
    restart(i, e.message || 'The Natural voice could not start.');
    job?.rej(new Error(e.message || 'The Natural voice could not start.'));
  };
  slots[i] = slot;
  return slot;
}

function restart(i: number, reason: string) {
  const s = slots[i];
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.w.terminate();
  const job = s.busy;
  s.busy = null;
  spawn(i);
  job?.rej(new Error(reason));
  pump();
}

function pump() {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || s.busy || !queue.length) continue;
    queue.sort((a, b) => a.pri - b.pri || a.seq - b.seq);
    const job = queue.shift()!;
    s.busy = job;
    if (job.timeout) s.timer = setTimeout(() => restart(i, job.timeout === TEST_MS ? SLOW : 'The Natural voice took too long.'), job.timeout);
    s.w.postMessage({ ...job.msg, id: job.seq });
  }
}

function run<T>(msg: any, pri: number, opts: { onProgress?: (p: any) => void; timeout?: number; size?: number } = {}): Promise<T> {
  const want = opts.size ?? POOL;
  for (let i = 0; i < want; i++) if (!slots[i]) spawn(i);
  return new Promise<T>((res, rej) => {
    queue.push({ seq: ++seq, pri, msg, res, rej, onProgress: opts.onProgress, timeout: opts.timeout });
    pump();
  });
}

/** How many sentences this device is still working through, per worker. */
export function localBacklog(): number {
  const busy = slots.filter((s) => s?.busy).length;
  return (queue.length + busy) / Math.max(1, POOL);
}

/** Drops sentences queued ahead of time, for example after you jump to another chapter. */
export function clearPrefetch() {
  for (let k = queue.length - 1; k >= 0; k--) {
    if (queue[k].pri > 0) queue.splice(k, 1)[0].rej(new Error('skipped'));
  }
}

function stopAll(reason: string) {
  for (const j of queue.splice(0)) j.rej(new Error(reason));
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s) continue;
    if (s.timer) clearTimeout(s.timer);
    s.w.terminate();
    s.busy?.rej(new Error(reason));
  }
  slots.length = 0;
}

let warmed: Promise<unknown> | null = null;
/** Loads the voice in the background so the first sentence starts right away. */
export function prewarmNatural() {
  if (!neuralReady() || isIOS() || warmed) return;
  warmed = Promise.all(Array.from({ length: POOL }, () => run({ type: 'load' }, -1).catch(() => {}))).catch(() => {});
}

/** Can this device make Natural voice audio itself, fast enough to keep up? */
export const localNatural = () => neuralReady() && !isIOS();

const TEST_MS = 60_000;

const VOICE_URL = (id: string) => `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${id}.bin`;

/** Saves each voice file in the same cache the voice engine reads, without running the model. */
async function cacheVoices(onEach: (n: number) => void) {
  const cache = await caches.open('kokoro-voices');
  let n = 0;
  for (const v of NATURAL_VOICES) {
    const url = VOICE_URL(v.id);
    if (!(await cache.match(url))) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Voice file failed (${r.status}).`);
      await cache.put(url, r);
    }
    onEach(++n);
  }
}

const SLOW = 'The Natural voice downloaded, but this device runs it too slowly to use. On iPhone, Apple\'s Premium voices are the better choice. The Natural voice works well on a Mac.';

export async function downloadNatural() {
  if (state.status === 'downloading') return;
  set({ status: 'downloading', pct: 0, error: '', stage: 'Downloading the voice model…' });
  const files = new Map<string, number>();
  try {
    await run(
      { type: 'load' },
      -1,
      {
        size: 1,
        onProgress: (p) => {
          files.set(p.file, p.loaded);
          let loaded = 0;
          for (const v of files.values()) loaded += v;
          set({ pct: Math.min(0.85, loaded / (NATURAL_MB * 1e6)) });
        }
      }
    );
    set({ pct: 0.86, stage: 'Downloading the six voices…' });
    await cacheVoices((n) => set({ pct: 0.86 + (n / NATURAL_VOICES.length) * 0.08 }));
    set({ pct: 0.95, stage: 'Testing it on this device…' });
    const started = performance.now();
    await run({ type: 'speak', text: 'Ready.', voice: 'af_heart' }, -1, { size: 1, timeout: TEST_MS });
    const ms = performance.now() - started;
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      /* storage blocked */
    }
    set({ status: 'ready', pct: 1, stage: ms > 20_000 ? 'Works, but slowly on this device. Each sentence may take a few seconds to start.' : '' });
  } catch (e: any) {
    const msg = e?.message || '';
    if (msg === 'Stopped.') return;
    set({
      status: 'error',
      stage: '',
      error: /fetch|network|Load failed/i.test(msg) ? 'The download needs a connection. Try again when you have signal.' : msg === SLOW ? SLOW : msg || 'The Natural voice could not load on this device.'
    });
  }
}

/** Stops a download or test that is taking too long. */
export function stopNatural() {
  stopAll('Stopped.');
  set({ status: 'none', pct: 0, error: '', stage: '' });
}

export async function removeNatural() {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  await purgeCache(/Kokoro/i, ['kokoro-voices']);
  stopAll('Removed.');
  warmed = null;
  set({ status: 'none', pct: 0, error: '', stage: '' });
}

/** Makes one sentence of Natural voice audio on this device. `pri` 0 is needed now; higher numbers are read-ahead. */
export function neuralSpeak(text: string, voice: string, pri = 0): Promise<NeuralClip> {
  if (!neuralReady()) return Promise.reject(new Error('The Natural voice is not downloaded.'));
  return run<NeuralClip>({ type: 'speak', text, voice }, pri, { timeout: 45_000 });
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
