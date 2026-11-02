import { crumb } from '../lib/crumbs';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, Sheet } from '../components/ui';
import { player, usePlayer } from '../lib/speech';
import { setSettings, useApp } from '../lib/store';
import { go } from '../lib/nav';
import { chapterAt, minutesFor, type Chapter, type Para, type Structured } from '../lib/text';
import { SpeedControl, VoicePicker } from '../components/VoicePicker';

interface ParaProps {
  para: Para;
  active: number; // global index of the active sentence, or -1 if not in this paragraph
  word: [number, number] | null;
  onPick: (i: number) => void;
}

const Paragraph = memo(function Paragraph({ para, active, word, onPick }: ParaProps) {
  const Tag = para.heading ? 'h2' : 'p';
  return (
    <Tag className={para.heading ? `rh rh-${para.heading}` : 'rp'}>
      {para.sentences.map((sent, k) => {
        const i = para.start + k;
        const on = i === active;
        let inner: ReactNode = sent;
        if (on && word) {
          inner = (
            <>
              {sent.slice(0, word[0])}
              <mark className="w">{sent.slice(word[0], word[0] + word[1])}</mark>
              {sent.slice(word[0] + word[1])}
            </>
          );
        }
        return (
          <span key={i} data-i={i} className={`s ${on ? 'on' : ''}`} onClick={() => onPick(i)}>
            {inner}{' '}
          </span>
        );
      })}
    </Tag>
  );
});

