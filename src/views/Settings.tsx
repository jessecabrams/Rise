import { useEffect, useRef, useState } from 'react';
import { Icon, Segmented, Sheet, Toggle } from '../components/ui';
import { VoicePicker, SpeedControl } from '../components/VoicePicker';
import { TextSettings } from './Reader';
import { exportAll, importAll, pull, resetProgress, setSettings, useApp, useSyncStatus } from '../lib/store';
import { server, setKey, useServer } from '../lib/api';
import { installPrompt } from '../lib/install';
import { OfflineSettings } from './OfflinePanel';

export function SettingsView() {
  const st = useApp((s) => s.settings);
  const srv = useServer();
  const sync = useSyncStatus();
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function download() {
    const json = await exportAll();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const ready = srv.reachable && (!srv.passcode || srv.authed);
  const feat = (on: boolean, label: string, off: string) => (
    <li className={on ? 'on' : ''}>
      <span className="status-dot" aria-hidden="true" />
      <span className="grow">{label}</span>
      <span className="hint">{on ? 'Connected' : off}</span>
    </li>
  );

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h1>Settings</h1>
        </div>
      </header>

      <section className="card stack">
        <h2>You</h2>
        <label className="field" htmlFor="name">
          <span>What should Rise call you?</span>
          <input id="name" value={st.name} onChange={(e) => setSettings({ name: e.target.value })} />
        </label>
        <label className="field" htmlFor="goal">
          <span>
            Daily listening goal <span className="tabular">{st.dailyGoalMin} min</span>
          </span>
          <input id="goal" type="range" min={5} max={60} step={5} value={st.dailyGoalMin} onChange={(e) => setSettings({ dailyGoalMin: Number(e.target.value) })} />
        </label>
      </section>

      <section className="card stack">
        <h2>Voice</h2>
        <VoicePicker />
        <h3>Speed</h3>
        <SpeedControl />
      </section>

      <section className="card stack">
        <h2>Reading</h2>
        <TextSettings />
      </section>

      <section className="card stack">
        <h2>Quizzes and answers</h2>
        <div className="field">
          <span>Default way to answer</span>
          <Segmented
            label="Default answer mode"
            value={st.answerMode}
            onChange={(v) => setSettings({ answerMode: v })}
            options={[
              { value: 'voice', label: 'Speaking' },
              { value: 'type', label: 'Typing' }
            ]}
          />
        </div>
        <Toggle id="s-rq" checked={st.readQuestions} onChange={(v) => setSettings({ readQuestions: v })} label="Read questions and feedback aloud" />
        <Toggle id="s-hf" checked={st.handsFree} onChange={(v) => setSettings({ handsFree: v })} label="Hands-free quizzes" hint="Listens automatically after each question and submits when you pause. Great for walks." />
      </section>

      <section className="card stack">
        <h2>Fun</h2>
        <Toggle id="s-snd" checked={st.sounds} onChange={(v) => setSettings({ sounds: v })} label="Sounds" hint="Chimes for XP, badges and level-ups." />
        <Toggle id="s-cel" checked={st.celebrations} onChange={(v) => setSettings({ celebrations: v })} label="Celebrations" hint="Confetti and level-up moments." />
      </section>

      <section className="card stack">
        <h2>Appearance</h2>
        <Segmented
          label="Theme"
          value={st.theme}
          onChange={(v) => setSettings({ theme: v })}
          options={[
            { value: 'auto', label: 'Match device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
        />
      </section>

      <section className="card stack" id="offline">
        <h2>Offline</h2>
        <OfflineSettings />
      </section>

      <section className="card stack">
        <h2>Install Rise</h2>
        <InstallHelp />
      </section>

      <section className="card stack">
        <h2>Sync and connections</h2>
        {!srv.reachable && <p className="hint">This copy of Rise is running without its server, so everything stays on this device. Once you deploy Rise, your library and progress follow you between phone and computer.</p>}
        {srv.reachable && srv.passcode && !srv.authed && <PasscodeForm />}
        {srv.reachable && (
          <ul className="status-list">
            {feat(ready && srv.features.storage, 'Sync between devices', 'Add Upstash Redis')}
            {feat(ready && srv.features.ai, 'Learning coach (quizzes, guides, grading)', 'Add ANTHROPIC_API_KEY')}
            {feat(ready && srv.features.openai, 'Studio voices and voice answers', 'Add OPENAI_API_KEY')}
            {feat(ready && srv.features.elevenlabs, 'Premium ElevenLabs voices', 'Optional')}
          </ul>
        )}
        {ready && srv.features.storage && (
          <div className="row gap wrap">
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await pull();
                setMsg('Synced.');
              }}
            >
              <Icon name="refresh" size={18} /> Sync now
            </button>
            <span className="hint">{{ local: 'On this device only', syncing: 'Syncing…', synced: 'Up to date', error: 'Last sync failed. Rise will retry.' }[sync]}</span>
          </div>
        )}
        {srv.reachable && srv.passcode && srv.authed && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setKey('');
              server.probe();
            }}
          >
            <Icon name="lock" size={18} /> Lock this device
          </button>
        )}
      </section>

      <section className="card stack">
        <h2>Backup</h2>
        <p className="hint">Download everything (library, guides and progress) as one file, or restore from one.</p>
        <div className="row gap wrap">
          <button className="btn btn-ghost" onClick={download}>
            <Icon name="download" size={18} /> Download backup
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Restore
          </button>
          <input
            ref={fileRef}
            id="restore"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importAll(await f.text());
                setMsg('Backup restored.');
              } catch (err: any) {
                setMsg(err.message);
              }
            }}
          />
        </div>
        <button className="btn btn-danger-ghost" onClick={() => setConfirmReset(true)}>
          Reset XP and badges
        </button>
        {msg && <p className="hint" role="status">{msg}</p>}
      </section>

      <p className="footer-note">
        Rise · made for Jesse Abrams Coaching · <em>Build your life around your brain.</em>
      </p>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset your progress?">
        <p>This clears XP, levels, streaks and badges on every device. Your library and learning guides stay.</p>
        <div className="row gap">
          <button
            className="btn btn-danger"
            onClick={async () => {
              await resetProgress();
              setConfirmReset(false);
              setMsg('Progress reset. Fresh sunrise.');
            }}
          >
            Reset progress
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}

