import { useSyncExternalStore } from 'react';
import { getState } from './store';
import { api, server } from './api';
import { wordAt } from './text';
import { createStore, get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { isOnline } from './online';
import { neuralReady, neuralSpeak } from './localtts';

let audioStore: ReturnType<typeof createStore> | null = null;
const clipStore = () => (audioStore ||= createStore('rise-audio', 'clips'));
interface StoredClip {
  mime: string;
  bytes: ArrayBuffer;
  starts: number[] | null;
}

/* ---------- device voices ---------- */
export function deviceVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const all = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const score = (v: SpeechSynthesisVoice) =>
    (/(premium|enhanced|natural|neural)/i.test(v.name) ? 4 : 0) +
    (/(siri|google|samantha|ava|zoe|evan|nathan|allison|aria|jenny|guy)/i.test(v.name) ? 2 : 0) +
    (v.lang === 'en-US' ? 1 : 0);
  return all.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export function onVoicesChanged(fn: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => {};
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}

function pickDeviceVoice(): SpeechSynthesisVoice | undefined {
  const want = getState().settings.deviceVoice;
  const list = deviceVoices();
  return list.find((v) => v.name === want) || list[0];
}

/* ---------- cloud clips ---------- */
interface Clip {
  url: string;
  starts: number[] | null;
}

interface Voice {
  provider: 'openai' | 'elevenlabs' | 'neural';
  voice: string;
  style: string;
}

/** The natural on-device voice, if it is downloaded. */
function neuralVoice(): Voice | null {
  return neuralReady() ? { provider: 'neural', voice: getState().settings.neuralVoice || 'af_heart', style: '' } : null;
}

function cloudVoice(): Voice | null {
  const s = getState().settings;
  if (s.provider === 'neural') return neuralVoice();
  // Offline, keep the chosen studio voice so downloaded audio still plays.
  const offline = !isOnline() || !server.state.reachable;
  if (s.provider === 'openai' && (server.has('openai') || offline)) return { provider: 'openai', voice: s.openaiVoice, style: s.voiceStyle };
  if (s.provider === 'elevenlabs' && (server.has('elevenlabs') || offline)) return { provider: 'elevenlabs', voice: s.elevenVoice, style: '' };
  return null;
}

/** Voices to try in order. The natural on-device voice backs up studio voices when they can't be reached. */
function voiceChain(): Voice[] {
  const main = cloudVoice();
  const nv = neuralVoice();
  return [main, main?.provider !== 'neural' ? nv : null].filter(Boolean) as Voice[];
}

/** Identifies the current studio voice, or null when there is nothing to download (device or on-device voices). */
export function voiceKey(): string | null {
  const v = cloudVoice();
  return v && v.provider !== 'neural' ? `${v.provider}|${v.voice}|${v.style}` : null;
}

/** How spoken text is split into clips. Downloads and playback must agree. */
export function sayChunks(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).map((c) => c.trim()).filter(Boolean);
}

const clips = new Map<string, Promise<Clip>>();

function fetchClip(text: string, persist = false, v: Voice = cloudVoice()!): Promise<Clip> {
  const key = `${v.provider}|${v.voice}|${v.style}|${text}`;
  const hit = clips.get(key);
  if (hit) return hit;
  const p = (async (): Promise<Clip> => {
    if (v.provider === 'neural') {
      const wav = await neuralSpeak(text, v.voice);
      return { url: URL.createObjectURL(wav), starts: null };
    }
    let stored: StoredClip | undefined;
    try {
      stored = await idbGet<StoredClip>(key, clipStore());
    } catch {
      stored = undefined;
    }
    if (stored) return { url: URL.createObjectURL(new Blob([stored.bytes], { type: stored.mime })), starts: stored.starts };
    if (!isOnline() || !server.ok()) throw new Error('offline');
    const r = await api<{ audio: string; mime: string; starts: number[] | null }>('/api/tts', {
      method: 'POST',
      body: { text, provider: v.provider, voice: v.voice, style: v.style }
    });
    const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
    if (persist) {
      try {
        await idbSet(key, { mime: r.mime, bytes: bytes.buffer, starts: r.starts } as StoredClip, clipStore());
      } catch {
        /* storage full */
      }
    }
    return { url: URL.createObjectURL(new Blob([bytes], { type: r.mime })), starts: r.starts };
  })();
  p.catch(() => clips.delete(key));
  clips.set(key, p);
  if (clips.size > 60) {
    const oldest = clips.keys().next().value as string;
    clips.get(oldest)?.then((c) => URL.revokeObjectURL(c.url)).catch(() => {});
    clips.delete(oldest);
  }
  return p;
}

/* ---------- player ---------- */
export interface PlayerState {
  docId: string | null;
  title: string;
  playing: boolean;
  loading: boolean;
  index: number;
  total: number;
  word: [number, number] | null;
  engine: 'device' | 'cloud';
  error: string | null;
}

export interface HeardEvent {
  docId: string;
  index: number;
  words: number;
  ms: number;
  rate: number;
}

