import { useEffect, useState } from 'react';
import { Icon, Sheet } from './ui';
import { player, usePlayer } from '../lib/speech';
import { useApp } from '../lib/store';
import { go, useView } from '../lib/nav';
import { SpeedControl, VoicePicker } from './VoicePicker';

export function PlayerBar() {
  const p = usePlayer();
  const rate = useApp((s) => s.settings.rate);
  const view = useView();
  const [sheet, setSheet] = useState<'voice' | 'speed' | null>(null);
  // Messages show for a few seconds, then get out of the way. Tap to dismiss sooner.
  const [showError, setShowError] = useState(false);
  useEffect(() => {
    if (!p.error) return;
    setShowError(true);
    const t = setTimeout(() => setShowError(false), 6000);
    return () => clearTimeout(t);
  }, [p.error]);
  if (!p.docId) return null;
  // While you're answering questions or reading a guide, the paused player steps aside. It comes back when reading.
  const busyTab = view.name === 'doc' && view.id === p.docId && view.tab !== 'listen';
  if (busyTab && !p.playing && !p.loading) return null;
  const pct = p.total ? (p.index + 1) / p.total : 0;
  const onDoc = view.name === 'doc' && view.id === p.docId;

  return (
    <>
      {p.error && showError && (
        <div className="player-error" role="status" onClick={() => setShowError(false)}>
          {p.error}
        </div>
      )}
      <div className="player" role="region" aria-label="Audio player">
        <div className="player-progress" style={{ width: `${pct * 100}%` }} aria-hidden="true" />
        <button className="player-title" onClick={() => go({ name: 'doc', id: p.docId!, tab: 'listen' })} disabled={onDoc} title="Open">
          <span className="eyebrow">{p.loading ? 'Getting the audio ready…' : p.playing ? 'Now reading' : 'Paused'}</span>
          <span className="player-name">{p.title}</span>
        </button>
        <div className="player-controls">
          <button className="icon-btn" onClick={() => player.prev()} aria-label="Previous sentence">
            <Icon name="prev" />
          </button>
          <button className={`play-btn ${p.playing ? 'on' : ''}`} onClick={() => player.toggle()} aria-label={p.playing ? 'Pause' : 'Play'}>
            <Icon name={p.playing ? 'pause' : 'play'} size={26} />
          </button>
          <button className="icon-btn" onClick={() => player.next()} aria-label="Next sentence">
            <Icon name="next" />
          </button>
        </div>
        <div className="player-extras">
          <button className="pill" onClick={() => setSheet('speed')} aria-label="Reading speed">
            <span className="tabular">{rate.toFixed(2).replace(/\.?0+$/, '')}×</span>
          </button>
          <button className="pill" onClick={() => setSheet('voice')} aria-label="Choose voice">
            <Icon name="wave" size={18} />
            <span className="hide-sm">Voice</span>
          </button>
          <button className="icon-btn hide-sm" onClick={() => player.close()} aria-label="Close player">
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>
      <Sheet open={sheet === 'voice'} onClose={() => setSheet(null)} title="Voice">
        <VoicePicker />
      </Sheet>
      <Sheet open={sheet === 'speed'} onClose={() => setSheet(null)} title="Speed">
        <SpeedControl />
      </Sheet>
    </>
  );
}
