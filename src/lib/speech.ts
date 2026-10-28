import { crumb, reportProblem, safeMode } from './crumbs';
import { useSyncExternalStore } from 'react';
import { getState } from './store';
import { api, server } from './api';
import { wordAt } from './text';
import { createStore, get as idbGet, set as idbSet, del as idbDel, delMany as idbDelMany, keys as idbKeys, setMany as idbSetMany } from 'idb-keyval';
import { holdAwake, isOnline, whenVisible } from './online';
import { clearPrefetch, localNatural, neuralReady, neuralSpeak } from './localtts';

/*
 * One time only: the saved-audio store held thousands of silent clips from before Oct 27. Deleting them one by one
 * crashed iPhones, so the whole store is dropped in a single step instead. The flag is set first so this can never
 * repeat, even if the phone is interrupted.
 */
(() => {
  try {
    if (typeof indexedDB === 'undefined' || localStorage.getItem('rise-audio-v2')) return;
    localStorage.setItem('rise-audio-v2', '1');
    indexedDB.deleteDatabase('rise-audio');
  } catch {
    /* storage blocked */
  }
})();

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

/**
 * The prefix for a voice's saved audio. Natural voice audio saved before Oct 27, 2026 was silent
 * (an encoder bug), so it lives under an old prefix and is never used again.
 */
export const vk = (v: { provider: string; voice: string; style: string }) => `${v.provider === 'neural' ? 'neural2' : v.provider}|${v.voice}|${v.style}`;