class Player {
  s: PlayerState = { docId: null, title: '', playing: false, loading: false, index: 0, total: 0, word: null, engine: 'device', error: null };
  sentences: string[] = [];
  private subs = new Set<() => void>();
  private heardSubs = new Set<(e: HeardEvent) => void>();
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private raf = 0;
  private startedAt = 0;
  private clip: Clip | null = null;

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  };
  onHeard(f: (e: HeardEvent) => void) {
    this.heardSubs.add(f);
    return () => {
      this.heardSubs.delete(f);
    };
  }
  private set(patch: Partial<PlayerState>) {
    this.s = { ...this.s, ...patch };
    this.subs.forEach((f) => f());
  }

  load(docId: string, title: string, sentences: string[], index: number) {
    if (this.s.docId === docId && this.sentences === sentences) return;
    this.stopAll();
    this.sentences = sentences;
    this.set({ docId, title, index: Math.min(index, Math.max(0, sentences.length - 1)), total: sentences.length, playing: false, word: null, error: null });
  }

  close() {
    this.stopAll();
    this.sentences = [];
    this.set({ docId: null, title: '', playing: false, total: 0, index: 0, word: null });
  }

  play(index = this.s.index) {
    if (!this.sentences.length) return;
    this.stopAll();
    const tok = ++this.token;
    this.setupMediaSession();
    this.set({ playing: true, error: null });
    this.speak(index, tok);
  }

  pause() {
    this.stopAll();
    this.set({ playing: false, loading: false });
  }

  toggle() {
    this.s.playing ? this.pause() : this.play();
  }

  seek(index: number) {
    const i = Math.max(0, Math.min(index, this.sentences.length - 1));
    if (this.s.playing) this.play(i);
    else this.set({ index: i, word: null });
  }

  next() {
    this.seek(this.s.index + 1);
  }
  prev() {
    this.seek(this.s.index - 1);
  }

  applyRate() {
    const rate = getState().settings.rate;
    if (this.audio) this.audio.playbackRate = rate;
    if (this.s.playing && this.s.engine === 'device') this.play(this.s.index);
  }

  /** Restart the current sentence with whatever voice settings are now active. */
  refreshVoice() {
    if (this.s.playing) this.play(this.s.index);
  }

  private stopAll() {
    this.token++;
    cancelAnimationFrame(this.raf);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
    }
  }

  private speak(i: number, tok: number) {
    if (i >= this.sentences.length) {
      this.set({ playing: false, word: null, index: this.sentences.length - 1 });
      return;
    }
    this.set({ index: i, word: null });
    this.startedAt = performance.now();
    if (cloudVoice()) this.speakCloud(i, tok);
    else this.speakDevice(i, tok);
  }

  private speakDevice(i: number, tok: number) {
    if (typeof speechSynthesis === 'undefined') {
      this.set({ playing: false, error: 'This browser cannot read aloud. Try Chrome, Edge or Safari.' });
      return;
    }
    this.set({ engine: 'device', loading: false });
    const text = this.sentences[i];
    const u = new SpeechSynthesisUtterance(text);
    const v = pickDeviceVoice();
    if (v) u.voice = v;
    u.rate = Math.min(3, Math.max(0.5, getState().settings.rate));
    u.onboundary = (e) => {
      if (tok !== this.token || e.name !== 'word') return;
      const w = wordAt(text, e.charIndex);
      if (w) this.set({ word: w });
    };
    u.onend = () => {
      if (tok === this.token) this.done(i, tok);
    };
    u.onerror = (e) => {
      if (tok !== this.token || e.error === 'interrupted' || e.error === 'canceled') return;
      this.set({ playing: false, error: `Reading stopped (${e.error}). Tap play to try again.` });
    };
    setTimeout(() => tok === this.token && speechSynthesis.speak(u), 30);
  }

  private async speakCloud(i: number, tok: number) {
    this.set({ engine: 'cloud', loading: true });
    let clip: Clip | null = null;
    let used: Voice | null = null;
    let failure = '';
    for (const v of voiceChain()) {
      try {
        clip = await fetchClip(this.sentences[i], false, v);
        used = v;
        break;
      } catch (e: any) {
        failure ||= e.message;
      }
      if (tok !== this.token) return;
    }
    if (tok !== this.token) return;
    if (!clip || !used) {
      this.set({
        error:
          failure === 'offline'
            ? "You're offline and this part isn't downloaded, so your device voice is reading it."
            : `Voice unavailable (${failure}). Using your device voice.`
      });
      this.speakDevice(i, tok);
      return;
    }
    const main = cloudVoice();
    if (used.provider === 'neural' && main?.provider !== 'neural' && !this.s.error) {
      this.set({ error: "You're offline and this part isn't downloaded, so the Natural voice on your device is reading it." });
    }
    if (tok !== this.token) return;
    this.clip = clip;
    if (!this.audio) this.audio = new Audio();
    const a = this.audio;
    a.src = clip.url;
    a.playbackRate = getState().settings.rate;
    (a as any).preservesPitch = true;
    a.onended = () => {
      if (tok === this.token) this.done(i, tok);
    };
    try {
      await a.play();
    } catch {
      if (tok === this.token) this.set({ playing: false, loading: false, error: 'Tap play to start audio.' });
      return;
    }
    this.set({ loading: false });
    const ahead = used.provider === 'neural' ? 2 : 3;
    for (let k = 1; k <= ahead; k++) if (this.sentences[i + k]) fetchClip(this.sentences[i + k], false, used).catch(() => {});
    const text = this.sentences[i];
    const tick = () => {
      if (tok !== this.token) return;
      const t = a.currentTime;
      let c = -1;
      if (clip.starts && clip.starts.length) {
        let lo = 0;
        let hi = clip.starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (clip.starts[mid] <= t) lo = mid;
          else hi = mid - 1;
        }
        c = lo;
      } else if (a.duration && isFinite(a.duration)) {
        c = Math.floor((t / a.duration) * text.length);
      }
      const w = c >= 0 ? wordAt(text, Math.min(c, text.length - 1)) : null;
      if (w && (!this.s.word || w[0] !== this.s.word[0])) this.set({ word: w });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private done(i: number, tok: number) {
    const words = (this.sentences[i].match(/\S+/g) || []).length;
    const e: HeardEvent = { docId: this.s.docId!, index: i, words, ms: performance.now() - this.startedAt, rate: getState().settings.rate };
    this.heardSubs.forEach((f) => f(e));
    this.speak(i + 1, tok);
  }

  private setupMediaSession() {
    const ms = (navigator as any).mediaSession;
    if (!ms || typeof (window as any).MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new (window as any).MediaMetadata({ title: this.s.title, artist: 'Rise · Jesse Abrams Coaching' });
      ms.setActionHandler('play', () => this.play());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('nexttrack', () => this.next());
      ms.setActionHandler('previoustrack', () => this.prev());
    } catch {
      /* unsupported */
    }
  }
}

