import { useEffect, useState, type ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  play: <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  prev: <path d="M18 6 9 12l9 6V6zM6 6v12" />,
  next: <path d="m6 6 9 6-9 6V6zM18 6v12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  mic: <path d="M12 2.5a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0v-6a3 3 0 0 0-3-3zM19 10v1.5a7 7 0 0 1-14 0V10M12 18.5V22M8.5 22h7" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  speaker: <path d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />,
  spark: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  doc: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6" />,
  back: <path d="M15 18 9 12l6-6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  flame: <path d="M12 22c4 0 7-2.7 7-7 0-3.5-2.2-6-4-8-.4 2.5-1.6 4-3 4 .8-3.2-.3-6.3-3-9-.2 4-4 6.5-4 12.5C5 19.3 8 22 12 22z" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  brain: <path d="M9 4.5a2.5 2.5 0 0 0-4.6 1.4A3 3 0 0 0 3 11a3 3 0 0 0 1.5 5A3 3 0 0 0 9 19.5V4.5zM15 4.5a2.5 2.5 0 0 1 4.6 1.4A3 3 0 0 1 21 11a3 3 0 0 1-1.5 5 3 3 0 0 1-4.5 3.5V4.5zM9 4.5a3 3 0 0 1 6 0M9 19.5a3 3 0 0 0 6 0" />,
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12zM8.5 11h.01M12 11h.01M15.5 11h.01" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />,
  headphones: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z" />,
  pen: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  cards: <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h9A1.5 1.5 0 0 1 20 4.5v11a1.5 1.5 0 0 1-1.5 1.5H17M5.5 6h9A1.5 1.5 0 0 1 16 7.5v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-12A1.5 1.5 0 0 1 5.5 6z" />,
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  dive: <path d="M12 3v10M8 9l4 4 4-4M3 17c1.5 0 1.5 1.5 3 1.5S7.5 17 9 17s1.5 1.5 3 1.5S13.5 17 15 17s1.5 1.5 3 1.5 1.5-1.5 3-1.5" />,
  home: <path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4v-9.5z" />,
  type: <path d="M4 18 8.5 6h1L14 18M5.7 14h6.6M15 18v-6.5a2.5 2.5 0 0 1 5 0V18M15 15h5" />,
  focus: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 12h6" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  clipboard: <path d="M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15" />,
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />,
  cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8H7z" />,
  wifiOff: <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-2.5-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01" />,
  lock: <path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" />,
  map: (
    <>
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <path d="M8 15.5c3-1 2.5-5 5.5-6.5M12.5 4l.5 1.5L14.5 6l-1.5.5-.5 1.5-.5-1.5L10.5 6l1.5-.5z" />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
};

export function Icon({ name, size = 22, className, label }: { name: string; size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {P[name] || P.spark}
    </svg>
  );
}

/** The Jesse Abrams Coaching sun mark. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="49.7 59.675 899.925 899.825" aria-hidden="true">
      <path d="M919.1,494.4H731.8c-3.4-52.8-24.5-100.8-57.4-138.2L807,223.6C878.2,300,915.6,396.7,919.1,494.4z" fill="#00ADF1" />
      <path d="M785.7,202.2L653,334.9c-37.5-32.9-85.4-54-138.2-57.4V90.2C612.6,93.7,709.2,131,785.7,202.2z" fill="#1D80BC" />
      <path d="M484.6,90.2v187.3c-52.8,3.4-100.8,24.5-138.2,57.4L213.8,202.2C290.2,131,386.9,93.7,484.6,90.2z" fill="#0A6999" />
      <path d="M325,356.2c-32.9,37.5-54,85.4-57.4,138.2H80.4c3.5-97.8,40.8-194.4,112-270.8L325,356.2z" fill="var(--mark-navy)" />
      <path d="M701.5,494.4H297.9c7.8-104.6,95.3-187.3,201.8-187.3S693.7,389.9,701.5,494.4z" fill="#F25B2C" />
      <path d="M919.1,524.7c-1,26.4-4.3,52.7-10.3,78.5H90.6c-5.9-25.9-9.3-52.1-10.3-78.5H919.1z" fill="#F25B2C" />
      <path d="M900.7,633.4c-8.3,27-19.4,53.3-33.2,78.5H131.9c-13.8-25.2-25-51.5-33.2-78.5H900.7z" fill="#F7941D" />
      <path d="M849.3,742.2c-15.1,22.7-32.6,44.3-52.7,64.3c-4.9,4.9-9.8,9.7-14.9,14.3H217.7c-5.1-4.6-10-9.4-14.9-14.3c-20.1-20-37.6-41.6-52.7-64.3H849.3z" fill="#FDAF40" />
      <path d="M744.2,850.9c-145.6,104.3-343.3,104.3-488.9,0H744.2z" fill="#FDC20D" />
    </svg>
  );
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${wide ? 'sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Horizon-stripe progress bar, after the four stripes in the logo. */
export function Horizon({ pct, label, thin }: { pct: number; label?: string; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, pct || 0));
  return (
    <div className={`horizon ${thin ? 'thin' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <div className="horizon-fill" style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function ScoreRing({ score, size = 76 }: { score: number; size?: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const tone = score >= 90 ? 'var(--gold)' : score >= 70 ? 'var(--orange)' : score >= 40 ? 'var(--coral)' : 'var(--ink-3)';
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" className="score-ring" aria-label={`Score ${score} out of 100`} role="img">
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 38 38)"
        className="score-arc"
      />
      <text x="38" y="44" textAnchor="middle" className="score-num">
        {score}
      </text>
    </svg>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Thinking({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="thinking" role="status">
      <div className="thinking-sun" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p key={i} className="thinking-line">{lines[i % lines.length]}</p>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          <Icon name="refresh" size={18} /> Try again
        </button>
      )}
    </div>
  );
}
