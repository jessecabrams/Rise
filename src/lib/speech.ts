import { crumb, safeMode } from './crumbs';
import { useSyncExternalStore } from 'react';
import { getState } from './store';
import { api, server } from './api';
import { wordAt } from './text';
import { createStore, get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { isOnline } from './online';
import { clearPrefetch, localNatural, neuralReady, neuralSpeak } from './localtts';

let audioStore: ReturnType<typeof createStore> | null = null;
const clipStore = () => (audioStore ||= createStore('rise-audio', 'clips'));
interface StoredClip {
  mime: string;
  bytes: ArrayBuffer;
  starts: number[] | null;
}

/* ---------- device voices ---------- */
/** Apple's joke voices. They only clutter the list. */
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|deranged|hysterical|pipe organ)$/i;
export function deviceVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const all = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en') && !NOVELTY.test(v.name.replace(/\s*\(.*\)$/, '')));
  const score = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name + ' ' + v.voiceURI) ? 6 : /(enhanced|natural|neural)/i.test(v.name + ' ' + v.voiceURI) ? 4 : 0) +
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

/** The Natural voice: made on this device, fetched from the cloud, or played from saved audio. */
function naturalVoice(): Voice {
  return { provider: 'neural', voice: getState().settings.neuralVoice || 'af_heart', style: '' };
}

/** Where new Natural voice audio can come from right now. */
export function naturalSource(): 'local' | 'cloud' | null {
  if (localNatural()) return 'local';
  if (server.has('kokoro') && isOnline()) return 'cloud';
  if (neuralReady()) return 'local';
  return null;
}

function cloudVoice(): Voice | null {
  // After two crashes in a row, read with the device voice until Rise runs smoothly again.
  if (safeMode) return null;
  const s = getState().settings;
  if (s.provider === 'neural') return naturalVoice();
  // Offline, keep the chosen studio voice so downloaded audio still plays.
  const offline = !isOnline() || !server.state.reachable;
  if (s.provider === 'openai' && (server.has('openai') || offline)) return { provider: 'openai', voice: s.openaiVoice, style: s.voiceStyle };
  if (s.provider === 'elevenlabs' && (server.has('elevenlabs') || offline)) return { provider: 'elevenlabs', voice: s.elevenVoice, style: '' };
  return null;
}

/** Voices to try in order. The Natural voice backs up studio voices when they can't be reached. */
function voiceChain(): Voice[] {
  const main = cloudVoice();
  const backup = main?.provider !== 'neural' && naturalSource() ? naturalVoice() : null;
  return [main, backup].filter(Boolean) as Voice[];
}

/** Identifies the current voice's saved audio, or null for device voices. */
export function voiceKey(): string | null {
  const v = cloudVoice();
  return v ? `${v.provider}|${v.voice}|${v.style}` : null;
}

/** Can audio for the current voice be downloaded right now? */
export function canDownloadAudio(): boolean {
  const v = cloudVoice();
  if (!v) return false;
  return v.provider === 'neural' ? !!naturalSource() : true;
}

/** How spoken text is split into clips. Downloads and playback must agree. */
export function sayChunks(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).map((c) => c.trim()).filter(Boolean);
}

const clips = new Map<string, Promise<Clip>>();
const ready = new Set<string>();
/** Set when this computer couldn't keep up, so the cloud helps with the next few sentences. */
let behindUntil = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function cloudClip(text: string, v: Voice): Promise<StoredClip> {
  crumb(`cloud request ${text.length} chars`);
  if (!isOnline() || !server.ok()) throw new Error('offline');
  const r = await api<{ audio: string; mime: string; starts: number[] | null }>('/api/tts', {
    method: 'POST',
    body: { text, provider: v.provider === 'neural' ? 'kokoro' : v.provider, voice: v.voice, style: v.style }
  });
  const bin = atob(r.audio);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  crumb(`cloud audio ${Math.round(bytes.length / 1024)} KB ${r.mime}`);
  return { mime: r.mime, bytes: bytes.buffer, starts: r.starts };
}

/** Priority at or above this is bulk work (downloads, audio files), which a computer should make itself for free. */
export const BULK = 10;

/**
 * Natural voice audio. While listening, the cloud is used when it's set up (smoothest), unless you chose to make it
 * on this computer. Downloads and audio files are made on this computer when it can, since that's free.
 */
