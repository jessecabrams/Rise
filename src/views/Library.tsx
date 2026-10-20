import { importAudioPack } from '../lib/audiopack';
import { useMemo, useRef, useState } from 'react';
import { Empty, Horizon, Icon, Sheet } from '../components/ui';
import { addDoc, getState, removeDoc, useApp } from '../lib/store';
import { go } from '../lib/nav';
import { award, dayKey, levelInfo, questsFor } from '../lib/game';
import { importFile, importUrl, type Imported } from '../lib/importers';
import { minutesFor, titleFrom } from '../lib/text';
import { player } from '../lib/speech';
import { useServer } from '../lib/api';
import type { DocMeta, SourceKind } from '../lib/types';
import { metaSummary } from '../lib/mastery';

const SOURCE_ICON: Record<SourceKind, string> = { paste: 'clipboard', pdf: 'doc', epub: 'book', docx: 'doc', text: 'doc', web: 'globe', gdoc: 'doc', sample: 'sun' };
const SOURCE_LABEL: Record<SourceKind, string> = { paste: 'Pasted', pdf: 'PDF', epub: 'Ebook', docx: 'Word', text: 'Text', web: 'Article', gdoc: 'Google Doc', sample: 'Starter' };

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name || 'friend'}`;
}

export function Library() {
  const docs = useApp((s) => s.docs);
  const game = useApp((s) => s.game);
  const settings = useApp((s) => s.settings);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<DocMeta | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(docs)
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));
  }, [docs, query]);

  const lvl = levelInfo(game.xp);
  const today = dayKey();
  const quests = questsFor(today, settings);
  const progress = game.daily.day === today ? game.daily.progress : {};
  const resume = list.find((d) => d.lastOpenedAt && d.position > 0 && d.position < d.sentenceCount - 1);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Build your life around your brain</span>
          <h1>{greeting(settings.name)}</h1>
        </div>
        <button className="btn btn-sun" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} /> Add
        </button>
      </header>

      <section className="today" aria-label="Today">
        <button className="today-level" onClick={() => go({ name: 'progress' })}>
          <div className="mini-sun" style={{ ['--rise' as any]: lvl.pct }} aria-hidden="true">
            <span className="mini-disc" />
            <span className="mini-horizon" />
          </div>
          <div className="grow">
            <span className="eyebrow">Level {lvl.level}</span>
            <strong className="today-title">{lvl.title}</strong>
            <Horizon pct={lvl.pct} label="Progress to next level" />
            <span className="hint tabular">{lvl.toNext} XP to level {lvl.level + 1}</span>
          </div>
          <div className="streak" title="Daily streak">
            <Icon name="flame" size={22} />
            <span className="tabular">{game.streak.lastDay === today || game.streak.lastDay === dayKey(Date.now() - 864e5) ? game.streak.current : 0}</span>
          </div>
        </button>
        <div className="quests">
          <span className="eyebrow">Today's quests {game.daily.day === today && game.daily.done && <em className="done-tag">Complete</em>}</span>
          <ul>
            {quests.map((q) => {
              const n = progress[q.counter] || 0;
              const done = n >= q.target;
              return (
                <li key={q.id} className={done ? 'done' : ''}>
                  <span className="check" aria-hidden="true">{done && <Icon name="check" size={14} />}</span>
                  <span className="grow">{q.label}</span>
                  <span className="hint tabular">{q.format ? q.format(Math.min(n, q.target)) : `${Math.min(n, q.target)}/${q.target}`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {resume && (
        <button className="resume" onClick={() => go({ name: 'doc', id: resume.id, tab: 'listen' })}>
          <span className="resume-play" aria-hidden="true">
            <Icon name="play" size={20} />
          </span>
          <span className="grow">
            <span className="eyebrow">Pick up where you left off</span>
            <strong>{resume.title}</strong>
          </span>
          <span className="hint tabular">{Math.round((resume.position / Math.max(1, resume.sentenceCount)) * 100)}%</span>
        </button>
      )}

      <section aria-label="Library">
        <div className="section-head">
          <h2>Library</h2>
          {Object.keys(docs).length > 4 && (
            <label className="search" htmlFor="lib-search">
              <Icon name="search" size={18} />
              <input id="lib-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>
        {list.length === 0 && (
          <Empty icon="book" title={query ? 'Nothing matches that search' : 'Your library is empty'}>
            {!query && (
              <button className="btn btn-sun" onClick={() => setAdding(true)}>
                Add your first piece
              </button>
            )}
          </Empty>
        )}
        <div className="doc-grid">
          {list.map((d) => {
            const pct = d.sentenceCount ? d.furthest / Math.max(1, d.sentenceCount - 1) : 0;
            const mastery = d.quiz.answered ? Math.round(d.quiz.totalScore / d.quiz.answered) : null;
            const sky = metaSummary(d);
            return (
              <article key={d.id} className="doc-card">
                <button className="doc-open" onClick={() => go({ name: 'doc', id: d.id, tab: 'listen' })}>
                  <span className="doc-kind">
                    <Icon name={SOURCE_ICON[d.source]} size={16} /> {SOURCE_LABEL[d.source]} · {minutesFor(d.wordCount, settings.rate)} min
                  </span>
                  <h3>{d.title}</h3>
                  <Horizon pct={pct} thin label="Listened" />
                  <span className="doc-stats">
                    <span>{Math.round(pct * 100)}% heard</span>
                    {sky.ideas > 0 ? (
                      <span className="star-count">
                        ★ {sky.lit}/{sky.ideas}
                        {sky.chapters > 1 && ` · ☀ ${sky.risen}/${sky.chapters}`}
                      </span>
                    ) : (
                      mastery !== null && <span>Understanding {mastery}</span>
                    )}
                    {sky.fading > 0 && <span className="fade-tag">{sky.fading} fading</span>}
                    {d.offline && <span className="offline-tag">Offline ready</span>}
                  </span>
                </button>
                <div className="doc-actions">
                  <button className="icon-btn" onClick={() => go({ name: 'doc', id: d.id, tab: 'map' })} aria-label={`Map of ${d.title}`} title="Understanding map">
                    <Icon name="map" size={18} />
                  </button>
                  <button className="icon-btn" onClick={() => setConfirm(d)} aria-label={`Remove ${d.title}`} title="Remove">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <AddSheet open={adding} onClose={() => setAdding(false)} />

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title="Remove from library?">
        <p>
          <strong>{confirm?.title}</strong> and its learning guide will be removed from all your devices. Your XP and badges stay.
        </p>
        <div className="row gap">
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm) {
                if (player.s.docId === confirm.id) player.close();
                removeDoc(confirm.id);
              }
              setConfirm(null);
            }}
          >
            Remove
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
            Keep it
          </button>
        </div>
      </Sheet>
    </div>
  );
}

type AddMode = 'paste' | 'file' | 'link';

export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const srv = useServer();
  const [mode, setMode] = useState<AddMode>('paste');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const linkReady = srv.reachable && (!srv.passcode || srv.authed);

  async function finish(item: Imported) {
    if (item.text.trim().length < 20) throw new Error('That came through almost empty. Try another source.');
    const id = await addDoc(item);
    const first = Object.keys(getState().docs).length <= 2;
    award('Added to your library', 10, { docsAdded: 1 });
    setText('');
    setTitle('');
    setUrl('');
    onClose();
    go({ name: 'doc', id, tab: first ? 'listen' : 'listen' });
  }

  async function run(fn: () => Promise<Imported>, label: string) {
    setError('');
    setBusy(label);
    try {
      await finish(await fn());
    } catch (e: any) {
      setError(e.message || 'That did not work. Try again.');
    } finally {
      setBusy('');
    }
  }

  const onFile = async (f?: File | null) => {
    if (!f) return;
    // A Rise audio file made on the computer: save its audio instead of adding a new piece.
    if (/\.zip$/i.test(f.name)) {
      setError('');
      setBusy('Adding the audio…');
      try {
        const r = await importAudioPack(f);
        if (r.onDevice) {
          onClose();
          go({ name: 'doc', id: r.docId, tab: 'listen' });
        } else setError(`Saved audio for "${r.title}". It will play once that piece syncs to this device.`);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy('');
      }
      return;
    }
    run(() => importFile(f), `Reading ${f.name}…`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add to your library" wide>
      <div className="add-modes" role="tablist" aria-label="Add from">
        {(
          [
            ['paste', 'clipboard', 'Paste text'],
            ['file', 'upload', 'Upload a file'],
            ['link', 'link', 'Web or Google Doc']
          ] as const
        ).map(([m, icon, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </div>

      {mode === 'paste' && (
        <div className="stack">
          <label className="field" htmlFor="add-title">
            <span>Title (optional)</span>
            <input id="add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rise will name it from the first line" />
          </label>
          <label className="field" htmlFor="add-text">
            <span>Text</span>
            <textarea id="add-text" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an article, notes, a chapter, a transcript…" />
          </label>
          <button className="btn btn-sun" disabled={!text.trim() || !!busy} onClick={() => run(async () => ({ title: title.trim() || titleFrom(text), text, source: 'paste' }), 'Adding…')}>
            Add and start listening
          </button>
        </div>
      )}

      {mode === 'file' && (
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="upload" size={32} />
          <p>
            <strong>Drop a file here</strong> or choose one
          </p>
          <p className="hint">PDF, EPUB ebooks, Word (.docx), text and Markdown. Files from Google Drive work too: download them first, or use the link option for Google Docs.</p>
          <input ref={fileRef} id="add-file" type="file" accept=".pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm,.zip" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn btn-sun" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            Choose a file
          </button>
        </div>
      )}

      {mode === 'link' && (
        <div className="stack">
          <label className="field" htmlFor="add-url">
            <span>Article or Google Doc link</span>
            <input id="add-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </label>
          <p className="hint">For Google Docs, set sharing to "Anyone with the link" first. Articles behind a login won't open; paste those instead.</p>
          {!linkReady && <p className="hint warn">Links need the Rise server, which isn't connected in this preview. Paste the text instead.</p>}
          <button className="btn btn-sun" disabled={!url.trim() || !!busy || !linkReady} onClick={() => run(() => importUrl(url), 'Fetching the page…')}>
            Import
          </button>
        </div>
      )}

      {busy && (
        <p className="hint" role="status">
          {busy}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
    </Sheet>
  );
}
