import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Icon, Sheet } from '../components/ui';
import { DocOffline } from './OfflinePanel';
import { getBody, patchDoc, saveBody, useApp } from '../lib/store';
import { go, type DocTab } from '../lib/nav';
import { structure, type Structured } from '../lib/text';
import type { DocBody, QuizFocus } from '../lib/types';
import type { MapCtx } from '../lib/mastery';
import { Reader } from './Reader';
import { Learn } from './Learn';
import { Quiz } from './Quiz';
import { Ask } from './Ask';
import { SkyMap } from './SkyMap';

const TABS: { id: DocTab; label: string; icon: string }[] = [
  { id: 'listen', label: 'Listen', icon: 'headphones' },
  { id: 'learn', label: 'Learn', icon: 'spark' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'quiz', label: 'Quiz', icon: 'target' },
  { id: 'ask', label: 'Ask', icon: 'chat' }
];

export interface DocCtx extends MapCtx {
  body: DocBody;
  /** Replace the body. Prefer `update` when other async work may also be changing it. */
  setBody: (b: DocBody) => void;
}

export function Doc({ id, tab, focus, nonce }: { id: string; tab: DocTab; focus?: QuizFocus; nonce?: number }) {
  const meta = useApp((s) => s.docs[id]);
  const [body, setBodyState] = useState<DocBody | null>(null);
  const bodyRef = useRef<DocBody | null>(null);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);

  // Reload when background work (like coach reviews of offline answers) changes this piece.
  useEffect(() => {
    const onBody = (e: Event) => {
      if ((e as CustomEvent).detail !== id) return;
      getBody(id).then((b) => {
        if (b) {
          bodyRef.current = b;
          setBodyState(b);
        }
      });
    };
    window.addEventListener('rise-body', onBody);
    return () => window.removeEventListener('rise-body', onBody);
  }, [id]);

  useEffect(() => {
    let live = true;
    setBodyState(null);
    setError('');
    getBody(id)
      .then((b) => {
        if (!live) return;
        if (!b) setError('Rise could not find the text for this item on this device. If you added it on another device, check that sync is on in Settings.');
        else {
          bodyRef.current = b;
          setBodyState(b);
        }
      })
      .catch(() => live && setError('Rise could not open this item.'));
    patchDoc(id, (d) => (d.lastOpenedAt = Date.now()));
    return () => {
      live = false;
    };
  }, [id]);

  if (!meta) {
    return (
      <div className="page">
        <ErrorNote message="This item is no longer in your library." />
        <button className="btn btn-ghost" onClick={() => go({ name: 'library' })}>
          Back to library
        </button>
      </div>
    );
  }

  const update = (fn: (b: DocBody) => DocBody) => {
    if (!bodyRef.current) return;
    const next = fn(bodyRef.current);
    bodyRef.current = next;
    setBodyState(next);
    saveBody(next);
    if (next.lessons.length !== meta.lessonCount) patchDoc(id, (d) => (d.lessonCount = next.lessons.length));
  };

  const s: Structured | null = body ? structure(body.text, id) : null;
  const ctx: DocCtx | null =
    body && s ? { id, title: meta.title, body, s, bodyRef: bodyRef as { current: DocBody }, update, setBody: (b) => update(() => b) } : null;

  return (
    <div className="page doc-page">
      <header className="doc-head">
        <button className="icon-btn" onClick={() => go({ name: 'library' })} aria-label="Back to library">
          <Icon name="back" />
        </button>
        {renaming ? (
          <input
            id="rename"
            className="rename"
            autoFocus
            defaultValue={meta.title}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) patchDoc(id, (d) => (d.title = v));
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h1 className="doc-title" onDoubleClick={() => setRenaming(true)}>
            {meta.title}
          </h1>
        )}
        <button className={`icon-btn ${meta.offline ? 'is-offline' : ''}`} onClick={() => setOfflineOpen(true)} aria-label={meta.offline ? 'Downloaded for offline' : 'Download for offline'} title={meta.offline ? 'Downloaded for offline' : 'Download for offline'}>
          <Icon name={meta.offline ? 'check' : 'download'} size={18} />
        </button>
        <button className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename">
          <Icon name="edit" size={18} />
        </button>
      </header>
      <Sheet open={offlineOpen} onClose={() => setOfflineOpen(false)} title="Use offline">
        {ctx ? <DocOffline ctx={ctx} /> : <p className="hint">Loading…</p>}
      </Sheet>
      <nav className="doc-tabs" aria-label="Study modes">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go({ name: 'doc', id, tab: t.id })}>
            <Icon name={t.icon} size={18} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {error && <ErrorNote message={error} />}
      {!body && !error && <div className="loading-lines" aria-label="Loading" />}
      {ctx && (
        <div className="doc-body">
          {tab === 'listen' && <Reader id={id} title={meta.title} s={ctx.s} />}
          {tab === 'learn' && <Learn ctx={ctx} />}
          {tab === 'map' && <SkyMap ctx={ctx} />}
          {tab === 'quiz' && <Quiz key={nonce || 0} ctx={ctx} focus={focus} />}
          {tab === 'ask' && <Ask ctx={ctx} />}
        </div>
      )}
    </div>
  );
}
