import React, { useEffect, useState } from 'react';
import { useGame } from '../GameContext.jsx';

export default function GameHeader() {
  const { room, you, yourWord, leaveRoom } = useGame();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const isDrawer = room.currentDrawerId === you;
  const isHost = room.hostId === you;
  const drawer = room.players.find((p) => p.id === room.currentDrawerId);
  const total = room.settings.drawTime;
  const remaining = room.turnEndsAt ? Math.max(0, Math.ceil((room.turnEndsAt - now) / 1000)) : null;
  const frac = remaining != null ? remaining / total : 1;

  const wordDisplay = isDrawer && yourWord ? yourWord : room.maskedWord || '';
  const letters = (wordDisplay || '').split('');

  const danger = remaining != null && remaining <= 10;

  const goHome = () => {
    const msg = isHost ? 'Leave and end the game for everyone?' : 'Leave the game?';
    if (window.confirm(msg)) leaveRoom();
  };

  return (
    <div className="game-header card tight">
      <div className="header-left">
        <button className="btn ghost sm" onClick={goHome} title="Back to home">
          🏠
        </button>
        <div className="round-badge">
          Round <b>{room.currentRound}</b>/{room.totalRounds}
        </div>
      </div>

      <div className="word-zone">
        {room.phase === 'choosing' ? (
          <span className="muted" style={{ fontWeight: 700 }}>
            {isDrawer ? 'Pick a word to draw…' : `${drawer?.name || 'Someone'} is choosing a word…`}
          </span>
        ) : (
          <div className="word-letters no-select">
            {letters.map((ch, i) => (
              <span key={i} className={`word-letter ${ch === '_' ? 'blank' : ''} ${ch === ' ' ? 'space' : ''}`}>
                {ch === ' ' ? '\u00A0' : ch}
              </span>
            ))}
            {!isDrawer && room.wordLength > 0 && (
              <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>{room.wordLength} letters</span>
            )}
          </div>
        )}
      </div>

      {remaining != null && room.phase === 'drawing' && (
        <div className={`timer ${danger ? 'danger' : ''}`}>
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="22" fill="none" stroke="hsla(0 0% 100% / .12)" strokeWidth="6" />
            <circle
              cx="26" cy="26" r="22" fill="none"
              stroke={danger ? 'var(--c-bad)' : 'var(--c-secondary)'}
              strokeWidth="6" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 22}
              strokeDashoffset={2 * Math.PI * 22 * (1 - frac)}
              transform="rotate(-90 26 26)"
              style={{ transition: 'stroke-dashoffset .3s linear' }}
            />
          </svg>
          <span className="timer-num">{remaining}</span>
        </div>
      )}
    </div>
  );
}