export function PasscodeForm() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setKey(code.trim());
        const s = await server.probe();
        if (!s.authed) setErr('That passcode did not match. Check APP_PASSCODE in Vercel.');
        else await pull();
      }}
    >
      <label className="field" htmlFor="passcode">
        <span>Passcode</span>
        <input id="passcode" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button className="btn btn-sun" type="submit" disabled={!code.trim()}>
        Unlock
      </button>
      {err && <p className="field-error">{err}</p>}
    </form>
  );
}

function InstallHelp() {
  const [can, setCan] = useState(!!installPrompt.event);
  useEffect(() => installPrompt.subscribe(() => setCan(!!installPrompt.event)), []);
  const standalone = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
  if (standalone) return <p className="hint">Rise is installed on this device. Nice.</p>;
  return (
    <div className="stack">
      {can && (
        <button className="btn btn-sun" onClick={() => installPrompt.prompt()}>
          <Icon name="download" size={18} /> Install Rise on this device
        </button>
      )}
      <ul className="install-steps">
        <li>
          <strong>iPhone or iPad:</strong> open Rise in Safari, tap Share, then <em>Add to Home Screen</em>.
        </li>
        <li>
          <strong>Android:</strong> open in Chrome, tap the menu, then <em>Install app</em>.
        </li>
        <li>
          <strong>Mac or PC:</strong> in Chrome or Edge, click the install icon in the address bar. On a Mac with Safari, choose File, then <em>Add to Dock</em>.
        </li>
      </ul>
    </div>
  );
}
