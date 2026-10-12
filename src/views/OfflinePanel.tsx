import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Horizon, Icon, Toggle } from '../components/ui';
import { chapters } from '../lib/text';
import { hasIndex, prepareOffline, removeIndex, type PrepProgress } from '../lib/offline';
import { audioEstimateMB, removeAudio, sayChunks, voiceKey } from '../lib/speech';
import { ANSWER_PACK_MB, downloadAnswerPack, packReady, removeAnswerPack, usePack } from '../lib/localml';
import { COACH_MODELS, downloadCoach, removeCoach, useCoach, webgpuSupported } from '../lib/localllm';
import { NATURAL_MB, downloadNatural, removeNatural, useNatural } from '../lib/localtts';
import { setSettings } from '../lib/store';
import { fmtBytes, keepStorage, storageUsage, useOnline } from '../lib/online';
import { patchDoc, useApp } from '../lib/store';
import { go } from '../lib/nav';
import type { DocCtx } from './Doc';

/** Download one piece for offline use. */
export function DocOffline({ ctx }: { ctx: DocCtx }) {
  const meta = useApp((s) => s.docs[ctx.id]);
  const online = useOnline();
  const pack = usePack();
  const natural = useNatural();
  const chs = chapters(ctx.s, ctx.title);
  const mapped = chs.filter((c) => ctx.body.map?.[c.index]).length;
  const banked = chs.filter((c) => ctx.body.bank?.[c.index]?.length).length;
  const questions = Object.values(ctx.body.bank || {}).reduce((a, l) => a + l.length, 0);
  const vk = voiceKey();
  const [audio, setAudio] = useState(!!vk && !!meta?.offline?.audio);
  const [prog, setProg] = useState<PrepProgress | null>(null);
  const [error, setError] = useState('');
  const [indexed, setIndexed] = useState(false);
  const cancel = useRef(false);
  const ready = banked === chs.length;
  const audioReady = !!vk && meta?.offline?.audio === vk;

  useEffect(() => {
    hasIndex(ctx.id, ctx.s.sentences).then(setIndexed);
  }, [ctx.id, ctx.s, prog]);

  async function run() {
    cancel.current = false;
    setError('');
    setProg({ label: 'Starting…', pct: 0 });
    try {
      await prepareOffline(ctx, { audio: audio && !!vk }, setProg, cancel);
    } catch (e: any) {
      setError(e.message || 'The download stopped. Try again.');
    } finally {
      setProg(null);
    }
  }

  const row = (ok: boolean, label: string, detail: string) => (
    <li className={ok ? 'on' : ''}>
      <span className="status-dot" aria-hidden="true" />
      <span className="grow">{label}</span>
      <span className="hint">{detail}</span>
    </li>
  );

  return (
    <div className="stack">
      <p className="hint">Prepare this piece once while you have signal. Then listen, quiz, answer out loud and ask questions with no connection.</p>
      <ul className="status-list">
        {row(mapped === chs.length, 'Idea map', `${mapped}/${chs.length} ${chs.length === 1 ? 'piece' : 'chapters'}`)}
        {row(ready, 'Offline questions', questions ? `${questions} questions` : 'not yet')}
        {row(indexed, 'Offline search for Ask', indexed ? 'ready' : pack.status === 'ready' ? 'not yet' : 'needs offline answers')}
        {row(audioReady || !vk, 'Reading and quiz questions in your voice', !vk ? 'your chosen voice works offline' : audioReady ? 'downloaded' : 'not downloaded')}
        {row(natural.status === 'ready', 'Feedback and answers read aloud', natural.status === 'ready' ? 'Natural voice' : 'device voice')}
        {row(pack.status === 'ready', 'Offline grading and voice answers', pack.status === 'ready' ? 'on this device' : 'set up once in Settings')}
      </ul>
      {vk && (
        <Toggle
          id="dl-audio"
          checked={audio}
          onChange={setAudio}
          label="Include studio voice audio"
          hint={`About ${audioEstimateMB(meta?.wordCount || 0) + 2} MB for the reading and the quiz questions. Without it, ${natural.status === 'ready' ? 'the Natural voice' : 'your device voice'} reads offline.`}
        />
      )}
      {prog ? (
        <div className="stack" role="status">
          <span className="hint">{prog.label}</span>
          <Horizon pct={prog.pct} label="Download progress" />
          <button className="btn btn-ghost sm" onClick={() => (cancel.current = true)}>
            Stop
          </button>
        </div>
      ) : (
        <div className="row gap wrap">
          <button className="btn btn-sun" onClick={run} disabled={!online}>
            <Icon name="download" size={18} /> {ready && (!audio || audioReady) && (indexed || !packReady()) ? 'Update download' : 'Download for offline'}
          </button>
          {pack.status !== 'ready' && (
            <button className="btn btn-ghost" onClick={() => go({ name: 'settings' })}>
              Set up offline answers
            </button>
          )}
        </div>
      )}
      {!online && <p className="hint warn">You're offline. Downloading needs a connection.</p>}
      {error && <ErrorNote message={error} />}
      {audioReady && !prog && (
        <button
          className="link-btn"
          onClick={async () => {
            const qs = Object.values(ctx.body.bank || {}).flat().flatMap((q) => sayChunks(q.question));
            await removeAudio([...ctx.s.sentences, ...qs], meta!.offline!.audio!);
            await removeIndex(ctx.id);
            patchDoc(ctx.id, (d) => d.offline && delete d.offline.audio);
            setAudio(false);
          }}
        >
          Remove downloaded audio
        </button>
      )}
    </div>
  );
}

/** Device-wide offline setup, shown in Settings. */
export function OfflineSettings() {
  const pack = usePack();
  const natural = useNatural();
  const coach = useCoach();
  const online = useOnline();
  const docs = useApp((s) => s.docs);
  const [model, setModel] = useState<string>(coach.model || COACH_MODELS[0].id);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirm, setConfirm] = useState<'pack' | 'coach' | 'natural' | null>(null);
  const gpu = webgpuSupported();

  useEffect(() => {
    storageUsage().then(setUsage);
  }, [pack.status, coach.status, natural.status]);

  const offlineDocs = Object.values(docs).filter((d) => d.offline);

  return (
    <div className="stack">
      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>Offline answers</h3>
            <p className="hint">Grades your answers and turns your voice into text on this device. About {ANSWER_PACK_MB} MB, downloaded once.</p>
          </div>
          {pack.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {pack.status === 'downloading' && <Horizon pct={pack.pct} label="Offline answers download" />}
        {pack.status === 'error' && <ErrorNote message={pack.error} />}
        <div className="row gap wrap">
          {pack.status !== 'ready' && (
            <button
              className="btn btn-sun"
              disabled={!online || pack.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadAnswerPack();
              }}
            >
              <Icon name="download" size={18} /> {pack.status === 'downloading' ? `Downloading ${Math.round(pack.pct * 100)}%` : 'Download'}
            </button>
          )}
          {pack.status === 'ready' && (
            <button className="link-btn" onClick={() => (confirm === 'pack' ? (removeAnswerPack(), setConfirm(null)) : setConfirm('pack'))}>
              {confirm === 'pack' ? 'Tap again to remove it from this device' : 'Remove from this device'}
            </button>
          )}
        </div>
      </div>

      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>Natural voice</h3>
            <p className="hint">A lifelike voice that runs on this device, about {NATURAL_MB} MB. It reads anything offline, including coach feedback and Ask answers. You can also choose it as your main voice. Free and private.</p>
          </div>
          {natural.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {natural.status === 'downloading' && <Horizon pct={natural.pct} label="Natural voice download" />}
        {natural.stage && <p className="hint">{natural.stage}</p>}
        {natural.status === 'error' && <ErrorNote message={natural.error} />}
        <div className="row gap wrap">
          {natural.status !== 'ready' && (
            <button
              className="btn btn-sun"
              disabled={!online || natural.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadNatural();
              }}
            >
              <Icon name="download" size={18} /> {natural.status === 'downloading' ? `Downloading ${Math.round(natural.pct * 100)}%` : 'Download'}
            </button>
          )}
          {natural.status === 'ready' && (
            <>
              <button className="btn btn-ghost sm" onClick={() => setSettings({ provider: 'neural' })}>
                <Icon name="wave" size={16} /> Make it my main voice
              </button>
              <button className="link-btn" onClick={() => (confirm === 'natural' ? (removeNatural(), setConfirm(null)) : setConfirm('natural'))}>
                {confirm === 'natural' ? 'Tap again to remove it' : 'Remove'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="offline-card">
        <div className="row between gap wrap">
          <div>
            <h3>On-device coach</h3>
            <p className="hint">Optional. Answers your questions in Ask and gives written feedback with no connection. Simpler than the online coach.</p>
          </div>
          {coach.status === 'ready' && <span className="ready-tag">Ready</span>}
        </div>
        {!gpu && <p className="hint warn">This browser can't run it. It needs WebGPU: recent Chrome or Edge on a computer, Chrome on Android, or Safari on iOS 26 or later.</p>}
        {coach.status !== 'ready' && gpu && (
          <div className="model-picks" role="radiogroup" aria-label="Coach size">
            {COACH_MODELS.map((m) => (
              <button key={m.id} role="radio" aria-checked={model === m.id} className={`model-pick ${model === m.id ? 'on' : ''}`} onClick={() => setModel(m.id)} disabled={coach.status === 'downloading'}>
                <strong>
                  {m.name} <span className="hint">{m.size}</span>
                </strong>
                <span className="hint">{m.note}</span>
              </button>
            ))}
          </div>
        )}
        {(coach.status === 'downloading' || coach.status === 'loading') && (
          <div className="stack">
            <Horizon pct={coach.pct} label="Coach download" />
            <span className="hint">{coach.text.replace(/\[.*?\]\s*/g, '').slice(0, 120)}</span>
          </div>
        )}
        {coach.status === 'error' && <ErrorNote message={coach.error} />}
        <div className="row gap wrap">
          {coach.status !== 'ready' && gpu && (
            <button
              className="btn btn-sun"
              disabled={!online || coach.status === 'downloading'}
              onClick={async () => {
                await keepStorage();
                downloadCoach(model);
              }}
            >
              <Icon name="download" size={18} /> {coach.status === 'downloading' ? `Downloading ${Math.round(coach.pct * 100)}%` : `Download ${COACH_MODELS.find((m) => m.id === model)?.name}`}
            </button>
          )}
          {coach.status === 'ready' && (
            <>
              <span className="hint">{COACH_MODELS.find((m) => m.id === coach.model)?.name} coach installed</span>
              <button className="link-btn" onClick={() => (confirm === 'coach' ? (removeCoach(), setConfirm(null)) : setConfirm('coach'))}>
                {confirm === 'coach' ? 'Tap again to remove it' : 'Remove'}
              </button>
            </>
          )}
        </div>
      </div>

      {offlineDocs.length > 0 && (
        <div className="offline-card">
          <h3>Downloaded pieces</h3>
          <ul className="status-list">
            {offlineDocs.map((d) => (
              <li key={d.id} className="on">
                <span className="status-dot" aria-hidden="true" />
                <button className="grow link-like" onClick={() => go({ name: 'doc', id: d.id, tab: 'listen' })}>
                  {d.title}
                </button>
                <span className="hint">{d.offline?.audio ? 'with audio' : 'text and quizzes'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {usage && (
        <p className="hint tabular">
          Rise is using {fmtBytes(usage.used)} on this device{usage.quota ? ` of ${fmtBytes(usage.quota)} available` : ''}.
        </p>
      )}
    </div>
  );
}
