import type { SourceKind } from './types';
import { api, server } from './api';
import { normalize } from './text';

export interface Imported {
  title: string;
  text: string;
  source: SourceKind;
  sourceUrl?: string;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export async function importFile(file: File): Promise<Imported> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') return importPdf(file);
  if (ext === 'epub') return importEpub(file);
  if (ext === 'docx') return importDocx(file);
  if (['txt', 'md', 'markdown', 'text'].includes(ext) || file.type.startsWith('text/plain')) {
    const raw = await file.text();
    const text = raw
      .replace(/^(#{1,3})\s+(.+)$/gm, '\n\n# $2\n\n')
      .replace(/^#{4,6}\s+/gm, '')
      .replace(/[*_`>]{1,3}/g, '');
    return { title: stem(file.name), text, source: 'text' };
  }
  if (['html', 'htm'].includes(ext)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    return { title: doc.title || stem(file.name), text: blocks(doc.body), source: 'text' };
  }
  throw new Error('Rise can open PDF, EPUB, Word (.docx), text and Markdown files.');
}

function blocks(root: Element | null): string {
  if (!root) return '';
  const out: string[] = [];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt,figcaption').forEach((el) => {
    if (el.tagName !== 'LI' && el.querySelector('p,li')) return;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    out.push(/^H[1-3]$/.test(el.tagName) ? `# ${t}` : t);
  });
  if (!out.length) out.push((root.textContent || '').trim());
  return out.join('\n\n');
}

async function importPdf(file: File): Promise<Imported> {
  const pdfjs: any = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: { t: string; h: number }[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    let h = 0;
    for (const item of content.items as any[]) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.str.trim()) h = Math.max(h, Math.abs(item.transform?.[3] || item.height || 0));
      if (item.hasEOL) {
        lines.push({ t: line.trim(), h });
        line = '';
        h = 0;
      }
    }
    if (line.trim()) lines.push({ t: line.trim(), h });
  }
  const real = lines.filter((l) => l.t.length > 0);
  const avg = real.reduce((a, l) => a + l.t.length, 0) / Math.max(1, real.length);
  const bodyHeights = real.filter((l) => l.t.length > 30 && l.h > 0).map((l) => l.h).sort((a, b) => a - b);
  const body = bodyHeights[Math.floor(bodyHeights.length / 2)] || 0;
  let text = '';
  let inHead = false;
  for (const { t: l, h } of lines) {
    if (!l || /^\d+$/.test(l)) continue; // blank lines and page numbers
    const head = body > 0 && h >= body * 1.18 && l.length < 90 && !/[,;]$/.test(l);
    if (head) {
      text = text.replace(/\s+$/, '') + (inHead ? ' ' : '\n\n# ') + l;
      inHead = true;
      continue;
    }
    if (inHead) {
      text += '\n\n';
      inHead = false;
    }
    if (text.endsWith('-')) text = text.slice(0, -1) + l;
    else text += (text && !text.endsWith('\n\n') ? ' ' : '') + l;
    if (/[.!?:"”)]$/.test(l) && l.length < avg * 0.85) text += '\n\n';
  }
  if (text.replace(/\s/g, '').length < 50) {
    throw new Error('That PDF looks like scanned images with no text layer. Try a text-based PDF, or paste the text.');
  }
  let title = stem(file.name);
  try {
    const meta = await pdf.getMetadata();
    if (meta?.info?.Title && String(meta.info.Title).trim().length > 3) title = String(meta.info.Title).trim();
  } catch {
    /* no metadata */
  }
  return { title, text, source: 'pdf' };
}

async function importEpub(file: File): Promise<Imported> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const container = xml(await zip.file('META-INF/container.xml')!.async('string'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('That EPUB file looks damaged.');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = xml(await zip.file(opfPath)!.async('string'));
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || stem(file.name);
  const manifest = new Map<string, string>();
  Array.from(opf.getElementsByTagName('item')).forEach((it) => manifest.set(it.getAttribute('id') || '', it.getAttribute('href') || ''));
  const parts: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const href = manifest.get(ref.getAttribute('idref') || '');
    if (!href) continue;
    const path = decodeURIComponent(base + href).replace(/[^/]+\/\.\.\//g, '');
    const f = zip.file(path);
    if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async('string'), 'text/html');
    let t = blocks(doc.body);
    if (!t.trim()) continue;
    // Each ebook file is usually a chapter. Give it a heading if it has none.
    if (!/^# /.test(t) && t.length > 1500) {
      const own = (doc.title || '').trim();
      t = `# ${own && own !== title ? own : `Section ${parts.length + 1}`}\n\n${t}`;
    }
    parts.push(t);
  }
  if (!parts.length) throw new Error('Rise could not find readable text in that EPUB. It may be DRM protected.');
  return { title, text: parts.join('\n\n'), source: 'epub' };
}

async function importDocx(file: File): Promise<Imported> {
  const mammoth: any = await import('mammoth');
  const fn = mammoth.convertToHtml || mammoth.default?.convertToHtml;
  const r = await fn({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(`<body>${r.value}</body>`, 'text/html');
  return { title: stem(file.name), text: blocks(doc.body), source: 'docx' };
}

export async function importUrl(url: string): Promise<Imported> {
  if (!server.ok()) throw new Error('Importing from links needs the Rise server. Paste the text instead for now.');
  const r = await api<{ title: string; text: string; source: SourceKind }>('/api/import', { method: 'POST', body: { url } });
  return { ...r, text: normalize(r.text), sourceUrl: url };
}
