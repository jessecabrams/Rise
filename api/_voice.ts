import { Mp3Encoder } from '@breezystack/lamejs';
import { HttpError, need } from './_lib.js';

/**
 * The Natural voice in the cloud (Kokoro on DeepInfra). Audio is re-encoded to small mono MP3
 * (32 kbps, clear for speech), about a third of the size DeepInfra sends, so books download
 * faster and take far less space on a phone.
 */

const KBPS = 32;

interface Pcm {
  rate: number;
  samples: Int16Array;
}

/** Reads a WAV file (16-bit PCM or 32-bit float, any channel count) into mono 16-bit samples. */
export function readWav(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4);
    let size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      // Streaming encoders sometimes write a placeholder size; use whatever is actually there.
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const ch = Math.max(1, fmt.channels);
      const float = fmt.format === 3 || (fmt.format === 0xfffe && fmt.bits === 32);
      const step = (fmt.bits / 8) * ch;
      if (!step) return null;
      const n = Math.floor(size / step);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < ch; c++) {
          const at = body + i * step + c * (fmt.bits / 8);
          if (float) sum += Math.max(-1, Math.min(1, buf.readFloatLE(at))) * 32767;
          else if (fmt.bits === 16) sum += buf.readInt16LE(at);
          else if (fmt.bits === 8) sum += (buf.readUInt8(at) - 128) * 256;
          else return null;
        }
        out[i] = Math.round(sum / ch);
      }
      return { rate: fmt.rate, samples: out };
    }
    o = body + size + (size % 2);
  }
  return null;
}

/**
 * Speech sounds the same at 22.05 kHz. (The MP3 encoder mishandles 24 kHz at low bitrates and
 * produced near-silent audio, so everything is converted to 22.05 kHz first.)
 */
const RATE = 22050;
function to24k(p: Pcm): Pcm {
  if (p.rate === RATE) return p;
  const ratio = p.rate / RATE;
  const n = Math.floor(p.samples.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(a + 1, p.samples.length - 1);
    out[i] = Math.round(p.samples[a] + (p.samples[b] - p.samples[a]) * (x - a));
  }
  return { rate: RATE, samples: out };
}

export function toMp3(input: Pcm): Buffer {
  const p = to24k(input);
  const enc = new Mp3Encoder(1, p.rate, KBPS);
  const parts: Buffer[] = [];
  for (let i = 0; i < p.samples.length; i += 1152) {
    const b = enc.encodeBuffer(p.samples.subarray(i, i + 1152));
    if (b.length) parts.push(Buffer.from(b));
  }
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat(parts);
}

async function deepinfra(text: string, voice: string, format: 'wav' | 'mp3'): Promise<Buffer> {
  const key = need('DEEPINFRA_API_KEY');
  const base = process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com';
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${base}/v1/audio/speech`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.DEEPINFRA_TTS_MODEL || 'hexgrad/Kokoro-82M', input: text, voice: voice || 'af_heart', response_format: format }),
        signal: AbortSignal.timeout(25_000)
      });
    } catch (e: any) {
      // The connection dropped or timed out: try again.
      last = `DeepInfra could not be reached (${e?.message || 'network'})`;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
      continue;
    }
    if (r.ok) {
      const type = r.headers.get('content-type') || '';
      if (type.includes('json')) {
        const data: any = await r.json();
        const raw = String(data.audio || data.data || '').replace(/^data:[^,]+,/, '');
        return Buffer.from(raw, 'base64');
      }
      return Buffer.from(await r.arrayBuffer());
    }
    const detail = (await r.text()).slice(0, 200);
    if (r.status === 401 || r.status === 403) throw new HttpError(502, 'DeepInfra did not accept the key. Check DEEPINFRA_API_KEY in Vercel.');
    if (r.status === 402) throw new HttpError(502, 'Your DeepInfra balance is used up. Add credit at deepinfra.com.');
    last = `DeepInfra said ${r.status}: ${detail}`;
    // Busy or a hiccup: wait a moment and try again.
    if (r.status === 429 || r.status >= 500) await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    else break;
  }
  throw new HttpError(502, last || 'DeepInfra did not answer.');
}

export interface VoiceClip {
  audio: string; // base64
  mime: string;
  starts: null;
}

/** One sentence of Natural voice audio as small MP3. Empty audio comes back as an empty string (a pause). */
export async function kokoroClip(text: string, voice: string): Promise<VoiceClip> {
  const wav = await deepinfra(text, voice, 'wav');
  const pcm = readWav(wav);
  if (pcm && pcm.samples.length) return { audio: toMp3(pcm).toString('base64'), mime: 'audio/mpeg', starts: null };
  if (pcm && !pcm.samples.length) return { audio: '', mime: 'audio/mpeg', starts: null };
  // Not a WAV we can read: fall back to DeepInfra's own MP3.
  const mp3 = await deepinfra(text, voice, 'mp3');
  return { audio: mp3.length > 100 ? mp3.toString('base64') : '', mime: 'audio/mpeg', starts: null };
}