/** Identifies the current voice's saved audio, or null for device voices. */
export function voiceKey(): string | null {
  const v = cloudVoice();
  return v ? `${vk(v)}` : null;
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
  if (!r.audio) return silentClip();
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
  // The cloud is much faster, so it's used for downloads too unless you chose to make audio on this computer.
  const preferLocal = getState().settings.naturalWhere === 'device' || (pri >= BULK && !cloud);
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

/** Text with nothing to say aloud ("***", "2."), or a voice that returned nothing: a short pause instead of an error. */
const speakable = (text: string) => /[A-Za-z]{2,}|[0-9]{2,}/.test(text);
function silentClip(): StoredClip {
  const bin = atob(SILENCE.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return { mime: 'audio/mpeg', bytes: bytes.buffer, starts: null };
}

function fetchClip(text: string, persist = false, v: Voice = cloudVoice()!, pri = 0): Promise<Clip> {
  const key = `${vk(v)}|${text}`;
  const hit = clips.get(key);
  if (hit) return hit;
  const p = (async (): Promise<Clip> => {
    if (!speakable(text)) {
      const s = silentClip();
      return { url: URL.createObjectURL(new Blob([s.bytes], { type: s.mime })), starts: null };
    }
    let stored: StoredClip | undefined;
    try {
      stored = await idbGet<StoredClip>(key, clipStore());
    } catch {
      stored = undefined;
    }
    if (stored) return { url: URL.createObjectURL(new Blob([stored.bytes], { type: stored.mime })), starts: stored.starts };
    const made = await (v.provider === 'neural' ? naturalClip(text, v, pri) : cloudClip(text, v)).catch((e: any) => {
      if (/sent no audio/i.test(e?.message || '')) return silentClip();
      throw e;
    });
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
  const key = `${vk(v)}|${text}`;
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
  const key = `${vk(v)}|${text}`;
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
/** Tell iPhone this is a listening app: play through the speaker even with the ringer on silent, like Music or Podcasts. */
function mediaSession() {
  try {
    const s = (navigator as any).audioSession;
    if (s && s.type !== 'playback') s.type = 'playback';
  } catch {
    /* older browsers */
  }
}
if (typeof navigator !== 'undefined') mediaSession();
const speaking = () => typeof speechSynthesis !== 'undefined' && (speechSynthesis.speaking || speechSynthesis.pending);
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
    if (patch.error && patch.error !== this.s.error) reportProblem(patch.error);
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
    mediaSession();
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
      // Only wake the phone's speech engine when it will actually be used. Touching it switches iPhone
      // audio into a mode that follows the silent switch and can pause other sound.
      if (typeof speechSynthesis !== 'undefined' && !unlockedSpeech && !cloudVoice()) {
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
    if (speaking()) speechSynthesis.cancel();
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
        crumb(`audio failed for ${i}: ${String(e.message).slice(0, 80)}`);
        // A hiccup in the connection shouldn't switch voices: try once more.
        if (e.message !== 'offline' && isOnline() && tok === this.token) {
          await sleep(700);
          if (tok !== this.token) return;
          try {
            clips.delete(`${vk(v)}|${this.sentences[i]}`);
            clip = await urgentClip(this.sentences[i], v);
            used = v;
            break;
          } catch {
            /* fall through to the next voice */
          }
        }
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
    a.muted = false;
    a.volume = 1;
    a.playbackRate = getState().settings.rate;
    (a as any).preservesPitch = true;
    a.onended = () => {
      if (tok === this.token) this.done(i, tok);
    };
    // A sentence whose audio won't play is skipped instead of stopping everything.
    a.onerror = () => {
      if (tok !== this.token) return;
      crumb(`audio error on ${i}: ${a.error?.code || '?'}`);
      clips.delete(`${vk(used!)}|${this.sentences[i]}`);
      this.done(i, tok);
    };
    // The phone paused the sound itself (a call, another app, a notification): show it as paused.
    a.onpause = () => {
      if (tok !== this.token || a.ended || !this.s.playing) return;
      setTimeout(() => {
        if (tok === this.token && a.paused && !a.ended && this.s.playing) {
          crumb(`paused by the phone at ${i}`);
          this.token++;
          this.set({ playing: false, loading: false });
        }
      }, 300);
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
    const ahead = used.provider === 'neural' ? 8 : 3;
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
  if (speaking() && !player.s.playing) speechSynthesis.cancel();
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

/** Which sentences already have saved audio for a voice. One quick look at the list of keys, no audio is read. */
export async function savedSet(key: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const prefix = `${key}|`;
    for (const k of await idbKeys(clipStore())) if (typeof k === 'string' && k.startsWith(prefix)) out.add(k.slice(prefix.length));
  } catch {
    /* storage blocked */
  }
  return out;
}

export interface DownloadResult {
  saved: number;
  failed: number;
}

function b64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

/**
 * Saves voice audio for these sentences so they play offline. Already-saved sentences are skipped, so a stopped
 * download picks up where it left off. The Natural voice is fetched from the cloud ten sentences per request,
 * several requests at once. While the phone is locked the download waits instead of failing.
 */
export async function downloadAudio(sentences: string[], onPct: (p: number) => void, cancel: { current: boolean }): Promise<DownloadResult> {
  const key = voiceKey();
  const v = cloudVoice();
  if (!key || !v) return { saved: 0, failed: 0 };
  const unique = [...new Set(sentences)].filter(speakable);
  const have = await savedSet(key);
  const todo = unique.filter((t) => !have.has(t));
  const total = unique.length;
  let done = total - todo.length;
  let failed = 0;
  onPct(total ? done / total : 1);
  if (!todo.length) return { saved: 0, failed: 0 };
  const release = await holdAwake();
  const batched = v.provider === 'neural' && server.has('kokoro') && getState().settings.naturalWhere !== 'device';
  try {
    if (batched) {
      let groups: string[][] = [];
      for (let i = 0; i < todo.length; i += 10) groups.push(todo.slice(i, i + 10));
      let next = 0;
      let fatal: Error | null = null;
      let missed: string[] = [];
      const lane = async () => {
        while (next < groups.length && !cancel.current && !fatal) {
          const g = groups[next++];
          for (let attempt = 0; ; attempt++) {
            await whenVisible();
            if (cancel.current || fatal) return;
            try {
              if (!isOnline()) throw new Error('offline');
              const r = await api<{ clips: ({ audio: string; mime: string } | { error: string })[] }>('/api/tts', {
                method: 'POST',
                body: { texts: g, provider: 'kokoro', voice: v.voice }
              });
              const entries: [string, StoredClip][] = [];
              r.clips.forEach((c, k) => {
                if (!c || 'error' in c) return missed.push(g[k]);
                entries.push([`${key}|${g[k]}`, c.audio ? { mime: c.mime, bytes: b64(c.audio), starts: null } : silentClip()]);
              });
              try {
                await idbSetMany(entries, clipStore());
              } catch {
                throw Object.assign(new Error('This device is out of space for audio. Remove downloads you no longer need, then try again.'), { fatal: true });
              }
              done += entries.length;
              onPct(done / total);
              break;
            } catch (e: any) {
              if (e?.fatal || /key|balance/i.test(e?.message || '')) {
                fatal = e;
                return;
              }
              if (attempt >= 5) {
                failed += g.length;
                break;
              }
              await sleep(Math.min(8000, 600 * 2 ** attempt));
            }
          }
        }
      };
      await Promise.all([lane(), lane(), lane()]);
      // A second pass for any sentences that hit a hiccup.
      if (missed.length && !cancel.current && !fatal) {
        groups = [];
        for (let i = 0; i < missed.length; i += 5) groups.push(missed.slice(i, i + 5));
        missed = [];
        next = 0;
        await Promise.all([lane(), lane()]);
      }
      failed += missed.length;
      if (fatal) throw fatal;
    } else {
      let next = 0;
      const lane = async () => {
        while (next < todo.length && !cancel.current) {
          const text = todo[next++];
          for (let attempt = 0; ; attempt++) {
            await whenVisible();
            if (cancel.current) return;
            try {
              clips.delete(`${vk(v)}|${text}`);
              await fetchClip(text, true, v, BULK + 1);
              done++;
              onPct(done / total);
              break;
            } catch (e: any) {
              if (/key|balance/i.test(e?.message || '')) throw e;
              if (attempt >= 3) {
                failed++;
                break;
              }
              await sleep(800 * (attempt + 1));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: v.provider === 'neural' ? 4 : 6 }, () => lane()));
    }
  } finally {
    release();
  }
  return { saved: done, failed };
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

