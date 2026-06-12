import React from 'react';
import Avatar3D from './Avatar3D.jsx';
import { SKIN_HUES, BODY_HUES, HATS, ACCESSORIES, FACE_SHAPES, randomAvatar } from '../avatar.js';

const EMOTIONS = ['neutral', 'happy', 'cocky', 'hype', 'mad', 'sad', 'chill'];

function Swatch({ hue, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="no-select"
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        border: active ? '3px solid white' : '2px solid transparent',
        background: `hsl(${hue} 75% 58%)`,
        boxShadow: active ? `0 0 14px hsl(${hue} 90% 60%)` : 'none',
        transform: active ? 'scale(1.12)' : 'scale(1)',
        transition: 'transform .15s ease',
      }}
    />
  );
}

export default function AvatarCustomizer({ avatar, onChange, emotion, setEmotion, footer }) {
  const set = (patch) => onChange({ ...avatar, ...patch });

  return (
    <div className="customizer">
      <div className="customizer-stage card tight">
        <Avatar3D avatar={avatar} emotion={emotion} controls size={160} />
        <div className="emotion-tray">
          {EMOTIONS.map((e) => (
            <button
              key={e}
              className={`chip sm ${emotion === e ? 'active' : ''}`}
              onClick={() => setEmotion(e)}
              style={{ fontSize: 11, padding: '4px 9px' }}
            >
              {e}
            </button>
          ))}
        </div>
        <button className="btn secondary sm" onClick={() => onChange(randomAvatar())} style={{ marginTop: 4 }}>
          🎲 Randomize
        </button>
        {footer && <div className="customizer-footer stack">{footer}</div>}
      </div>

      <div className="customizer-controls stack">
        <div>
          <div className="label">Skin</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            {SKIN_HUES.map((h) => (
              <Swatch key={h} hue={h} active={avatar.skinHue === h} onClick={() => set({ skinHue: h })} />
            ))}
          </div>
        </div>
        <div>
          <div className="label">Color</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            {BODY_HUES.map((h) => (
              <Swatch key={h} hue={h} active={avatar.bodyHue === h} onClick={() => set({ bodyHue: h })} />
            ))}
          </div>
        </div>
        <div>
          <div className="label">Face shape</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            {FACE_SHAPES.map((f) => (
              <button key={f} className={`chip sm ${avatar.face === f ? 'active' : ''}`} onClick={() => set({ face: f })}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Hat</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            {HATS.map((h) => (
              <button key={h.id} className={`chip sm ${avatar.hat === h.id ? 'active' : ''}`} onClick={() => set({ hat: h.id })}>
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Accessory</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            {ACCESSORIES.map((a) => (
              <button key={a.id} className={`chip sm ${avatar.accessory === a.id ? 'active' : ''}`} onClick={() => set({ accessory: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
