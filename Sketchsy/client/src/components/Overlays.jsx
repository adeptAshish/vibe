import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../GameContext.jsx';
import Avatar3D from './Avatar3D.jsx';
import AvatarFace from './AvatarFace.jsx';

function Backdrop({ children }) {
  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {children}
    </motion.div>
  );
}

function WordChoice() {
  const { wordChoices, chooseWord, room } = useGame();
  if (!wordChoices) return null;
  return (
    <Backdrop>
      <motion.div className="card stack" initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} style={{ textAlign: 'center' }}>
        <h2 className="brand lg">Choose your word!</h2>
        <p className="muted">Round {room.currentRound} · pick what you'll draw</p>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {wordChoices.map((w, i) => (
            <motion.button
              key={w}
              className="btn"
              style={{ fontSize: 20, padding: '18px 28px' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ scale: 1.06 }}
              onClick={() => chooseWord(w)}
            >
              {w}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </Backdrop>
  );
}

function TurnEnd() {
  const { turnEnd } = useGame();
  if (!turnEnd) return null;
  const scores = turnEnd.scores || [];
  return (
    <Backdrop>
      <motion.div className="card stack" initial={{ scale: 0.85 }} animate={{ scale: 1 }} style={{ textAlign: 'center', minWidth: 360 }}>
        <div className="muted" style={{ fontWeight: 700 }}>{turnEnd.reason}</div>
        <h2 className="brand lg">The word was</h2>
        <div className="reveal-word">{turnEnd.word}</div>
        <div className="divider" />
        <div className="stack" style={{ gap: 6, maxHeight: '40vh', overflowY: 'auto' }}>
          {scores.map((p, i) => (
            <motion.div
              key={p.id}
              className="player-row"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <span className="rank">{i + 1}</span>
              <AvatarFace avatar={p.avatar} emotion={p.emotion} size={36} />
              <span className="grow" style={{ fontWeight: 700, textAlign: 'left' }}>{p.name}</span>
              {p.roundScore > 0 && <span style={{ color: 'var(--c-good)', fontWeight: 800 }}>+{p.roundScore}</span>}
              <span className="muted">{p.score}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </Backdrop>
  );
}

function GameEnd() {
  const { gameEnd, room, you, returnToLobby } = useGame();
  if (!gameEnd) return null;
  const scores = gameEnd.scores || [];
  const top = scores.slice(0, 3);
  const isHost = room?.hostId === you;
  const podiumOrder = [top[1], top[0], top[2]].filter(Boolean); // 2nd, 1st, 3rd

  return (
    <Backdrop>
      <motion.div className="card stack" initial={{ scale: 0.85 }} animate={{ scale: 1 }} style={{ textAlign: 'center', maxWidth: 720 }}>
        <h1 className="brand lg" style={{ fontSize: 30 }}>🎉 Game Over!</h1>
        <div className="podium">
          {podiumOrder.map((p) => {
            const place = scores.indexOf(p);
            return (
              <motion.div
                key={p.id}
                className={`podium-col place-${place}`}
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 120, delay: 0.1 * place }}
              >
                <Avatar3D avatar={p.avatar} emotion={p.emotion} size={place === 0 ? 150 : 120} controls={false} />
                <div className="podium-name">{p.name}</div>
                <div className="podium-block">
                  <span className="podium-medal">{['🥇', '🥈', '🥉'][place]}</span>
                  <span className="podium-score">{p.score}</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {scores.length > 3 && (
          <div className="stack" style={{ gap: 5, maxWidth: 360, margin: '0 auto', width: '100%' }}>
            {scores.slice(3).map((p, i) => (
              <div key={p.id} className="player-row">
                <span className="rank">{i + 4}</span>
                <AvatarFace avatar={p.avatar} emotion={p.emotion} size={32} />
                <span className="grow" style={{ textAlign: 'left', fontWeight: 700 }}>{p.name}</span>
                <span className="muted">{p.score}</span>
              </div>
            ))}
          </div>
        )}

        {isHost ? (
          <button className="btn pulse" onClick={returnToLobby}>🔁 Back to Lobby</button>
        ) : (
          <div className="chip">Waiting for host to restart…</div>
        )}
      </motion.div>
    </Backdrop>
  );
}

export default function Overlays() {
  const { wordChoices, turnEnd, gameEnd } = useGame();
  return (
    <AnimatePresence>
      {gameEnd ? <GameEnd key="end" /> : turnEnd ? <TurnEnd key="turn" /> : wordChoices ? <WordChoice key="choose" /> : null}
    </AnimatePresence>
  );
}
