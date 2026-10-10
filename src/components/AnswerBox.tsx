import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { canListen, listenBlocker, startListening, type Listening } from '../lib/listen';
import { useOnline } from '../lib/online';
import { packReady } from '../lib/localml';
import { useApp } from '../lib/store';
import { stopSay } from '../lib/speech';

interface Props {
  id: string;
  onSubmit: (text: string, spoken: boolean) => void;
  busy?: boolean;
  placeholder?: string;
  submitLabel?: string;
  /** Start listening on mount and submit automatically after a pause (hands-free). */
  autoListen?: boolean;
  compact?: boolean;
}

type Phase = 'idle' | 'listening' | 'transcribing' | 'review';

export function AnswerBox({ id, onSubmit, busy, placeholder = 'Type your answer…', submitLabel = 'Check my answer', autoListen, compact }: Props) {
  const preferred = useApp((s) => s.settings.answerMode);
  const online = useOnline();
  const micOk = canListen();
  const [mode, setMode] = useState<'voice' | 'type'>(micOk ? preferred : 'type');
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<Listening | null>(null);
  const auto = useRef(false);

  useEffect(() => () => rec.current?.cancel(), []);

  useEffect(() => {
    if (phase !== 'listening') return;
    const started = Date.now();
    const t = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
      setLevel(rec.current?.level() ?? 0);
    }, 90);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (autoListen && micOk && mode === 'voice' && phase === 'idle' && !busy) {
      auto.current = true;
      begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen]);

  async function begin() {
    setError('');
    stopSay();
    setText('');
    try {
      rec.current = await startListening({
        onInterim: (t) => setText(t),
        onSilence: () => auto.current && finish(true)
      });
      setPhase('listening');
    } catch (e: any) {
      setError(e?.message?.includes('Permission') || e?.name === 'NotAllowedError' ? 'Rise needs microphone access. Allow it in your browser, or type instead.' : e.message || 'The microphone did not start.');
      setPhase('idle');
    }
  }

  async function finish(submitAfter = false) {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase(r.live ? 'review' : 'transcribing');
    try {
      const t = await r.stop();
      setText(t);
      setSpoken(true);
      setPhase('review');
      if (!t) setError('Rise did not catch anything. Try again a little closer to the mic.');
      else if (submitAfter) onSubmit(t, true);
    } catch (e: any) {
      setError(e.message || 'Transcription failed. Try again or type.');
      setPhase('idle');
    }
  }

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSubmit(t, spoken);
  }

  return (
    <div className={`answer ${compact ? 'compact' : ''}`}>
      <div className="answer-modes" role="tablist" aria-label="Answer by">
        <button role="tab" aria-selected={mode === 'voice'} className={mode === 'voice' ? 'on' : ''} disabled={!micOk} onClick={() => setMode('voice')} title={micOk ? '' : 'Voice answers need a microphone'}>
          <Icon name="mic" size={16} /> Say it
        </button>
        <button role="tab" aria-selected={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>
          <Icon name="type" size={16} /> Type it
        </button>
      </div>

      {mode === 'voice' && phase !== 'review' && (
        <div className="voice-stage">
          <button
            className={`mic-sun ${phase === 'listening' ? 'live' : ''}`}
            style={{ ['--lvl' as any]: level }}
            onClick={() => (phase === 'listening' ? finish(false) : begin())}
            disabled={phase === 'transcribing' || busy}
            aria-label={phase === 'listening' ? 'Stop recording' : 'Start recording your answer'}
          >
            <span className="mic-rays" aria-hidden="true" />
            <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={30} />
          </button>
          <p className="voice-hint" aria-live="polite">
            {phase === 'idle' && 'Tap the sun and explain it in your own words.'}
            {phase === 'listening' && (
              <>
                Listening <span className="tabular">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>. Tap to finish.
              </>
            )}
            {phase === 'transcribing' && (!online && packReady() ? 'Transcribing on your device…' : 'Turning your words into text…')}
          </p>
          {phase === 'listening' && text && <p className="interim">{text}</p>}
        </div>
      )}

      {(mode === 'type' || phase === 'review') && (
        <div className="type-stage">
          {phase === 'review' && <span className="eyebrow">You said. Edit anything Rise misheard.</span>}
          <textarea
            id={id}
            value={text}
            rows={compact ? 3 : 4}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              if (phase !== 'review') setSpoken(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="row gap">
            <button className="btn btn-sun" onClick={submit} disabled={!text.trim() || busy}>
              {busy ? 'Checking…' : submitLabel}
            </button>
            {phase === 'review' && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPhase('idle');
                  setText('');
                  setSpoken(false);
                }}
              >
                <Icon name="mic" size={18} /> Re-record
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      {!micOk && mode === 'type' && listenBlocker() && <p className="hint">{listenBlocker()}</p>}
    </div>
  );
}
