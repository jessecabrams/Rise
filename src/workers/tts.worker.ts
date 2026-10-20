/// <reference lib="webworker" />
// The Natural voice: Kokoro, a small neural text-to-speech model that runs on the device.
// Several of these workers can run side by side on a computer so audio stays ahead of playback.
import { KokoroTTS } from 'kokoro-js';
import { Mp3Encoder } from '@breezystack/lamejs';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type Msg = { id: number; type: 'load' } | { id: number; type: 'speak'; text: string; voice: string };

let tts: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;

function load(id: number): Promise<KokoroTTS> {
  if (tts) return Promise.resolve(tts);
  if (!loading) {
    loading = KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && p.file) (self as any).postMessage({ id, type: 'progress', file: p.file, loaded: p.loaded || 0, total: p.total || 0 });
      }
    }).then(
      (t) => (tts = t),
      (e) => {
        loading = null;
        throw e;
      }
    );
  }
  return loading;
}

/** MP3 is about a tenth the size of raw audio, so saved books and audio packs stay small. */
function toMp3(samples: Float32Array, rate: number): Uint8Array {
  const enc = new Mp3Encoder(1, rate, 48);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (b.length) parts.push(b);
  }
  parts.push(enc.flush());
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

// One sentence at a time per worker keeps memory steady.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      const t = await load(m.id);
      if (m.type === 'load') return (self as any).postMessage({ id: m.id, type: 'done', result: true });
      const audio: any = await t.generate(m.text, { voice: m.voice as any });
      const mp3 = toMp3(audio.audio as Float32Array, audio.sampling_rate || 24000);
      (self as any).postMessage({ id: m.id, type: 'done', result: { mime: 'audio/mpeg', bytes: mp3.buffer } }, [mp3.buffer]);
    } catch (err: any) {
      (self as any).postMessage({ id: m.id, type: 'error', error: err?.message || String(err) });
    }
  });
};
