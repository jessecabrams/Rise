import { useEffect, useState } from 'react';
import { Icon, Segmented } from './ui';
import { setSettings, useApp } from '../lib/store';
import { deviceVoices, onVoicesChanged, player, say } from '../lib/speech';
import { api, useServer } from '../lib/api';
import { NATURAL_VOICES, isIOS, useNatural } from '../lib/localtts';
import { AppleVoicesHelp } from './AppleVoices';
import { go } from '../lib/nav';
import type { Provider } from '../lib/types';

interface V {
  id: string;
  name: string;
  desc: string;
}

let cloudCache: { openai: V[]; elevenlabs: V[] } | null = null;

export function VoicePicker() {
  const s = useApp((st) => st.settings);
  const srv = useServer();
  const natural = useNatural();
  const [device, setDevice] = useState(deviceVoices());
  const [cloud, setCloud] = useState(cloudCache);
  const ready = srv.reachable && (!srv.passcode || srv.authed);

  useEffect(() => onVoicesChanged(() => setDevice(deviceVoices())), []);
  useEffect(() => {
    if (!ready || cloudCache || (!srv.features.openai && !srv.features.elevenlabs)) return;
    api<{ openai: V[]; elevenlabs: V[] }>('/api/voices')
      .then((r) => {
        cloudCache = r;
        setCloud(r);
      })
      .catch(() => {});
  }, [ready, srv.features.openai, srv.features.elevenlabs]);

  const choose = (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch);
    setTimeout(() => player.refreshVoice(), 0);
  };

  const preview = () => say('Build your life around your brain. Here is how I will sound reading to you.');

  let list: V[] = [];
  let current = '';
  if (s.provider === 'device') {
    list = device.map((v) => {
      const q = `${v.name} ${v.voiceURI}`;
      const tier = /premium/i.test(q) ? ' · Premium' : /enhanced/i.test(q) ? ' · Enhanced' : /(natural|neural)/i.test(q) ? ' · high quality' : '';
      return { id: v.name, name: v.name.replace(/\s*\((premium|enhanced)\)$/i, ''), desc: v.lang + tier };
    });
    current = s.deviceVoice || list[0]?.id || '';
  } else if (s.provider === 'neural') {
    list = NATURAL_VOICES;
    current = s.neuralVoice || 'af_heart';
  } else if (s.provider === 'openai') {
    list = cloud?.openai || [];
    current = s.openaiVoice;
  } else {
    list = cloud?.elevenlabs || [];
    current = s.elevenVoice || list[0]?.id || '';
  }

  const pick = (id: string) => {
    if (s.provider === 'device') choose({ deviceVoice: id });
    else if (s.provider === 'neural') choose({ neuralVoice: id });
    else if (s.provider === 'openai') choose({ openaiVoice: id });
    else choose({ elevenVoice: id });
  };

  return (
    <div className="stack">
      <Segmented<Provider>
        label="Voice engine"
        value={s.provider}
        onChange={(p) => choose({ provider: p })}
        options={[
          { value: 'device', label: 'Device' },
          { value: 'neural', label: 'Natural' },
          { value: 'openai', label: 'Studio', disabled: !(ready && srv.features.openai) },
          { value: 'elevenlabs', label: 'Premium', disabled: !(ready && srv.features.elevenlabs) }
        ]}
      />
      <p className="hint">
        {s.provider === 'device' && (isIOS() ? 'Free voices built into this device.' : 'Free voices built into this device. On a Mac, Chrome also lists any Premium voices you download in System Settings › Accessibility › Spoken Content.')}
        {s.provider === 'neural' &&
          (natural.status === 'ready' && !isIOS()
            ? ready && srv.features.kokoro
              ? s.naturalWhere === 'device'
                ? 'Made on this computer for free. If it falls behind, the cloud fills in. Downloads and iPhone audio files are always made here for free.'
                : 'Made in the cloud while you listen, about $1 for every 18 hours. Downloads and iPhone audio files are made on this computer for free. Everything is saved and plays offline.'
              : 'Lifelike voices made on this computer. Free and private, and audio is saved so replays work offline.'
            : ready && srv.features.kokoro
              ? 'Lifelike voices from the cloud, about $1 for every 18 hours of listening. Anything you hear or download is saved on this device and plays offline.'
              : isIOS()
                ? 'Plays audio made on your computer (open a piece › Download › Make audio for iPhone). For the voice everywhere, add the cloud version in Settings.'
                : 'Download the Natural voice in Settings › Offline to use it here.')}
        {s.provider === 'openai' && 'Natural studio voices. About a penny per few minutes of listening.'}
        {s.provider === 'elevenlabs' && 'The most lifelike voices, with exact word timing. Uses your ElevenLabs credits.'}
        {!(ready && srv.features.openai) && s.provider === 'device' && ' Studio and Premium voices switch on once their keys are added to your Rise server.'}
      </p>
      {s.provider === 'device' && isIOS() && <AppleVoicesHelp />}
      {s.provider === 'neural' && natural.status === 'ready' && !isIOS() && ready && srv.features.kokoro && (
        <Segmented<'cloud' | 'device'>
          label="Where the Natural voice is made while you listen"
          value={s.naturalWhere === 'device' ? 'device' : 'cloud'}
          onChange={(w) => choose({ naturalWhere: w })}
          options={[
            { value: 'cloud', label: 'Cloud: smoothest' },
            { value: 'device', label: 'This computer: free' }
          ]}
        />
      )}

      {s.provider === 'openai' && (
        <label className="field" htmlFor="voice-style">
          <span>How should it sound?</span>
          <input id="voice-style" value={s.voiceStyle} onChange={(e) => setSettings({ voiceStyle: e.target.value })} onBlur={() => player.refreshVoice()} placeholder="Warm, upbeat coach. Slightly playful." />
        </label>
      )}

      <div className="voice-list" role="listbox" aria-label="Voices">
        {list.length === 0 && <p className="hint">Loading voices…</p>}
        {list.map((v) => (
          <button key={v.id} role="option" aria-selected={current === v.id} className={`voice-item ${current === v.id ? 'on' : ''}`} onClick={() => pick(v.id)}>
            <span className="voice-dot" aria-hidden="true" />
            <span className="voice-text">
              <strong>{v.name}</strong>
              {v.desc && <small>{v.desc}</small>}
            </span>
            {current === v.id && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      {natural.status !== 'ready' && (
        <button className="link-btn" onClick={() => go({ name: 'settings' })}>
          Get the Natural voice: lifelike, free and works offline
        </button>
      )}
      <button className="btn btn-ghost" onClick={preview}>
        <Icon name="speaker" size={18} /> Hear this voice
      </button>
    </div>
  );
}

export function SpeedControl() {
  const rate = useApp((s) => s.settings.rate);
  const set = (r: number) => {
    setSettings({ rate: Math.round(r * 100) / 100 });
    setTimeout(() => player.applyRate(), 0);
  };
  return (
    <div className="stack">
      <div className="speed-readout">
        <span className="speed-num tabular">{rate.toFixed(2).replace(/0$/, '')}×</span>
        <span className="hint">{Math.round(165 * rate)} words per minute</span>
      </div>
      <input id="speed" type="range" min={0.5} max={3} step={0.05} value={rate} onChange={(e) => set(Number(e.target.value))} aria-label="Reading speed" />
      <div className="chips">
        {[0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((r) => (
          <button key={r} className={`chip ${Math.abs(rate - r) < 0.01 ? 'on' : ''}`} onClick={() => set(r)}>
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}
