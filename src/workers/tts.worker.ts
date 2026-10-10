/// <reference lib="webworker" />
// The Natural voice: Kokoro, a small neural text-to-speech model that runs on the device.
import { KokoroTTS } from 'kokoro-js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type Msg = { id: number; type: 'load' } | { id: number; type: 'speak'; text: string; voice: string } | { id: number; type: 'warm'; voices: string[] };

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
    }).then((t) => (tts = t));
  }
  return loading;
}

// One request at a time keeps memory steady on phones.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      const t = await load(m.id);
      if (m.type === 'load') return (self as any).postMessage({ id: m.id, type: 'done', result: true });
      if (m.type === 'warm') {
        // Generating a word with each voice downloads and caches its voice file.
        for (const v of m.voices) await t.generate('Hi.', { voice: v as any });
        return (self as any).postMessage({ id: m.id, type: 'done', result: true });
      }
      const audio: any = await t.generate(m.text, { voice: m.voice as any });
      const blob: Blob = audio.toBlob();
      (self as any).postMessage({ id: m.id, type: 'done', result: blob });
    } catch (err: any) {
      (self as any).postMessage({ id: m.id, type: 'error', error: err?.message || String(err) });
    }
  });
};
