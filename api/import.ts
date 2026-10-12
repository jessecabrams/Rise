import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { guard, HttpError, json, readBody } from './_lib.js';

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

function blocksToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption')) as any[];
  const out: string[] = [];
  for (const el of blocks) {
    if (el.querySelector && el.querySelector('p,li') && el.tagName !== 'LI') continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const h = String(el.tagName).match(/^H([1-3])$/);
    if (t) out.push(h ? `${'#'.repeat(Number(h[1]))} ${t}` : t);
  }
  return out.join('\n\n');
}

export const POST = guard(async (req) => {
  const { url } = await readBody<{ url: string }>(req, 10_000);
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new HttpError(400, 'That does not look like a web address.');
  }
  if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) throw new HttpError(400, 'That address cannot be opened.');

  const gdoc = u.hostname === 'docs.google.com' && u.pathname.match(/\/document\/d\/([\w-]+)/);
  if (gdoc) {
    const r = await fetch(`https://docs.google.com/document/d/${gdoc[1]}/export?format=txt`, { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || type.includes('text/html')) {
      throw new HttpError(
        403,
        'Rise could not open that Google Doc. In Google Docs, click Share and set General access to "Anyone with the link", then try again. Or download it as .docx and upload the file.'
      );
    }
    const text = (await r.text()).replace(/^﻿/, '').replace(/\r/g, '');
    const firstLine = text.split('\n').find((l) => l.trim()) || 'Google Doc';
    return json({ title: firstLine.trim().slice(0, 120), text, source: 'gdoc' });
  }

  const r = await fetch(u.toString(), {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!r.ok) throw new HttpError(502, `That site answered ${r.status}. It may block reading apps or need a login.`);
  const html = await r.text();
  const { document } = parseHTML(html);
  const article = new Readability(document as any).parse();
  if (!article?.content) throw new HttpError(422, 'Rise could not find an article on that page. Try copying the text and pasting it instead.');
  const text = blocksToText(article.content);
  if (text.length < 200) throw new HttpError(422, 'That page had very little readable text. It may need a login. Try pasting the text instead.');
  return json({ title: (article.title || u.hostname).trim(), text, source: 'web' });
});
