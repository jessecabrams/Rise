/**
 * A tiny crash recorder. Rise notes what it was doing in the last few seconds. If the page was killed
 * (for example a browser crash on iPhone), the next launch sends those notes to the Rise server log,
 * and after two crashes in a row Rise starts in a safe mode.
 */
const K = 'rise-crumbs';
const CLEAN = 'rise-clean-exit';
const CRASHES = 'rise-crash-count';

let trail: string[] = [];
let t0 = Date.now();
export let safeMode = false;

function store(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}
function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function crumb(s: string) {
  trail.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  if (trail.length > 60) trail = trail.slice(-60);
  store(K, JSON.stringify(trail));
}

export function startCrumbs() {
  t0 = Date.now();
  const prev = read(K);
  const clean = read(CLEAN) !== '0';
  let crashes = Number(read(CRASHES) || 0);
  if (!clean && prev) crashes++;
  else crashes = 0;
  store(CRASHES, String(crashes));
  safeMode = crashes >= 2;
  trail = [];
  store(CLEAN, '0');
  const mark = () => store(CLEAN, document.visibilityState === 'hidden' ? '1' : '0');
  document.addEventListener('visibilitychange', mark);
  window.addEventListener('pagehide', () => store(CLEAN, '1'));
  // Running steadily for a while: no longer counts toward a crash streak.
  setTimeout(() => store(CRASHES, '0'), 45_000);
  crumb(`start ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}${safeMode ? ' SAFE MODE' : ''}`);
  if (!clean && prev) {
    let key = '';
    try {
      key = localStorage.getItem('rise-key') || '';
    } catch {
      /* ignore */
    }
    fetch('/api/health', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-rise-key': key },
      body: JSON.stringify({ crash: prev, crashes, ua: navigator.userAgent })
    }).catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  startCrumbs();
  window.addEventListener('error', (e) => crumb(`error ${String(e.message).slice(0, 120)}`));
  window.addEventListener('unhandledrejection', (e: any) => crumb(`rejection ${String(e.reason?.message || e.reason).slice(0, 120)}`));
}
