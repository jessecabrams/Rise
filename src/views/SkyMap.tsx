import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ErrorNote, Horizon, Icon, ScoreRing, Sheet } from '../components/ui';
import { patchDoc, useApp } from '../lib/store';
import { go } from '../lib/nav';
import { player, say } from '../lib/speech';
import { type Chapter } from '../lib/text';
import { buildIdeas, chapterStats, daysUntilFade, docStats, isFading, LIT, starState, strength, type StarState } from '../lib/mastery';
import type { ChapterMap, DocMeta, IdeaNode } from '../lib/types';
import type { DocCtx } from './Doc';

/* ---------- geometry ---------- */
const W = 360;
const R = 34; // chapter sun radius
const STEP = 224;
const TOP = 150;
const STAR_RING = 68;
const STRIPES = ['#F25B2C', '#F25B2C', '#F7941D', '#FDAF40', '#FDC20D'];
const RAYS = ['#024272', '#0A6999', '#1D80BC', '#00ADF1'];

const nodePos = (i: number) => ({ x: i % 2 === 0 ? 104 : 256, y: TOP + i * STEP });

function wedge(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x1, y1] = p(r2, a1);
  const [x2, y2] = p(r2, a2);
  const [x3, y3] = p(r1, a2);
  const [x4, y4] = p(r1, a1);
  return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`;
}

const starPath = (k: number) =>
  `M0 ${-k}L${k * 0.26} ${-k * 0.26}L${k} 0L${k * 0.26} ${k * 0.26}L0 ${k}L${-k * 0.26} ${k * 0.26}L${-k} 0L${-k * 0.26} ${-k * 0.26}Z`;
const STAR_SIZE: Record<StarState, number> = { dark: 6, dim: 7, glow: 8.5, lit: 10.5 };

function starAngles(n: number) {
  if (n <= 1) return [270];
  return Array.from({ length: n }, (_, j) => 198 + (j * 144) / (n - 1));
}

function wrap(t: string, max = 22): string[] {
  const words = t.split(/\s+/);
  const lines: string[] = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length <= max) lines[lines.length - 1] = (cur + ' ' + w).trim();
    else if (lines.length < 2) lines.push(w);
    else {
      lines[1] = (lines[1].length > max - 1 ? lines[1].slice(0, max - 1) : lines[1]) + '…';
      break;
    }
  }
  if (lines[1] && lines[1].length > max) lines[1] = lines[1].slice(0, max - 1) + '…';
  return lines.filter(Boolean);
}

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function useWide() {
  const q = '(min-width: 1120px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return wide;
}

function ago(t: number) {
  const d = Math.floor((Date.now() - t) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function listenAt(ctx: DocCtx, i: number) {
  if (player.s.docId !== ctx.id) player.load(ctx.id, ctx.title, ctx.s.sentences, i);
  player.play(i);
  go({ name: 'doc', id: ctx.id, tab: 'listen' });
}

const keyPick = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

type Sel = { ch: number; idea?: string } | null;

/* ---------- the map ---------- */
export function SkyMap({ ctx }: { ctx: DocCtx }) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const chs = ctx.chs;
  const map = ctx.body.map || {};
  const wide = useWide();
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const cancel = useRef(false);
  const [error, setError] = useState('');
  const ds = docStats(meta, ctx.body);
  const unmapped = chs.filter((c) => !map[c.index]);

  useEffect(() => {
    if (meta && meta.chapterTotal !== chs.length) patchDoc(ctx.id, (d) => (d.chapterTotal = chs.length));
  }, [chs.length, ctx.id, meta]);

  async function mapOne(c: Chapter) {
    setBusy(c.index);
    setError('');
    try {
      await buildIdeas(ctx, c);
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(null);
    }
  }

  async function mapAll() {
    cancel.current = false;
    const todo = chs.filter((c) => !ctx.bodyRef.current.map?.[c.index]);
    setRun({ done: 0, total: todo.length });
    for (let k = 0; k < todo.length; k++) {
      if (cancel.current) break;
      try {
        await mapOne(todo[k]);
      } catch {
        break;
      }
      setRun({ done: k + 1, total: todo.length });
    }
    setRun(null);
  }

  const selCh = sel ? chs[sel.ch] : undefined;
  const selMap = sel ? map[sel.ch] : undefined;
  const selIdea = sel?.idea ? selMap?.ideas.find((i) => i.id === sel.idea) : undefined;

  const panel = selCh ? (
    selIdea ? (
      <IdeaPanel ctx={ctx} ch={selCh} idea={selIdea} meta={meta} onBack={() => setSel({ ch: selCh.index })} />
    ) : (
      <ChapterPanel ctx={ctx} ch={selCh} cm={selMap} meta={meta} busy={busy === selCh.index} onIdea={(id) => setSel({ ch: selCh.index, idea: id })} onMap={() => mapOne(selCh).catch(() => {})} single={chs.length === 1} />
    )
  ) : (
    <Legend />
  );

  return (
    <div className="skymap">
      <section className="sky-stats" aria-label="Understanding">
        <div className="sky-stat main">
          <ScoreRing score={Math.round(ds.pct * 100)} size={64} />
          <span>
            <strong>Understanding</strong>
            <small>across every mapped idea</small>
          </span>
        </div>
        <div className="sky-stat">
          <strong className="tabular">
            {ds.lit}
            <small>/{ds.ideas || '–'}</small>
          </strong>
          <span>stars lit</span>
        </div>
        <div className="sky-stat">
          <strong className="tabular">
            {ds.risen}
            <small>/{chs.length}</small>
          </strong>
          <span>{chs.length === 1 ? 'sun risen' : 'suns risen'}</span>
        </div>
        <div className={`sky-stat ${ds.fading ? 'warn' : ''}`}>
          <strong className="tabular">{ds.fading}</strong>
          <span>fading</span>
        </div>
      </section>

      <div className="row gap wrap">
        {ds.fading > 0 && (
          <button className="btn btn-sun" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'quiz', focus: { mode: 'review' } })}>
            <Icon name="flame" size={18} /> Revive {ds.fading} fading {ds.fading === 1 ? 'star' : 'stars'}
          </button>
        )}
        {unmapped.length > 0 && !run && (
          <button className={ds.fading ? 'btn btn-ghost' : 'btn btn-sun'} onClick={mapAll} disabled={busy !== null}>
            <Icon name="map" size={18} />
            {chs.length === 1 ? 'Map the ideas' : unmapped.length === chs.length ? `Map all ${chs.length} chapters` : `Map the other ${unmapped.length}`}
          </button>
        )}
        {run && (
          <div className="map-run" role="status">
            <span className="tabular">
              Mapping chapter {Math.min(run.done + 1, run.total)} of {run.total}…
            </span>
            <Horizon pct={run.done / run.total} thin label="Mapping progress" />
            <button className="btn btn-ghost sm" onClick={() => (cancel.current = true)}>
              Stop after this one
            </button>
          </div>
        )}
        {ds.mapped > 0 && ds.fading === 0 && (
          <button className="btn btn-ghost" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'quiz', focus: { mode: 'review' } })}>
            <Icon name="target" size={18} /> Practice my weakest ideas
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}

      <div className={`sky-layout ${wide ? 'wide' : ''}`}>
        <SkyCanvas ctx={ctx} chs={chs} map={map} meta={meta} sel={sel} busy={busy} onPick={setSel} />
        {wide ? <aside className="sky-panel">{panel}</aside> : !sel && <Legend />}
      </div>

      {!wide && (
        <Sheet open={!!sel} onClose={() => setSel(null)} title={selIdea ? 'Idea' : selCh ? (chs.length > 1 ? `Chapter ${selCh.index + 1}` : 'Your piece') : ''}>
          {panel}
        </Sheet>
      )}
    </div>
  );
}

function SkyCanvas({
  ctx,
  chs,
  map,
  meta,
  sel,
  busy,
  onPick
}: {
  ctx: DocCtx;
  chs: Chapter[];
  map: Record<string, ChapterMap>;
  meta?: DocMeta;
  sel: Sel;
  busy: number | null;
  onPick: (s: Sel) => void;
}) {
  const n = chs.length;
  const summit = { x: W / 2, y: TOP + n * STEP - 30 };
  const H = summit.y + 92;
  const stats = chs.map((c) => chapterStats(meta, map[c.index]));
  const allRisen = n > 0 && stats.every((s) => s.risen);
  const risenCount = stats.filter((s) => s.risen).length;
  const sky = useMemo(() => {
    const rnd = seeded(ctx.id);
    return Array.from({ length: Math.round(H / 9) }, () => ({ x: rnd() * W, y: rnd() * H, r: rnd() * 1.1 + 0.3, o: rnd() * 0.5 + 0.15 }));
  }, [ctx.id, H]);

  const pts = [...chs.map((_, i) => nodePos(i)), summit];
  const uid = ctx.id.replace(/\W/g, '');

  return (
    <div className="sky-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} className="sky-svg" role="group" aria-label="Map of your understanding">
        <defs>
          <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#021428" />
            <stop offset="0.7" stopColor="#03264a" />
            <stop offset="1" stopColor="#0a4f80" />
          </linearGradient>
          <radialGradient id={`glow${uid}`}>
            <stop offset="0" stopColor="#FDAF40" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FDAF40" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`path${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FDC20D" />
            <stop offset="1" stopColor="#F25B2C" />
          </linearGradient>
          {chs.map((c, i) => (
            <clipPath key={c.index} id={`clip${uid}${i}`}>
              <circle cx={pts[i].x} cy={pts[i].y} r={R} />
            </clipPath>
          ))}
          <clipPath id={`clipS${uid}`}>
            <rect x={summit.x - 70} y={summit.y - 70} width={140} height={70} />
          </clipPath>
        </defs>
        <rect width={W} height={H} fill={`url(#bg${uid})`} />
        {sky.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
        ))}

        {/* journey path */}
        {pts.slice(0, -1).map((p, i) => {
          const q = pts[i + 1];
          const d = `M${p.x} ${p.y + R}C${p.x} ${p.y + STEP * 0.55} ${q.x} ${q.y - STEP * 0.6} ${q.x} ${q.y - (i + 1 === n ? 64 : STAR_RING + 18)}`;
          return <path key={i} d={d} className={`trail ${stats[i]?.risen ? "lit" : ""}`} style={stats[i]?.risen ? { stroke: `url(#path${uid})` } : undefined} />;
        })}

        {chs.map((c, i) => {
          const { x, y } = pts[i];
          const cm = map[c.index];
          const st = stats[i];
          const isSel = sel?.ch === c.index && !sel.idea;
          const lines = wrap(c.title);
          const angles = starAngles(cm?.ideas.length || 0);
          const starPts = (cm?.ideas || []).map((idea, j) => {
            const a = (angles[j] * Math.PI) / 180;
            return { idea, x: x + STAR_RING * Math.cos(a), y: y + STAR_RING * Math.sin(a), stat: meta?.ideas?.[idea.id] };
          });
          return (
            <g key={c.index} className="chapter-node">
              {st.risen && <circle cx={x} cy={y} r={R + 46} fill={`url(#glow${uid})`} className="risen-glow" />}
              {/* rays: one per quarter of ideas lit */}
              {cm &&
                RAYS.map((col, k) => (
                  <path key={k} d={wedge(x, y, R + 5, R + 19, 180 + k * 45 + 2, 180 + (k + 1) * 45 - 2)} fill={col} className={`ray ${k < st.rays ? 'on' : ''}`} />
                ))}
              {/* constellation lines */}
              {starPts.slice(1).map((sp, j) => {
                const a = starPts[j];
                const v = Math.min(strength(a.stat), strength(sp.stat));
                return v >= 50 ? <line key={j} x1={a.x} y1={a.y} x2={sp.x} y2={sp.y} className="constel" opacity={v >= LIT ? 0.75 : 0.35} /> : null;
              })}
              {/* the chapter sun */}
              <g
                role="button"
                tabIndex={0}
                aria-label={`${c.title}. ${cm ? `${st.lit} of ${st.total} ideas lit` : 'Not mapped yet'}`}
                className={`sun-btn ${isSel ? 'sel' : ''}`}
                onClick={() => onPick({ ch: c.index })}
                onKeyDown={keyPick(() => onPick({ ch: c.index }))}
              >
                <circle cx={x} cy={y} r={R + 3} className="hit" />
                <circle cx={x} cy={y} r={R} className={`sun-base ${cm ? '' : 'unmapped'} ${busy === c.index ? 'busy' : ''}`} />
                {cm && (
                  <g clipPath={`url(#clip${uid}${i})`}>
                    <g className="sun-fill" style={{ transform: `translateY(${(1 - Math.max(st.pct, st.practiced ? 0.06 : 0)) * 2 * R}px)` }}>
                      {STRIPES.map((col, k) => (
                        <rect key={k} x={x - R} y={y - R + k * ((2 * R) / STRIPES.length) + 1.5} width={2 * R} height={(2 * R) / STRIPES.length - 3} fill={col} />
                      ))}
                    </g>
                  </g>
                )}
                {isSel && <circle cx={x} cy={y} r={R + 24} className="sel-ring" />}
                <text x={x} y={y + 6} className="sun-num">
                  {cm ? c.index + 1 : '?'}
                </text>
                {lines.map((l, k) => (
                  <text key={k} x={x} y={y + R + 22 + k * 14} className="sun-title">
                    {l}
                  </text>
                ))}
                <text x={x} y={y + R + 24 + lines.length * 14} className={`sun-sub ${st.risen ? 'risen' : ''}`}>
                  {busy === c.index ? 'Mapping…' : cm ? (st.risen ? `☀ Risen · ${st.total} ★` : `★ ${st.lit}/${st.total}`) : 'Tap to map'}
                </text>
              </g>
              {/* idea stars */}
              {starPts.map(({ idea, x: sx, y: sy, stat }) => {
                const state = starState(stat);
                const fade = isFading(stat);
                const on = sel?.idea === idea.id;
                return (
                  <g
                    key={idea.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${idea.title}. ${stat?.n ? `${strength(stat)} percent` : 'Not tested yet'}${fade ? ', fading' : ''}`}
                    className={`star s-${state} ${fade ? 'fading' : ''} ${on ? 'sel' : ''}`}
                    transform={`translate(${sx} ${sy})`}
                    onClick={() => onPick({ ch: c.index, idea: idea.id })}
                    onKeyDown={keyPick(() => onPick({ ch: c.index, idea: idea.id }))}
                  >
                    <title>{idea.title}</title>
                    <circle r={17} className="hit" />
                    {state === 'lit' && <circle r={15} className="star-halo" />}
                    <path d={starPath(STAR_SIZE[state])} className="star-shape" />
                    {fade && <circle cx={9} cy={-9} r={3.2} className="fade-dot" />}
                    {on && <circle r={15} className="sel-ring" />}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* the mastery sun */}
        <g className={`summit ${allRisen ? 'won' : ''}`} aria-label={allRisen ? 'Mastered' : `${risenCount} of ${n} suns risen`}>
          {allRisen && <circle cx={summit.x} cy={summit.y} r={110} fill={`url(#glow${uid})`} />}
          {RAYS.map((col, k) => (
            <path key={k} d={wedge(summit.x, summit.y, 58, 84, 180 + k * 45 + 2, 180 + (k + 1) * 45 - 2)} fill={col} className={`ray ${n && k < Math.floor((risenCount / n) * 4) ? 'on' : ''}`} />
          ))}
          <g clipPath={`url(#clipS${uid})`}>
            <circle cx={summit.x} cy={summit.y} r={52} className="summit-base" />
            <g className="sun-fill" style={{ transform: `translateY(${(1 - (n ? risenCount / n : 0)) * 52}px)` }}>
              <circle cx={summit.x} cy={summit.y} r={52} fill="#F25B2C" />
            </g>
          </g>
          {['#F25B2C', '#F7941D', '#FDAF40', '#FDC20D'].map((col, k) => (
            <rect key={k} x={summit.x - 70 + k * 10} y={summit.y + 6 + k * 13} width={140 - k * 20} height={8} rx={4} fill={col} className={`summit-stripe ${n && risenCount / n > k / 4 ? 'on' : ''}`} />
          ))}
          <text x={summit.x} y={summit.y - 14} className="summit-label">
            {allRisen ? 'MASTERED' : 'MASTERY'}
          </text>
        </g>
      </svg>
    </div>
  );
}

/* ---------- panels ---------- */
function MiniStar({ state, fading }: { state: StarState; fading?: boolean }) {
  return (
    <svg viewBox="-12 -12 24 24" width="22" height="22" className={`mini-star s-${state} ${fading ? 'fading' : ''}`} aria-hidden="true">
      <path d={starPath(state === 'lit' ? 10.5 : 9)} />
    </svg>
  );
}

const STATE_WORD: Record<StarState, string> = { dark: 'Not tested yet', dim: 'Dim', glow: 'Glowing', lit: 'Lit' };

function ChapterPanel({ ctx, ch, cm, meta, busy, onIdea, onMap, single }: { ctx: DocCtx; ch: Chapter; cm?: ChapterMap; meta?: DocMeta; busy: boolean; onIdea: (id: string) => void; onMap: () => void; single: boolean }) {
  const st = chapterStats(meta, cm);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="panel stack">
      <div>
        {!single && <span className="eyebrow">Chapter {ch.index + 1}</span>}
        <h3 className="panel-title">{ch.title}</h3>
      </div>
      {!cm ? (
        <>
          <p className="hint">Map this chapter and Rise pulls out its core ideas. Each one becomes a star you light by explaining it.</p>
          <button className="btn btn-sun" onClick={onMap} disabled={busy}>
            <Icon name="map" size={18} /> {busy ? 'Mapping…' : 'Map the ideas'}
          </button>
        </>
      ) : (
        <>
          <div className="panel-meter">
            <span className={`tabular ${st.risen ? 'risen' : ''}`}>{st.risen ? '☀ Sun risen' : `★ ${st.lit} of ${st.total} lit`}</span>
            <span className="hint tabular">{Math.round(st.pct * 100)}% understood</span>
          </div>
          <Horizon pct={st.pct} label="Chapter understanding" />
          <ul className="idea-rows">
            {cm.ideas.map((i) => {
              const s = meta?.ideas?.[i.id];
              const state = starState(s);
              return (
                <li key={i.id}>
                  <button onClick={() => onIdea(i.id)}>
                    <MiniStar state={state} fading={isFading(s)} />
                    <span className="grow">{i.title}</span>
                    {isFading(s) && <span className="fade-tag">fading</span>}
                    <span className="hint tabular">{s?.n ? strength(s) : '–'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="row gap wrap">
        {cm && (
          <button className="btn btn-sun" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'quiz', focus: { mode: 'chapter', chapter: ch.index } })}>
            <Icon name="target" size={18} /> Quiz this {single ? 'piece' : 'chapter'}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => listenAt(ctx, ch.start)}>
          <Icon name="headphones" size={18} /> Listen
        </button>
      </div>
      {cm && (
        <button
          className="link-btn"
          disabled={busy}
          onClick={() => {
            if (!confirm) setConfirm(true);
            else {
              setConfirm(false);
              onMap();
            }
          }}
        >
          {busy ? 'Remapping…' : confirm ? 'Remapping resets these stars. Tap again to confirm.' : 'Remap ideas'}
        </button>
      )}
    </div>
  );
}

function IdeaPanel({ ctx, ch, idea, meta, onBack }: { ctx: DocCtx; ch: Chapter; idea: IdeaNode; meta?: DocMeta; onBack: () => void }) {
  const s = meta?.ideas?.[idea.id];
  const state = starState(s);
  const fade = isFading(s);
  const left = daysUntilFade(s);
  const v = strength(s);
  return (
    <div className="panel stack">
      <button className="link-btn back" onClick={onBack}>
        <Icon name="back" size={16} /> {ch.title}
      </button>
      <div className="idea-head">
        <svg viewBox="-14 -14 28 28" width="52" height="52" className={`big-star s-${state} ${fade ? 'fading' : ''}`} aria-hidden="true">
          <path d={starPath(13)} />
        </svg>
        <div className="grow">
          <span className="eyebrow">{STATE_WORD[state]}</span>
          <h3 className="panel-title">{idea.title}</h3>
        </div>
      </div>
      <div className="idea-summary">
        <p>{idea.summary}</p>
        <button className="icon-btn" onClick={() => say(`${idea.title}. ${idea.summary}`)} aria-label="Read this idea aloud">
          <Icon name="speaker" size={18} />
        </button>
      </div>
      <div>
        <div className="panel-meter">
          <span className="tabular">{s?.n ? `${v}% strength` : 'No answers yet'}</span>
          <span className="hint">{s?.n ? `Last practiced ${ago(s.at)}` : ''}</span>
        </div>
        <Horizon pct={v / 100} label="Idea strength" />
        <p className="hint idea-note">
          {!s?.n && 'Answer one question about it to light this star.'}
          {fade && 'Fading. One good answer brings it back and makes it fade slower next time.'}
          {s?.n && !fade && v >= LIT && (left !== null ? `Stays bright about ${left} more ${left === 1 ? 'day' : 'days'}.` : 'Bright and steady.')}
          {s?.n && !fade && v < LIT && `Reach ${LIT} to light it. Your best so far is ${s.best}.`}
        </p>
      </div>
      <div className="row gap wrap">
        <button className="btn btn-sun" onClick={() => go({ name: 'doc', id: ctx.id, tab: 'quiz', focus: { mode: 'idea', chapter: ch.index, idea: idea.id } })}>
          <Icon name="target" size={18} /> Quiz this idea
        </button>
        <button className="btn btn-ghost" onClick={() => listenAt(ctx, idea.anchor)}>
          <Icon name="headphones" size={18} /> Hear where it's explained
        </button>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="panel legend">
      <h3>How your map works</h3>
      <ul>
        <li>
          <MiniStar state="dark" /> <span>Every idea is a star. Untested stars are dark.</span>
        </li>
        <li>
          <MiniStar state="glow" /> <span>Explain it well and it glows. Score 80+ and it lights up.</span>
        </li>
        <li>
          <MiniStar state="lit" fading /> <span>Stars fade if you leave them. A pulsing dot means review it soon.</span>
        </li>
        <li>
          <span className="legend-sun" aria-hidden="true" /> <span>Each chapter's sun fills as you understand it and gains a ray for every quarter of its stars lit. Light them all and the sun rises.</span>
        </li>
        <li>
          <Icon name="trophy" size={20} /> <span>Raise every sun to reach Mastery at the bottom of the map.</span>
        </li>
      </ul>
      <p className="hint">Tap any sun or star to quiz it, hear it, or see how strong it is.</p>
    </div>
  );
}