async function naturalClip(text: string, v: Voice, pri: number): Promise<StoredClip> {
  const cloud = server.has('kokoro') && isOnline();
  const local = localNatural() || (neuralReady() && !cloud);
  const preferLocal = pri >= BULK || getState().settings.naturalWhere === 'device';
  const mine = () => neuralSpeak(text, v.voice, Math.min(pri, BULK)).then((c) => ({ mime: c.mime, bytes: c.bytes, starts: null }) as StoredClip);
  if (cloud && (!local || !preferLocal)) {
    // Cloud first; if it fails, this computer can still make it.
    return local ? cloudClip(text, v).catch(() => mine()) : cloudClip(text, v);
  }
  if (local) {
    if (!cloud || pri > 0) return mine();
    // Needed right now: give the computer a moment, then ask the cloud too and use whichever is first.
    const p = mine();
    const first = await Promise.race([p.then((c) => c, () => null), sleep(2500).then(() => null)]);
    if (first) return first;
    p.catch(() => {});
    return Promise.any([p, cloudClip(text, v)]).catch((e: any) => {
      throw e?.errors?.[e.errors.length - 1] || e;
    });
  }
  throw new Error(isOnline() ? 'The Natural voice is not set up on this device' : 'offline');
}

function fetchClip(text: string, persist = false, v: Voice = cloudVoice()!, pri = 0): Promise<Clip> {
  const key = `${v.provider}|${v.voice}|${v.style}|${text}`;
  const hit = clips.get(key);
  if (hit) return hit;
  const p = (async (): Promise<Clip> => {
    let stored: StoredClip | undefined;
    try {
      stored = await idbGet<StoredClip>(key, clipStore());
    } catch {
      stored = undefined;
    }
    if (stored) return { url: URL.createObjectURL(new Blob([stored.bytes], { type: stored.mime })), starts: stored.starts };
    const made = v.provider === 'neural' ? await naturalClip(text, v, pri) : await cloudClip(text, v);
    // Natural voice audio is small, so it is always kept: replays are instant and nothing is paid for twice.
    if (persist || v.provider === 'neural') {
      try {
        await idbSet(key, made, clipStore());
      } catch {
        /* storage full */
      }
    }
    return { url: URL.createObjectURL(new Blob([made.bytes], { type: made.mime })), starts: made.starts };
  })();
  p.then(() => ready.add(key), () => clips.delete(key));
  clips.set(key, p);
  if (clips.size > 60) {
    const oldest = clips.keys().next().value as string;
    clips.get(oldest)?.then((c) => URL.revokeObjectURL(c.url)).catch(() => {});
    clips.delete(oldest);
  }
  return p;
}

/**
 * The sentence that has to play now. If this computer is still making it after a moment,
 * the cloud version (same voice) is asked too and whichever arrives first plays.
 */
async function urgentClip(text: string, v: Voice): Promise<Clip> {
  const p = fetchClip(text, false, v, 0);
  // Only needed when this computer makes the voice itself; otherwise the cloud is already doing it.
  const deviceFirst = localNatural() && getState().settings.naturalWhere === 'device';
  if (v.provider !== 'neural' || !deviceFirst || !(server.has('kokoro') && isOnline())) return p;
  const first = await Promise.race([p.then((c) => c, () => null), sleep(1000).then(() => null)]);
  if (first) return first;
  behindUntil = Date.now() + 45_000;
  return withCloud(text, v);
}

/** Races the cloud against this computer for one sentence; the faster one wins and is kept. */
function withCloud(text: string, v: Voice): Promise<Clip> {
  const key = `${v.provider}|${v.voice}|${v.style}|${text}`;
  const local = clips.get(key) || fetchClip(text, false, v, 1);
  if (ready.has(key)) return local;
  const fromCloud = cloudClip(text, v).then(async (made) => {
    try {
      await idbSet(key, made, clipStore());
    } catch {
      /* storage full */
    }
    return { url: URL.createObjectURL(new Blob([made.bytes], { type: made.mime })), starts: made.starts } as Clip;
  });
  local.catch(() => {});
  const race = Promise.any([local, fromCloud]).catch((e: any) => {
    throw e?.errors?.[e.errors.length - 1] || e;
  });
  clips.set(key, race);
  race.then(() => ready.add(key), () => clips.delete(key));
  return race;
}

