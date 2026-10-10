import { api, server } from './api';
import { packReady, transcribeLocal } from './localml';
import { isOnline } from './online';

export interface Listening {
  /** Stops recording and resolves with the transcript. */
  stop(): Promise<string>;
  cancel(): void;
  /** 0..1 input loudness, for the meter. */
  level(): number;
  live: boolean;
}

interface Options {
  onInterim?: (text: string) => void;
  /** Called once when the speaker has gone quiet after talking. */
  onSilence?: () => void;
}

const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices;
const cloudStt = () => isOnline() && server.has('openai') && canRecord();
const localStt = () => packReady() && canRecord();

export function canListen(): boolean {
  return cloudStt() || localStt() || (!!SR && isOnline());
}

/** Explains why voice answers are unavailable right now, or returns ''. */
export function listenBlocker(): string {
  if (canListen()) return '';
  if (!isOnline()) return 'Offline voice answers need the offline answers download in Settings. Type for now.';
  return 'Voice answers need a microphone and a browser that supports speech, like Chrome or Safari.';
}

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return options.find((m) => (MediaRecorder as any).isTypeSupported?.(m)) || '';
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

async function meter(stream: MediaStream, onSilence?: () => void) {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let level = 0;
  let spoke = false;
  let quietSince = 0;
  let fired = false;
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    level = Math.min(1, rms * 8);
    const now = performance.now();
    if (rms > 0.035) {
      spoke = true;
      quietSince = 0;
    } else if (spoke) {
      quietSince ||= now;
      if (!fired && onSilence && now - quietSince > 2200) {
        fired = true;
        onSilence();
      }
    }
  }, 60);
  return {
    level: () => level,
    close: () => {
      clearInterval(timer);
      ctx.close().catch(() => {});
    }
  };
}

export async function startListening(opts: Options = {}): Promise<Listening> {
  const local = !cloudStt() && localStt();
  if (cloudStt() || local) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const m = await meter(stream, opts.onSilence);
    const maxTimer = setTimeout(() => rec.state === 'recording' && rec.stop(), 180_000);
    rec.start(250);
    const finish = () => {
      clearTimeout(maxTimer);
      m.close();
      stream.getTracks().forEach((t) => t.stop());
    };
    return {
      live: false,
      level: m.level,
      cancel() {
        if (rec.state !== 'inactive') rec.stop();
        finish();
      },
      stop() {
        return new Promise<string>((resolve, reject) => {
          rec.onstop = async () => {
            finish();
            try {
              const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
              if (blob.size < 1200) return resolve('');
              if (local) return resolve(await transcribeLocal(blob));
              const audio = await blobToBase64(blob);
              const r = await api<{ text: string }>('/api/stt', { method: 'POST', body: { audio, mime: blob.type } });
              resolve(r.text);
            } catch (e) {
              reject(e);
            }
          };
          if (rec.state !== 'inactive') rec.stop();
          else rec.onstop?.(new Event('stop'));
        });
      }
    };
  }

  if (!SR || !isOnline()) throw new Error(listenBlocker() || 'Voice answers are not available right now. Type instead.');

  // Browser speech recognition (free, works offline on some devices).
  let stream: MediaStream | null = null;
  let m: { level: () => number; close: () => void } | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    m = await meter(stream, opts.onSilence);
  } catch {
    /* meter is optional */
  }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';
  let finalText = '';
  let interim = '';
  let ended = false;
  let endResolve: (() => void) | null = null;
  rec.onresult = (e: any) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    opts.onInterim?.((finalText + interim).trim());
  };
  rec.onend = () => {
    ended = true;
    endResolve?.();
  };
  rec.onerror = (e: any) => {
    if (e.error === 'not-allowed') opts.onInterim?.('Microphone permission was blocked.');
  };
  rec.start();
  const cleanup = () => {
    m?.close();
    stream?.getTracks().forEach((t) => t.stop());
  };
  return {
    live: true,
    level: () => m?.level() ?? 0.3,
    cancel() {
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      cleanup();
    },
    async stop() {
      if (!ended) {
        await new Promise<void>((res) => {
          endResolve = res;
          try {
            rec.stop();
          } catch {
            res();
          }
          setTimeout(res, 1500);
        });
      }
      cleanup();
      return (finalText + interim).trim();
    }
  };
}