export const player = new Player();

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, () => player.s);
}

/* ---------- one-off speech (questions, feedback, previews) ---------- */
let sayAudio: HTMLAudioElement | null = null;
let sayToken = 0;

export function stopSay() {
  sayToken++;
  if (sayAudio) sayAudio.pause();
  if (typeof speechSynthesis !== 'undefined' && !player.s.playing) speechSynthesis.cancel();
}

/** Speaks text with the current voice. Resolves when finished or stopped. */
export async function say(text: string): Promise<void> {
  if (player.s.playing) player.pause();
  stopSay();
  const tok = ++sayToken;
  const chunks = sayChunks(text);
  const chain = voiceChain();
  for (let k = 0; k < chunks.length; k++) {
    if (tok !== sayToken) return;
    let clip: Clip | null = null;
    for (const v of chain) {
      try {
        clip = await fetchClip(chunks[k], false, v);
        // Start preparing the next chunk while this one plays.
        if (chunks[k + 1]) fetchClip(chunks[k + 1], false, v).catch(() => {});
        break;
      } catch {
        /* try the next voice */
      }
    }
    if (tok !== sayToken) return;
    if (!clip) {
      await sayDevice(chunks.slice(k).join(' '));
      return;
    }
    if (!sayAudio) sayAudio = new Audio();
    sayAudio.src = clip.url;
    sayAudio.playbackRate = getState().settings.rate;
    try {
      await sayAudio.play();
    } catch {
      return;
    }
    await new Promise<void>((res) => {
      sayAudio!.onended = () => res();
      sayAudio!.onpause = () => res();
    });
  }
}

function sayDevice(text: string): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  return new Promise<void>((res) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickDeviceVoice();
    if (v) u.voice = v;
    u.rate = Math.min(3, Math.max(0.5, getState().settings.rate));
    u.onend = () => res();
    u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}

/** Saves studio-voice audio for every sentence so the piece plays offline. */
export async function downloadAudio(sentences: string[], onPct: (p: number) => void, cancel: { current: boolean }) {
  if (!voiceKey()) return;
  let next = 0;
  let done = 0;
  const work = async () => {
    while (next < sentences.length && !cancel.current) {
      const i = next++;
      const text = sentences[i];
      const key = `${voiceKey()}|${text}`;
      let have = false;
      try {
        have = !!(await idbGet(key, clipStore()));
      } catch {
        have = false;
      }
      if (!have) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            clips.delete(key);
            await fetchClip(text, true);
            break;
          } catch (e: any) {
            if (attempt === 2) throw e;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
      }
      onPct(++done / sentences.length);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}

/** Deletes downloaded studio-voice audio for these sentences. */
export async function removeAudio(sentences: string[], key: string) {
  for (const t of sentences) {
    try {
      await idbDel(`${key}|${t}`, clipStore());
    } catch {
      /* already gone */
    }
  }
}

/** Rough size of studio-voice audio: about 1 MB per minute of listening. */
export function audioEstimateMB(words: number): number {
  return Math.max(1, Math.round(words / 165));
}
