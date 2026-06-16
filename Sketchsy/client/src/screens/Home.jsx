import React, { useEffect, useState } from 'react';
import { useGame } from '../GameContext.jsx';
import AvatarCustomizer from '../components/AvatarCustomizer.jsx';
import { DEFAULT_AVATAR, randomAvatar } from '../avatar.js';

const NAME_KEY = 'sketchsy:name';
const AVATAR_KEY = 'sketchsy:avatar';

function loadAvatar() {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return randomAvatar();
}

export default function Home() {
  const { createRoom, joinRoom, connected, flashToast } = useGame();
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) || '');
  const [avatar, setAvatar] = useState(loadAvatar);
  const [emotion, setEmotion] = useState('happy');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('choose'); // choose | join
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
  }, [avatar]);

  const validName = name.trim().length >= 2;

  const doCreate = async () => {
    if (!validName) return flashToast('Pick a name (2+ letters)!');
    setBusy(true);
    await createRoom(name.trim(), avatar);
    setBusy(false);
  };

  const doJoin = async () => {
    if (!validName) return flashToast('Pick a name (2+ letters)!');
    if (joinCode.trim().length < 4) return flashToast('Enter a room code.');
    setBusy(true);
    await joinRoom(joinCode.trim().toUpperCase(), name.trim(), avatar);
    setBusy(false);
  };

  return (
    <div className="center-screen">
      <div className="home-grid">
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <h1 className="brand xl no-select" style={{ animation: 'wiggle 6s ease-in-out infinite' }}>
            Sketchsy
          </h1>
          <p className="tagline">draw it • guess it • giggle • repeat</p>
          <span className={`chip ${connected ? '' : ''}`} style={{ marginTop: 4 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: connected ? 'var(--c-good)' : 'var(--c-bad)',
                boxShadow: connected ? '0 0 10px var(--c-good)' : 'none',
              }}
            />
            {connected ? 'Connected to server' : 'Connecting…'}
          </span>
        </div>

        <div className="card stack" style={{ minWidth: 340 }}>
          <AvatarCustomizer
            avatar={avatar}
            onChange={setAvatar}
            emotion={emotion}
            setEmotion={setEmotion}
            footer={
              <>
                <label className="field">
                  Your name
                  <input
                    className="input"
                    value={name}
                    maxLength={16}
                    placeholder="e.g. PicassoPanda"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                {mode === 'choose' ? (
                  <div className="stack">
                    <button className="btn block pulse" disabled={busy} onClick={doCreate}>
                      🚀 Create a Room
                    </button>
                    <button className="btn secondary block" onClick={() => setMode('join')}>
                      🔑 Join with Code
                    </button>
                  </div>
                ) : (
                  <div className="stack">
                    <label className="field">
                      Room code
                      <input
                        className="input"
                        value={joinCode}
                        maxLength={6}
                        placeholder="ABCDE"
                        style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 800 }}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && doJoin()}
                      />
                    </label>
                    <div className="row">
                      <button className="btn good grow" disabled={busy} onClick={doJoin}>
                        Join Game
                      </button>
                      <button className="btn ghost" onClick={() => setMode('choose')}>
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
