import { clipBytes, naturalVoice, saveClip, sayChunks } from './speech';
import { getState, patchDoc, setSettings } from './store';
import type { Chapter, Structured } from './text';
import type { DocBody } from './types';

/**
 * Audio packs move Natural voice audio from a computer (which makes it for free) to a phone (which can't).
 * A pack is a zip file: a list of sentences plus one small MP3 per sentence.
 */

const MANIFEST = 'rise-audio.json';
const PART_BYTES = 60 * 1024 * 1024; // keeps each file easy for a phone to open

interface Manifest {
  app: 'rise';
  kind: 'audio';
  v: 1;
  docId: string;
  title: string;
  voice: string;
  key: string;
  full: boolean;
  part: number;
  parts: number;
  clips: { t: string; f: string; m: string }[];
}

export interface PackFile {
  name: string;
  blob: Blob;
  mb: number;
}

export interface PackProgress {
  done: number;
  total: number;
  label: string;
}

/** About 0.36 MB per minute of listening. */
export const packEstimateMB = (words: number) => Math.max(1, Math.round((words / 150) * 0.36));

export async function makeAudioPacks(
  doc: { id: string; title: string; s: Structured; body: DocBody },
  chs: Chapter[],
  onProgress: (p: PackProgress) => void,
  cancel: { current: boolean }
): Promise<PackFile[]> {
  const v = naturalVoice();
  const key = `${v.provider}|${v.voice}|${v.style}`;
  const all = chs.length === 0;
  const texts: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      texts.push(t);
    }
  };
  const ranges = all ? [{ start: 0, end: doc.s.sentences.length, index: -1 }] : chs;
  for (const c of ranges) for (let i = c.start; i < c.end; i++) add(doc.s.sentences[i]);
  // Quiz questions too, so offline quizzes are read in the same voice.
  for (const [k, qs] of Object.entries(doc.body.bank || {})) {
    if (all || chs.some((c) => String(c.index) === k)) for (const q of qs) sayChunks(q.question).forEach(add);
  }

  const got: { t: string; mime: string; bytes: ArrayBuffer }[] = new Array(texts.length);
  let next = 0;
  let done = 0;
  const started = performance.now();
  const work = async () => {
    while (next < texts.length && !cancel.current) {
      const i = next++;
      const c = await clipBytes(texts[i], v, 3);
      got[i] = { t: texts[i], mime: c.mime, bytes: c.bytes };
      done++;
      const per = (performance.now() - started) / done;
      const left = Math.round(((texts.length - done) * per) / 60000);
      onProgress({ done, total: texts.length, label: `Making audio: ${done} of ${texts.length} sentences${done > 5 && left > 0 ? `, about ${left} min left` : ''}` });
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  if (cancel.current) throw new Error('Stopped.');

  // Split into files of about 60 MB.
  onProgress({ done, total: texts.length, label: 'Packing the files…' });
  const groups: (typeof got)[] = [[]];
  let size = 0;
  for (const g of got) {
    if (size + g.bytes.byteLength > PART_BYTES && groups[groups.length - 1].length) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(g);
    size += g.bytes.byteLength;
  }
  const { default: JSZip } = await import('jszip');
  const safe = doc.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Rise';
  const what = all ? '' : chs.length === 1 ? ` - ch ${chs[0].index + 1}` : ` - ch ${chs[0].index + 1}-${chs[chs.length - 1].index + 1}`;
  const files: PackFile[] = [];
  for (let p = 0; p < groups.length; p++) {
    const zip = new JSZip();
    const manifest: Manifest = {
      app: 'rise',
      kind: 'audio',
      v: 1,
      docId: doc.id,
      title: doc.title,
      voice: v.voice,
      key,
      full: all,
      part: p + 1,
      parts: groups.length,
      clips: []
    };
    groups[p].forEach((g, k) => {
      const f = `a/${String(k).padStart(5, '0')}.mp3`;
      zip.file(f, g.bytes);
      manifest.clips.push({ t: g.t, f, m: g.mime });
    });
    zip.file(MANIFEST, JSON.stringify(manifest));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
    const name = `${safe}${what} - Rise audio${groups.length > 1 ? ` ${p + 1} of ${groups.length}` : ''}.zip`;
    files.push({ name, blob, mb: Math.max(1, Math.round(blob.size / 1048576)) });
  }
  return files;
}

export function saveFile(f: PackFile) {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function isAudioPack(file: File): Promise<boolean> {
  if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) return false;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    return !!zip.file(MANIFEST);
  } catch {
    return false;
  }
}

export interface ImportResult {
  title: string;
  clips: number;
  onDevice: boolean;
  part: number;
  parts: number;
  docId: string;
}

/** Saves a pack's audio on this device and switches to the Natural voice it was made with. */
export async function importAudioPack(file: File, onPct?: (p: number) => void): Promise<ImportResult> {
  const { default: JSZip } = await import('jszip');
  let zip: any;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('That file could not be opened. Make sure it is a Rise audio file (.zip).');
  }
  const mf = zip.file(MANIFEST);
  if (!mf) throw new Error('That zip file is not a Rise audio file.');
  const m: Manifest = JSON.parse(await mf.async('string'));
  if (m.app !== 'rise' || m.kind !== 'audio') throw new Error('That zip file is not a Rise audio file.');
  let n = 0;
  for (const c of m.clips) {
    const f = zip.file(c.f);
    if (!f) continue;
    const bytes: ArrayBuffer = await f.async('arraybuffer');
    try {
      await saveClip(m.key, c.t, { mime: c.m || 'audio/mpeg', bytes, starts: null });
    } catch {
      throw new Error(`This device ran out of space after ${n} sentences. Free some space and try again.`);
    }
    n++;
    if (n % 25 === 0) onPct?.(n / m.clips.length);
  }
  const onDevice = !!getState().docs[m.docId];
  if (onDevice && m.full && m.part === m.parts) {
    patchDoc(m.docId, (d) => {
      d.offline = { ...(d.offline || { at: Date.now(), chapters: 0 }), audio: m.key, audioAt: Date.now() };
    });
  }
  setSettings({ provider: 'neural', neuralVoice: m.voice });
  return { title: m.title, clips: n, onDevice, part: m.part, parts: m.parts, docId: m.docId };
}
