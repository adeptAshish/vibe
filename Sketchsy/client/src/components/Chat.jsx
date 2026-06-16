import React, { useEffect, useRef, useState } from 'react';
import { useGame } from '../GameContext.jsx';

export default function Chat({ canGuess }) {
  const { chat, sendGuess } = useGame();
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendGuess(t);
    setText('');
  };

  return (
    <div className="chat card tight">
      <div className="label" style={{ marginBottom: 6 }}>💬 Guesses & chat</div>
      <div className="chat-log scroll">
        {chat.map((m) => (
          <div key={m.key} className={`chat-msg ${m.type}`}>
            {m.type === 'correct' ? (
              <span className="chat-correct">✅ {m.text}</span>
            ) : m.type === 'close' ? (
              <span className="chat-close">🔥 {m.text}</span>
            ) : (
              <>
                <b>{m.name}:</b> <span>{m.text}</span>
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="row" style={{ marginTop: 8 }}>
        <input
          className="input"
          value={text}
          placeholder={canGuess ? 'Type your guess…' : 'Chat…'}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn sm" type="submit">Send</button>
      </form>
    </div>
  );
}
