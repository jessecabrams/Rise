import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chapters } from '../lib/text';
import { Icon, Sheet } from '../components/ui';
import { player, usePlayer } from '../lib/speech';
import { setSettings, useApp } from '../lib/store';
import { go } from '../lib/nav';
import { minutesFor, type Para, type Structured } from '../lib/text';
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

export function Reader({ id, title, s }: { id: string; title: string; s: Structured }) {
  const p = usePlayer();
  const meta = useApp((st) => st.docs[id]);
  const st = useApp((x) => x.settings);
  const [sheet, setSheet] = useState<'voice' | 'speed' | 'text' | 'chapters' | null>(null);
  const chs = useMemo(() => chapters(s, title), [s, title]);
  const box = useRef<HTMLDivElement>(null);
  const mine = p.docId === id;
  const index = mine ? p.index : meta?.position || 0;
  const userScrolled = useRef(0);

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
  }, [index, mine, st.autoScroll, st.focusMode]);

  const pick = (i: number) => {
    if (!mine) player.load(id, title, s.sentences, i);
    player.play(i);
  };

  const start = () => {
    if (!mine) player.load(id, title, s.sentences, meta?.position || 0);
    player.toggle();
  };

  const word = mine && st.wordHighlight ? p.word : null;
  const remaining = s.sentences.slice(index).join(' ').split(/\s+/).length;
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
          <button className="pill" onClick={() => setSheet('chapters')} aria-label="Chapters">
            <Icon name="list" size={18} />
            <span className="tabular">Ch {(chs.find((c) => index >= c.start && index < c.end)?.index ?? 0) + 1}</span>
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
          {s.paras.map((para, k) => {
            const inPara = index >= para.start && index < para.start + para.sentences.length;
            return <Paragraph key={k} para={para} active={mine && inPara ? index : !mine && inPara && index > 0 ? index : -1} word={inPara ? word : null} onPick={pick} />;
          })}
          <div className="reading-end">
            <p>Done listening? Lock it in.</p>
            <div className="row gap center">
              <button className="btn btn-sun" onClick={() => go({ name: 'doc', id, tab: 'quiz' })}>
                <Icon name="target" size={18} /> Quiz me
              </button>
              <button className="btn btn-ghost" onClick={() => go({ name: 'doc', id, tab: 'learn' })}>
                <Icon name="spark" size={18} /> Build a learning guide
              </button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={sheet === 'voice'} onClose={() => setSheet(null)} title="Voice">
        <VoicePicker />
      </Sheet>
      <Sheet open={sheet === 'speed'} onClose={() => setSheet(null)} title="Speed">
        <SpeedControl />
      </Sheet>
      <Sheet open={sheet === 'chapters'} onClose={() => setSheet(null)} title="Chapters">
        <ul className="chapter-list">
          {chs.map((c) => {
            const now = index >= c.start && index < c.end;
            return (
              <li key={c.index} className={now ? 'now' : ''}>
                <button
                  className="chapter-row"
                  onClick={() => {
                    setSheet(null);
                    pick(c.start);
                  }}
                >
                  <span className="cp-num tabular">{c.index + 1}</span>
                  <span className="grow">
                    <strong>{c.title}</strong>
                    <small className="hint tabular">
                      {minutesFor(Math.round(c.chars / 5.5), st.rate)} min{now ? ' · reading now' : ''}
                    </small>
                  </span>
                  <Icon name="play" size={16} />
                </button>
                <button className="icon-btn" aria-label={`Quiz chapter ${c.index + 1}`} title="Quiz this chapter" onClick={() => go({ name: 'doc', id, tab: 'quiz', focus: { mode: 'chapter', chapter: c.index } })}>
                  <Icon name="target" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
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
