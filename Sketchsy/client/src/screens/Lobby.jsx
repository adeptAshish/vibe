import React, { useEffect, useState } from 'react';
import { useGame } from '../GameContext.jsx';
import Avatar3D from '../components/Avatar3D.jsx';
import AvatarFace from '../components/AvatarFace.jsx';

function Toggle({ on, onClick, label }) {
  return (
    <button className="row" onClick={onClick} style={{ background: 'none', gap: 10 }}>
      <span
        style={{
          width: 46,
          height: 26,
          borderRadius: 99,
          background: on ? 'linear-gradient(120deg,var(--c-primary),var(--c-secondary))' : 'hsla(270 30% 30% / .6)',
          position: 'relative',
          transition: 'background .2s ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 23 : 3,
            width: 20,
            height: 20,
            borderRadius: 99,
            background: 'white',
            transition: 'left .2s ease',
          }}
        />
      </span>
      <span style={{ fontWeight: 700 }}>{label}</span>
    </button>
  );
}

function CustomListMaker({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const { flashToast } = useGame();

  const submit = async () => {
    const words = text
      .split(/[\n,]/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length < 3) return flashToast('Add at least 3 words.');
    const res = await onAdd({ name: name.trim() || 'My List', words });
    if (res?.ok) {
      setName('');
      setText('');
      setOpen(false);
      flashToast(`Added "${res.list.name}" (${res.list.words.length} words)`);
    } else if (res?.error) flashToast(res.error);
  };

  if (!open)
    return (
      <button className="btn ghost sm" onClick={() => setOpen(true)}>
        ＋ Create custom word list
      </button>
    );

  return (
    <div className="stack card tight">
      <label className="field">
        List name
        <input className="input" value={name} placeholder="Inside jokes" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Words (comma or new line)
        <textarea className="textarea" value={text} placeholder="banana phone, dad joke, the floor is lava" onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn good grow sm" onClick={submit}>
          Save list
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Lobby() {
  const { room, you, meta, updateSettings, addCustomList, startGame, setPreferredGenre, leaveRoom, flashToast } = useGame();
  const isHost = room.hostId === you;
  const s = room.settings;
  const me = room.players.find((p) => p.id === you);
  const spotlight = room.players[0] || me;

  const toggleGenre = (name) => {
    const has = s.genres.includes(name);
    const next = has ? s.genres.filter((g) => g !== name) : [...s.genres, name];
    updateSettings({ genres: next.length ? next : [name] });
  };

  // The host usually opens the app at http://localhost:3000, but that link is
  // useless to other devices. Ask the server for its LAN URL so the invite
  // always points at a shareable address.
  const [shareUrl, setShareUrl] = useState(null);
  useEffect(() => {
    const origin = window.location.origin;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(origin);
    if (!isLocal) {
      setShareUrl(origin);
      return;
    }
    let alive = true;
    fetch('/api/network')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setShareUrl(d.primary || origin);
      })
      .catch(() => alive && setShareUrl(origin));
    return () => {
      alive = false;
    };
  }, []);

  const copyInvite = () => {
    const url = shareUrl || window.location.origin;
    const text = `Join my Sketchsy game!\n${url}\nRoom code: ${room.code}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => flashToast('Invite link copied!'),
        () => flashToast(url)
      );
    } else {
      flashToast(url);
    }
  };

  const goHome = () => {
    const msg = isHost ? 'Leave and close the room for everyone?' : 'Leave this room?';
    if (window.confirm(msg)) leaveRoom();
  };

  return (
    <div className="lobby">
      {/* Left: room + players */}
      <div className="lobby-side card stack">
        <div className="row spread">
          <button className="btn ghost sm" onClick={goHome} title="Back to home">
            🏠 Home
          </button>
          <button className="btn secondary sm" onClick={copyInvite}>
            📋 Invite
          </button>
        </div>
        <div className="divider" />
        <div className="row spread">
          <div>
            <div className="label">Room code</div>
            <div className="pill-code">{room.code}</div>
          </div>
        </div>
        <div className="share-box">
          <div className="label">Share this link (same WiFi)</div>
          <div className="share-url" title={shareUrl || ''}>
            {shareUrl ? shareUrl : 'Finding your network address…'}
          </div>
          {shareUrl && /localhost|127\.0\.0\.1/.test(shareUrl) && (
            <div className="share-warn">
              ⚠️ This is a localhost link — only works on this PC. Run the server with
              <code> npm start</code> so a sharable WiFi address appears here.
            </div>
          )}
        </div>
        <div className="divider" />
        <div className="label">Players · {room.players.length}/{s.maxPlayers}</div>
        <div className="lobby-players stack" style={{ gap: 8 }}>
          {room.players.map((p) => (
            <div key={p.id} className="player-row">
              <AvatarFace avatar={p.avatar} emotion={p.emotion} size={36} />
              <span className="grow" style={{ fontWeight: 700 }}>
                {p.name}
                {p.id === you && <span className="muted"> (you)</span>}
              </span>
              {p.isHost && <span className="chip sm" style={{ padding: '3px 9px' }}>👑 host</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Center: spotlight */}
      <div className="lobby-center card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h2 className="brand lg" style={{ fontSize: 26 }}>Get ready!</h2>
        {spotlight && <Avatar3D avatar={spotlight.avatar} emotion={spotlight.emotion || 'happy'} controls size={150} />}
        <div className="muted" style={{ fontWeight: 700, marginTop: -4 }}>{spotlight?.name}</div>

        {/* Per-player preferred genre */}
        {s.mode === 'genre' && s.letYouChooseGenre && (
          <div className="stack" style={{ width: '100%' }}>
            <div className="label">Your pick when you draw</div>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              {s.genres.map((g) => {
                const gm = meta.genres.find((x) => x.name === g);
                return (
                  <button
                    key={g}
                    className={`chip sm ${me?.preferredGenre === g ? 'active' : ''}`}
                    onClick={() => setPreferredGenre(g)}
                  >
                    {gm?.emoji} {g}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isHost ? (
          <button className="btn block pulse" disabled={room.players.length < 2} onClick={startGame}>
            {room.players.length < 2 ? 'Waiting for players…' : '▶ Start Game'}
          </button>
        ) : (
          <div className="chip">Waiting for the host to start…</div>
        )}
      </div>

      {/* Right: settings */}
      <div className="lobby-settings card stack scroll">
        <h3 className="brand lg" style={{ fontSize: 22 }}>Game settings</h3>
        {!isHost && <div className="muted">Only the host can change these.</div>}

        <fieldset disabled={!isHost} style={{ border: 'none', display: 'contents' }}>
          <div className="stack">
            <div className="label">Word source</div>
            <div className="row">
              <button className={`chip ${s.mode === 'genre' ? 'active' : ''}`} onClick={() => updateSettings({ mode: 'genre' })}>
                🎯 By genre
              </button>
              <button className={`chip ${s.mode === 'random' ? 'active' : ''}`} onClick={() => updateSettings({ mode: 'random' })}>
                🎲 Fully random
              </button>
            </div>
          </div>

          {s.mode === 'genre' && (
            <div className="stack">
              <div className="label">Genres</div>
              <div className="row wrap">
                {meta.genres.map((g) => (
                  <button key={g.name} className={`chip sm ${s.genres.includes(g.name) ? 'active' : ''}`} onClick={() => toggleGenre(g.name)}>
                    {g.emoji} {g.name}
                  </button>
                ))}
              </div>
              <Toggle on={s.letYouChooseGenre} onClick={() => updateSettings({ letYouChooseGenre: !s.letYouChooseGenre })} label="Players pick their own genre" />
            </div>
          )}

          <div className="stack">
            <div className="label">Difficulty</div>
            <div className="row wrap">
              {meta.difficulties.map((d) => (
                <button key={d.id} className={`chip ${s.difficulty === d.id ? 'active' : ''}`} onClick={() => updateSettings({ difficulty: d.id })}>
                  {d.emoji} {d.label} <span className="muted" style={{ fontWeight: 600 }}>· {d.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="row spread wrap" style={{ gap: 16 }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Rounds: {s.rounds}
              <input type="range" min={1} max={8} value={s.rounds} onChange={(e) => updateSettings({ rounds: +e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Draw time: {s.drawTime}s
              <input type="range" min={30} max={150} step={10} value={s.drawTime} onChange={(e) => updateSettings({ drawTime: +e.target.value })} />
            </label>
          </div>
          <div className="row spread wrap" style={{ gap: 16 }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Max players: {s.maxPlayers}
              <input type="range" min={2} max={16} value={s.maxPlayers} onChange={(e) => updateSettings({ maxPlayers: +e.target.value })} />
            </label>
            <div style={{ flex: 1, minWidth: 120, alignSelf: 'flex-end' }}>
              <Toggle on={s.hintsEnabled} onClick={() => updateSettings({ hintsEnabled: !s.hintsEnabled })} label="Letter hints" />
            </div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <Toggle
              on={s.freshWords}
              onClick={() => updateSettings({ freshWords: !s.freshWords })}
              label="✨ Fresh words (online)"
            />
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
              Pulls fresh, themed words from the internet so they don't repeat.
              Only the host needs a connection — it falls back to built-in words automatically when offline.
            </div>
          </div>

          <div className="divider" />
          <div className="label">Custom lists ({s.customLists.length})</div>
          {s.customLists.length > 0 && (
            <div className="row wrap">
              {s.customLists.map((l) => (
                <span key={l.id} className="chip sm">📝 {l.name} ({l.words.length})</span>
              ))}
            </div>
          )}
          {isHost && <CustomListMaker onAdd={addCustomList} />}
        </fieldset>
      </div>
    </div>
  );
}