/** Saved audio for one sentence, for building audio packs. */
export async function clipBytes(text: string, v: Voice = cloudVoice()!, pri = 1): Promise<StoredClip> {
  const key = `${v.provider}|${v.voice}|${v.style}|${text}`;
  try {
    const s = await idbGet<StoredClip>(key, clipStore());
    if (s) return s;
  } catch {
    /* fall through */
  }
  await fetchClip(text, true, v, pri);
  const s = await idbGet<StoredClip>(key, clipStore());
  if (!s) throw new Error('Could not save audio on this device. It may be out of space.');
  return s;
}

/** Stores audio made on another device. */
export async function saveClip(key: string, text: string, clip: StoredClip) {
  await idbSet(`${key}|${text}`, clip, clipStore());
}

export async function hasClip(key: string, text: string): Promise<boolean> {
  try {
    return !!(await idbGet(`${key}|${text}`, clipStore()));
  } catch {
    return false;
  }
}

export { naturalVoice };
export type { StoredClip, Voice };

/* ---------- player ---------- */
// A tiny silent sound, used to unlock audio on iPhone during the tap on play.
const SILENCE = 'data:audio/mpeg;base64,//NAxAAAAANIAAAAAExBTUUDAAkIAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80LEAAAAA0gAAAAATEFNRQMACQgABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRQMACQgABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/zQsQAAAADSAAAAABMQU1FAwAJCAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/zQMQAAAADSAAAAABMQU1FAwAJCAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//NCxAAAAANIAAAAAExBTUUDAAkIAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let unlockedSpeech = false;

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

  /**
   * iPhones only allow sound that starts during a tap. Audio arrives a moment later, so each tap on play
   * "unlocks" the audio player and the speech engine right away.
   */
  private unlock() {
    try {
      if (!this.audio) this.audio = new Audio();
      const a = this.audio;
      if (!a.src || a.paused) {
        a.src = SILENCE;
        a.play().catch(() => {});
      }
    } catch {
      /* not supported */
    }
    try {
      if (typeof speechSynthesis !== 'undefined' && !unlockedSpeech) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
        unlockedSpeech = true;
      }
    } catch {
      /* not supported */
    }
  }

  play(index = this.s.index) {
    this.unlock();
    crumb(`play at ${index} of ${this.sentences.length}, voice ${getState().settings.provider}`);
    if (!this.sentences.length) return;
    this.stopAll();
    clearPrefetch();
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
    crumb(`device voice sentence ${i}`);
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
    crumb(`audio voice sentence ${i}`);
    // Only say we're waiting if it's a real wait, not the normal step between sentences.
    this.set({ engine: 'cloud' });
    const waitTimer = setTimeout(() => tok === this.token && this.set({ loading: true }), 400);
    let clip: Clip | null = null;
    let used: Voice | null = null;
    let failure = '';
    for (const v of voiceChain()) {
      try {
        clip = await urgentClip(this.sentences[i], v);
        used = v;
        break;
      } catch (e: any) {
        failure ||= e.message;
      }
      if (tok !== this.token) return;
    }
    clearTimeout(waitTimer);
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
    crumb(`got audio for ${i} from ${used.provider}`);
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
      crumb(`audio started ${i}`);
    } catch {
      if (tok === this.token) this.set({ playing: false, loading: false, error: 'Tap play to start audio.' });
      return;
    }
    crumb(`playing ${i}`);
    this.set({ loading: false });
    // Keep several sentences ready ahead of the one playing, so there are no gaps.
    const ahead = used.provider === 'neural' ? (localNatural() ? 8 : 4) : 3;
    for (let k = 1; k <= ahead; k++) if (this.sentences[i + k]) fetchClip(this.sentences[i + k], false, used, k).catch(() => {});
    // This computer fell behind recently: have the cloud help with the next few so there are no more pauses.
    if (used.provider === 'neural' && Date.now() < behindUntil && getState().settings.naturalWhere === 'device' && server.has('kokoro') && isOnline()) {
      for (let k = 1; k <= 3; k++) if (this.sentences[i + k]) withCloud(this.sentences[i + k], used).catch(() => {});
    }
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
            await fetchClip(text, true, cloudVoice()!, BULK + 1);
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
