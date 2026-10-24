import { useEffect, useRef, useState } from 'react';
import { boot, getState, patchDoc, pull, saveNow, useApp } from './lib/store';
import { go, useView } from './lib/nav';
import { player } from './lib/speech';
import { prewarmNatural } from './lib/localtts';
import { safeMode } from './lib/crumbs';
import { award, dayKey, levelInfo } from './lib/game';
import { server, useServer } from './lib/api';
import { onOnline, useOnline } from './lib/online';
import { processAllPending } from './lib/review';
import { Icon, LogoMark } from './components/ui';
import { PlayerBar } from './components/PlayerBar';
import { Celebrations } from './components/Celebrations';
import { Library } from './views/Library';
import { Doc } from './views/Doc';
import { Progress } from './views/Progress';
import { SettingsView, PasscodeForm } from './views/Settings';

export default function App() {
  const view = useView();
  const srv = useServer();
  const theme = useApp((s) => s.settings.theme);
  const xp = useApp((s) => s.game.xp);
  const streak = useApp((s) => s.game.streak);
  const [ready, setReady] = useState(false);
  const online = useOnline();
  const provider = useApp((s) => s.settings.provider);
  // The page always leaves room for the player and tab bar at the bottom, however tall they are,
  // so nothing (like quiz answers) ends up hidden underneath.
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  });

  // Start the Natural voice in the background, so pressing play doesn't wait for it.
  useEffect(() => {
    if (provider !== 'neural') return;
    const t = setTimeout(prewarmNatural, 1500);
    return () => clearTimeout(t);
  }, [provider]);

  useEffect(() => {
    boot().finally(() => {
      setReady(true);
      processAllPending();
    });
    const offOnline = onOnline(async () => {
      await server.probe();
      await pull();
      processAllPending();
    });
    const onVis = () => {
      if (document.visibilityState === 'visible') pull();
      else saveNow();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', saveNow);
    return () => {
      offOnline();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', saveNow);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') {
      if (root.dataset.themeBy === 'rise') {
        delete root.dataset.theme;
        delete root.dataset.themeBy;
      }
    } else {
      root.dataset.theme = theme;
      root.dataset.themeBy = 'rise';
    }
  }, [theme]);

  // Listening earns XP and remembers your place.
  useEffect(() => {
    let lastIndex = -1;
    const offPos = player.subscribe(() => {
      const p = player.s;
      if (!p.docId || p.index === lastIndex) return;
      lastIndex = p.index;
      const doc = getState().docs[p.docId];
      if (doc && doc.position !== p.index) {
        patchDoc(p.docId, (d) => {
          d.position = p.index;
          d.furthest = Math.max(d.furthest, p.index);
        });
      }
    });
    let wordBank = 0;
    const offHeard = player.onHeard((e) => {
      const secs = Math.min(e.ms / 1000, 60);
      wordBank += e.words;
      const xpNow = Math.floor(wordBank / 25);
      wordBank -= xpNow * 25;
      award('Listening', xpNow, { sentencesHeard: 1, wordsHeard: e.words, secondsListened: Math.round(secs), fastSeconds: e.rate >= 2 ? Math.round(secs) : 0 }, { quiet: true });
    });
    return () => {
      offPos();
      offHeard();
    };
  }, []);

  if (srv.reachable && srv.passcode && !srv.authed) {
    return (
      <div className="lock-screen">
        <LogoMark size={72} />
        <h1>Rise</h1>
        <p>Enter your passcode or invite code to open your library.</p>
        <PasscodeForm />
      </div>
    );
  }

  const lvl = levelInfo(xp);
  const nav = [
    { id: 'library', label: 'Library', icon: 'home', active: view.name === 'library' || view.name === 'doc' },
    { id: 'progress', label: 'Progress', icon: 'trophy', active: view.name === 'progress' },
    { id: 'settings', label: 'Settings', icon: 'gear', active: view.name === 'settings' }
  ] as const;
  const liveStreak = streak.lastDay === dayKey() || streak.lastDay === dayKey(Date.now() - 864e5) ? streak.current : 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go({ name: 'library' })}>
          <LogoMark size={40} />
          <span>
            <strong>Rise</strong>
            <small>Jesse Abrams Coaching</small>
          </span>
        </button>
        <nav aria-label="Main">
          {nav.map((n) => (
            <button key={n.id} className={n.active ? 'on' : ''} aria-current={n.active ? 'page' : undefined} onClick={() => go({ name: n.id })}>
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
        </nav>
        {!online && (
          <span className="offline-pill side" role="status">
            <Icon name="wifiOff" size={14} /> Offline. Downloaded pieces still work.
          </span>
        )}
        <button className="side-level" onClick={() => go({ name: 'progress' })}>
          <span className="eyebrow">Level {lvl.level}</span>
          <strong>{lvl.title}</strong>
          <span className="side-xp">
            <span className="horizon thin">
              <span className="horizon-fill" style={{ width: `${lvl.pct * 100}%` }} />
            </span>
          </span>
          <span className="hint tabular">
            <Icon name="flame" size={14} /> {liveStreak} day streak
          </span>
        </button>
      </aside>

      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'library' })}>
          <LogoMark size={30} />
          <strong>Rise</strong>
        </button>
        {!online && (
          <span className="offline-pill" role="status">
            <Icon name="wifiOff" size={14} /> Offline
          </span>
        )}
        {safeMode && (
          <button
            className="offline-pill"
            title="Rise crashed twice, so it is reading with the device voice for now. Tap to leave safe mode."
            onClick={() => {
              try {
                localStorage.setItem('rise-crash-count', '0');
                localStorage.setItem('rise-clean-exit', '1');
              } catch {
                /* ignore */
              }
              location.reload();
            }}
          >
            Safe mode · tap to leave
          </button>
        )}
        <button className="top-xp" onClick={() => go({ name: 'progress' })} aria-label={`Level ${lvl.level}, ${liveStreak} day streak`}>
          <span className="lvl-badge tabular">{lvl.level}</span>
          <span className="horizon thin">
            <span className="horizon-fill" style={{ width: `${lvl.pct * 100}%` }} />
          </span>
          <Icon name="flame" size={16} />
          <span className="tabular">{liveStreak}</span>
        </button>
      </header>

      <main className="main" id="main">
        {!ready ? (
          <div className="boot">
            <LogoMark size={64} />
          </div>
        ) : (
          <>
            {view.name === 'library' && <Library />}
            {view.name === 'doc' && <Doc key={view.id} id={view.id} tab={view.tab} focus={view.focus} nonce={view.nonce} />}
            {view.name === 'progress' && <Progress />}
            {view.name === 'settings' && <SettingsView />}
          </>
        )}
      </main>

      <div className="dock" ref={dockRef}>
        <PlayerBar />
        <nav className="tabbar" aria-label="Main">
          {nav.map((n) => (
            <button key={n.id} className={n.active ? 'on' : ''} aria-current={n.active ? 'page' : undefined} onClick={() => go({ name: n.id })}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <Celebrations />
    </div>
  );
}
