import { useMemo, useState } from 'react';
import { Icon } from './ui';
import { player, usePlayer } from '../lib/speech';
import { patchDoc, useApp } from '../lib/store';
import { go } from '../lib/nav';
import { headings, minutesFor, type Chapter, type Structured } from '../lib/text';

interface Props {
  id: string;
  title: string;
  s: Structured;
  chs: Chapter[];
  onClose: () => void;
}

/** Jump to any chapter, and choose by hand which headings count as chapters. */
export function ChaptersPanel({ id, title, s, chs, onClose }: Props) {
  const p = usePlayer();
  const meta = useApp((st) => st.docs[id]);
  const rate = useApp((st) => st.settings.rate);
  const [editing, setEditing] = useState(false);
  const index = p.docId === id ? p.index : meta?.position || 0;
  const cur = chs.find((c) => index >= c.start && index < c.end) || chs[0];

  const listenFrom = (sentence: number) => {
    if (p.docId !== id) player.load(id, title, s.sentences, sentence);
    player.play(sentence);
    onClose();
    go({ name: 'doc', id, tab: 'listen' });
  };

  if (editing) return <EditChapters id={id} s={s} chs={chs} onDone={() => setEditing(false)} />;

  const prev = cur && chs[cur.index - 1];
  const next = cur && chs[cur.index + 1];

  return (
    <div className="stack">
      {cur && (
        <div className="chapter-now">
          <span className="hint">You're in</span>
          <strong>{cur.label}</strong>
          <div className="row gap wrap">
            <button className="btn btn-sun sm" onClick={() => listenFrom(index)}>
              <Icon name="play" size={16} /> Continue
            </button>
            <button className="btn btn-ghost sm" onClick={() => listenFrom(cur.start)}>
              Start of chapter
            </button>
          </div>
          <div className="row gap wrap">
            <button className="btn btn-ghost sm" disabled={!prev} onClick={() => prev && listenFrom(prev.start)}>
              <Icon name="prev" size={16} /> Previous
            </button>
            <button className="btn btn-ghost sm" disabled={!next} onClick={() => next && listenFrom(next.start)}>
              Next <Icon name="next" size={16} />
            </button>
          </div>
        </div>
      )}
      <ul className="chapter-list">
        {chs.map((c) => {
          const now = c === cur;
          return (
            <li key={c.index} className={now ? 'now' : ''}>
              <button className="chapter-row" onClick={() => listenFrom(c.start)}>
                <span className="cp-num tabular">{c.index + 1}</span>
                <span className="grow">
                  <strong>{c.title}</strong>
                  <small className="hint tabular">
                    {minutesFor(Math.round(c.chars / 5.5), rate)} min{now ? ' · you are here' : ''}
                  </small>
                </span>
                <Icon name="play" size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`Quiz chapter ${c.index + 1}`}
                title="Quiz this chapter"
                onClick={() => {
                  onClose();
                  go({ name: 'doc', id, tab: 'quiz', focus: { mode: 'chapter', chapter: c.index } });
                }}
              >
                <Icon name="target" size={18} />
              </button>
            </li>
          );
        })}
      </ul>
      <button className="link-btn" onClick={() => setEditing(true)}>
        Wrong chapters? Choose them yourself
      </button>
    </div>
  );
}

function EditChapters({ id, s, chs, onDone }: { id: string; s: Structured; chs: Chapter[]; onDone: () => void }) {
  const meta = useApp((st) => st.docs[id]);
  const hs = useMemo(() => headings(s), [s]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(meta?.chapterStarts?.length ? meta.chapterStarts : chs.map((c) => c.start)));
  const [showAll, setShowAll] = useState(false);
  const minLevel = hs.length ? Math.min(...hs.map((h) => h.level)) : 1;
  const list = showAll ? hs : hs.filter((h) => h.level <= minLevel + 1 || picked.has(h.start));

  const save = (starts: number[] | undefined) => {
    patchDoc(id, (d) => {
      if (starts?.length) d.chapterStarts = starts;
      else delete d.chapterStarts;
    });
    onDone();
  };

  if (!hs.length) {
    return (
      <div className="stack">
        <p className="hint">This piece has no headings, so Rise splits it into parts by length. Headings come through when you import a PDF, ebook, Word file or web article.</p>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="hint">Check each heading that starts a big chapter. Everything under it, including smaller sections, stays in that chapter.</p>
      <ul className="heading-picks">
        {list.map((h) => (
          <li key={h.start} style={{ paddingLeft: `${(h.level - minLevel) * 18}px` }}>
            <label>
              <input
                type="checkbox"
                checked={picked.has(h.start)}
                onChange={(e) => {
                  const n = new Set(picked);
                  e.target.checked ? n.add(h.start) : n.delete(h.start);
                  setPicked(n);
                }}
              />
              <span className="grow">{h.title.length > 80 ? h.title.slice(0, 78) + '…' : h.title}</span>
            </label>
          </li>
        ))}
      </ul>
      {!showAll && list.length < hs.length && (
        <button className="link-btn" onClick={() => setShowAll(true)}>
          Show all {hs.length} headings
        </button>
      )}
      <div className="row gap wrap">
        <button className="btn btn-sun" disabled={!picked.size} onClick={() => save([...picked].sort((a, b) => a - b))}>
          Save {picked.size} chapters
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      {meta?.chapterStarts?.length ? (
        <button className="link-btn" onClick={() => save(undefined)}>
          Reset to automatic
        </button>
      ) : null}
    </div>
  );
}