export function Reader({ id, title, s, chs, onChapters }: { id: string; title: string; s: Structured; chs: Chapter[]; onChapters: () => void }) {
  const p = usePlayer();
  const meta = useApp((st) => st.docs[id]);
  const st = useApp((x) => x.settings);
  const [sheet, setSheet] = useState<'voice' | 'speed' | 'text' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const mine = p.docId === id;
  const index = mine ? p.index : meta?.position || 0;
  const userScrolled = useRef(0);
  // Words before each sentence, counted once. (Counting the rest of a long book on every word was slow and used lots of memory.)
  const wordsBefore = useMemo(() => {
    const a = new Int32Array(s.sentences.length + 1);
    for (let k = 0; k < s.sentences.length; k++) a[k + 1] = a[k] + (s.sentences[k].match(/\S+/g) || []).length;
    return a;
  }, [s]);
  const remaining = wordsBefore[s.sentences.length] - wordsBefore[Math.min(index, s.sentences.length)];

  // Only the text near where you are is drawn. Long books stay fast and light, even on a phone.
  const paraOf = (i: number) => {
    let lo = 0;
    let hi = s.paras.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.paras[mid].start <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const BEFORE = 60;
  const AFTER = 160;
  const [win, setWin] = useState<[number, number]>(() => {
    const k = paraOf(index);
    return [Math.max(0, k - BEFORE), Math.min(s.paras.length, k + AFTER)];
  });
  const here = paraOf(index);
  useEffect(() => {
    if (here < win[0] + 5 || here > win[1] - 20) setWin([Math.max(0, here - BEFORE), Math.min(s.paras.length, here + AFTER)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, s]);
  const shown = s.paras.slice(win[0], win[1]);

  useEffect(() => {
    if (!mine) player.load(id, title, s.sentences, meta?.position || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onScroll = () => (userScrolled.current = Date.now());
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('touchmove', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!mine || !st.autoScroll || st.focusMode) return;
    if (Date.now() - userScrolled.current < 4000) return;
    const el = box.current?.querySelector(`[data-i="${index}"]`) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 170) {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [index, mine, st.autoScroll, st.focusMode, win[0]]);

  useEffect(() => crumb('reader shown'), []);
  const pickNow = (i: number) => {
    if (!mine) player.load(id, title, s.sentences, i);
    player.play(i);
  };
  // A stable handler, so paragraphs that didn't change aren't redrawn every time a word is highlighted.
  const pickRef = useRef(pickNow);
  pickRef.current = pickNow;
  const pick = useCallback((i: number) => pickRef.current(i), []);

  const start = () => {
    if (!mine) player.load(id, title, s.sentences, meta?.position || 0);
    player.toggle();
  };

  const word = mine && st.wordHighlight ? p.word : null;
  const font = st.readingFont === 'serif' ? 'var(--serif)' : st.readingFont === 'lexend' ? 'var(--display)' : 'var(--body)';

  return (
    <div className="reader-wrap">
      <div className="reader-tools">
        <button className={`btn btn-sun listen-btn ${mine && p.playing ? 'on' : ''}`} onClick={start}>
          <Icon name={mine && p.playing ? 'pause' : 'play'} size={20} />
          {mine && p.playing ? 'Pause' : index > 0 ? 'Resume' : 'Listen'}
        </button>
        <span className="hint tabular">{minutesFor(remaining, st.rate)} min left</span>
        <div className="grow" />
        {chs.length > 1 && (
          <button className="pill" onClick={onChapters} aria-label="Chapters">
            <Icon name="list" size={18} />
            <span className="tabular">Ch {(chapterAt(chs, index)?.index ?? 0) + 1}</span>
          </button>
        )}
        <button className="pill" onClick={() => setSheet('speed')} aria-label="Speed">
          <span className="tabular">{st.rate.toFixed(2).replace(/\.?0+$/, '')}×</span>
        </button>
        <button className="pill" onClick={() => setSheet('voice')} aria-label="Voice">
          <Icon name="wave" size={18} />
        </button>
        <button className={`pill ${st.focusMode ? 'on' : ''}`} onClick={() => setSettings({ focusMode: !st.focusMode })} aria-pressed={st.focusMode} aria-label="Focus mode">
          <Icon name="focus" size={18} />
        </button>
        <button className="pill" onClick={() => setSheet('text')} aria-label="Text settings">
          <Icon name="type" size={18} />
        </button>
      </div>

      {st.focusMode ? (
        <div className="focus-view" style={{ fontFamily: font }}>
          <p className="focus-prev">{s.sentences[index - 1] || ''}</p>
          <p className="focus-now" aria-live="polite">
            {word ? (
              <>
                {s.sentences[index].slice(0, word[0])}
                <mark className="w">{s.sentences[index].slice(word[0], word[0] + word[1])}</mark>
                {s.sentences[index].slice(word[0] + word[1])}
              </>
            ) : (
              s.sentences[index]
            )}
          </p>
          <p className="focus-next">{s.sentences[index + 1] || ''}</p>
          <div className="row gap center">
            <button className="btn btn-ghost" onClick={() => (mine ? player.prev() : pick(Math.max(0, index - 1)))}>
              <Icon name="prev" size={18} /> Back
            </button>
            <button className="btn btn-ghost" onClick={() => (mine ? player.next() : pick(index + 1))}>
              Next <Icon name="next" size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div ref={box} className="reading" style={{ fontFamily: font, fontSize: `${st.fontSize}px`, lineHeight: st.lineHeight }}>
          {win[0] > 0 && (
            <button className="btn btn-ghost sm show-more" onClick={() => setWin([Math.max(0, win[0] - 120), win[1]])}>
              Show earlier text
            </button>
          )}
          {shown.map((para, j) => {
            const k = win[0] + j;
            const inPara = index >= para.start && index < para.start + para.sentences.length;
            return <Paragraph key={k} para={para} active={mine && inPara ? index : !mine && inPara && index > 0 ? index : -1} word={inPara ? word : null} onPick={pick} />;
          })}
          {win[1] < s.paras.length && (
            <button className="btn btn-ghost sm show-more" onClick={() => setWin([win[0], Math.min(s.paras.length, win[1] + 200)])}>
              Show more text
            </button>
          )}
          {win[1] >= s.paras.length && <div className="reading-end">
            <p>Done listening? Lock it in.</p>
            <div className="row gap center">
              <button className="btn btn-sun" onClick={() => go({ name: 'doc', id, tab: 'quiz' })}>
                <Icon name="target" size={18} /> Quiz me
              </button>
              <button className="btn btn-ghost" onClick={() => go({ name: 'doc', id, tab: 'learn' })}>
                <Icon name="spark" size={18} /> Build a learning guide
              </button>
            </div>
          </div>}
        </div>
      )}

      <Sheet open={sheet === 'voice'} onClose={() => setSheet(null)} title="Voice">
        <VoicePicker />
      </Sheet>
      <Sheet open={sheet === 'speed'} onClose={() => setSheet(null)} title="Speed">
        <SpeedControl />
      </Sheet>
      <Sheet open={sheet === 'text'} onClose={() => setSheet(null)} title="Reading view">
        <TextSettings />
      </Sheet>
    </div>
  );
}

export function TextSettings() {
  const st = useApp((s) => s.settings);
  return (
    <div className="stack">
      <div className="field">
        <span>Font</span>
        <div className="chips">
          {(
            [
              ['atkinson', 'Hyperlegible'],
              ['lexend', 'Lexend'],
              ['serif', 'Book serif']
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={`chip ${st.readingFont === v ? 'on' : ''}`} onClick={() => setSettings({ readingFont: v })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="field" htmlFor="font-size">
        <span>
          Text size <span className="tabular">{st.fontSize}px</span>
        </span>
        <input id="font-size" type="range" min={15} max={34} step={1} value={st.fontSize} onChange={(e) => setSettings({ fontSize: Number(e.target.value) })} />
      </label>
      <label className="field" htmlFor="line-height">
        <span>
          Line spacing <span className="tabular">{st.lineHeight.toFixed(1)}</span>
        </span>
        <input id="line-height" type="range" min={1.3} max={2.4} step={0.1} value={st.lineHeight} onChange={(e) => setSettings({ lineHeight: Number(e.target.value) })} />
      </label>
      <label className="toggle-row" htmlFor="wh">
        <span className="toggle-label">Highlight each word as it's read</span>
        <input id="wh" type="checkbox" className="switch" checked={st.wordHighlight} onChange={(e) => setSettings({ wordHighlight: e.target.checked })} />
      </label>
      <label className="toggle-row" htmlFor="as">
        <span className="toggle-label">Follow along automatically</span>
        <input id="as" type="checkbox" className="switch" checked={st.autoScroll} onChange={(e) => setSettings({ autoScroll: e.target.checked })} />
      </label>
    </div>
  );
}
