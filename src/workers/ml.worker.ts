/// <reference lib="webworker" />
// On-device models for offline grading (sentence embeddings) and offline voice answers (Whisper).
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const ASR_MODEL = 'Xenova/whisper-base.en';

type Msg =
  | { id: number; type: 'load'; which: 'embed' | 'asr' }
  | { id: number; type: 'embed'; texts: string[] }
  | { id: number; type: 'transcribe'; audio: Float32Array };

let embedder: any = null;
let asr: any = null;

function progress(id: number, which: string) {
  return (p: any) => {
    if (p?.status === 'progress' && p.file) {
      (self as any).postMessage({ id, type: 'progress', which, file: p.file, loaded: p.loaded || 0, total: p.total || 0 });
    }
  };
}

async function getEmbedder(id: number) {
  if (!embedder) embedder = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8', progress_callback: progress(id, 'embed') } as any);
  return embedder;
}

async function getAsr(id: number) {
  if (!asr) asr = await pipeline('automatic-speech-recognition', ASR_MODEL, { dtype: 'q8', progress_callback: progress(id, 'asr') } as any);
  return asr;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (m.which === 'embed') await getEmbedder(m.id);
      else await getAsr(m.id);
      (self as any).postMessage({ id: m.id, type: 'done', result: true });
    } else if (m.type === 'embed') {
      const ex = await getEmbedder(m.id);
      const out: number[][] = [];
      for (let i = 0; i < m.texts.length; i += 32) {
        const t = await ex(m.texts.slice(i, i + 32), { pooling: 'mean', normalize: true });
        out.push(...(t.tolist() as number[][]));
      }
      (self as any).postMessage({ id: m.id, type: 'done', result: out });
    } else if (m.type === 'transcribe') {
      const a = await getAsr(m.id);
      const r = await a(m.audio, { chunk_length_s: 30, stride_length_s: 5 });
      (self as any).postMessage({ id: m.id, type: 'done', result: String(r?.text || '').trim() });
    }
  } catch (err: any) {
    (self as any).postMessage({ id: m.id, type: 'error', error: err?.message || String(err) });
  }
};
