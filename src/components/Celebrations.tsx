import { useEffect, useRef, useState } from 'react';
import { chime, onCelebrate, type Celebration } from '../lib/game';
import { getState } from '../lib/store';
import { Icon, LogoMark } from './ui';

interface Toast {
  id: number;
  c: Celebration;
}

const COLORS = ['#F25B2C', '#F7941D', '#FDAF40', '#FDC20D', '#00ADF1', '#1D80BC'];

function burst(canvas: HTMLCanvasElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const cx = innerWidth / 2;
  const cy = innerHeight * 0.42;
  const parts = Array.from({ length: 110 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, w: 4 + Math.random() * 8, h: 3 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0] };
  });
  let frame = 0;
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - frame / 110);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (++frame < 110) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(tick);
}

export function Celebrations() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [big, setBig] = useState<Celebration | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(
    () =>
      onCelebrate((c) => {
        const on = getState().settings.celebrations;
        if (c.kind === 'level' || c.kind === 'quest' || c.kind === 'risen' || c.kind === 'book') {
          chime('level');
          if (on) {
            setBig(c);
            if (canvas.current) burst(canvas.current);
          }
          return;
        }
        if (c.kind !== 'note') chime(c.kind === 'badge' ? 'badge' : 'xp');
        if (c.kind === 'badge' && on && canvas.current) burst(canvas.current);
        const id = Math.random();
        setToasts((t) => [...t.slice(-3), { id, c }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), c.kind === 'badge' || c.kind === 'note' ? 5200 : 2600);
      }),
    []
  );

  return (
    <>
      <canvas ref={canvas} className="confetti" aria-hidden="true" />
      <div className="toasts" aria-live="polite">
        {toasts.map(({ id, c }) => (
          <div key={id} className={`toast toast-${c.kind}`}>
            {c.kind === 'xp' && (
              <>
                <span className="toast-xp tabular">+{c.amount} XP</span>
                <span>{c.label}</span>
              </>
            )}
            {c.kind === 'badge' && (
              <>
                <span className={`medal tier-${c.badge.tier}`}>
                  <Icon name={c.badge.icon} size={20} />
                </span>
                <span>
                  <strong>Badge unlocked: {c.badge.name}</strong>
                  <small>{c.badge.desc}</small>
                </span>
              </>
            )}
            {c.kind === 'note' && (
              <>
                <span className="medal tier-common">
                  <Icon name="chat" size={20} />
                </span>
                <span>{c.text}</span>
              </>
            )}
            {c.kind === 'star' && (
              <>
                <span className="medal tier-legendary">
                  <Icon name="star" size={20} />
                </span>
                <span>
                  <strong>Star lit</strong>
                  <small>{c.title}</small>
                </span>
              </>
            )}
            {c.kind === 'streak' && (
              <>
                <span className="medal tier-rare">
                  <Icon name="flame" size={20} />
                </span>
                <span>
                  <strong>{c.days}-day streak</strong>
                  <small>+15 XP for showing up again</small>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {big && (
        <div className="levelup-backdrop" onClick={() => setBig(null)}>
          <div className="levelup" role="dialog" aria-modal="true" aria-label="Celebration" onClick={(e) => e.stopPropagation()}>
            <div className="levelup-sun" aria-hidden="true">
              <div className="levelup-rays" />
              {big.kind === 'risen' || big.kind === 'book' ? (
                <div className="levelup-logo">
                  <LogoMark size={150} />
                </div>
              ) : (
                <div className="levelup-disc" />
              )}
            </div>
            {big.kind === 'level' ? (
              <>
                <span className="eyebrow">Level {big.level}</span>
                <h2>{big.title}</h2>
                <p>Your sun just rose a little higher. Keep going.</p>
              </>
            ) : big.kind === 'risen' ? (
              <>
                <span className="eyebrow">Sunrise · +60 XP</span>
                <h2 className="risen-title">{big.title}</h2>
                <p>Every idea in this chapter is lit. You don't just recognize it. You understand it.</p>
              </>
            ) : big.kind === 'book' ? (
              <>
                <span className="eyebrow">Mastered · +200 XP</span>
                <h2 className="risen-title">{big.title}</h2>
                <p>Every sun on the map has risen. Come back now and then to keep the stars bright.</p>
              </>
            ) : (
              <>
                <span className="eyebrow">Daily quest complete</span>
                <h2>+50 XP</h2>
                <p>You did all three today. That is how habits get built.</p>
              </>
            )}
            <button className="btn btn-sun" onClick={() => setBig(null)} autoFocus>
              Keep rising
            </button>
          </div>
        </div>
      )}
    </>
  );
}
