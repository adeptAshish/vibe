import React from 'react';
import AvatarFace from './AvatarFace.jsx';
import { useGame } from '../GameContext.jsx';

export default function PlayerList() {
  const { room, you } = useGame();
  const players = [...room.players].sort((a, b) => b.score - a.score);

  return (
    <div className="players card tight">
      <div className="label" style={{ marginBottom: 6 }}>🏆 Scoreboard</div>
      <div className="stack scroll" style={{ gap: 6 }}>
        {players.map((p, i) => (
          <div key={p.id} className={`player-row ${p.isDrawing ? 'drawing' : ''} ${p.guessed ? 'guessed' : ''}`}>
            <span className="rank">{i + 1}</span>
            <AvatarFace avatar={p.avatar} emotion={p.emotion} size={38} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}{p.id === you && <span className="muted"> (you)</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{p.score} pts</div>
            </div>
            {p.isDrawing && <span title="drawing">✏️</span>}
            {p.guessed && !p.isDrawing && <span title="guessed">✅</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
