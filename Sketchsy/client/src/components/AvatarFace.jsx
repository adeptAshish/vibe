import React from 'react';

// Lightweight 2D SVG avatar for dense lists (player sidebar, chat). Mirrors the
// 3D avatar's look and reacts to emotion, but cheap to render many at once.
export default function AvatarFace({ avatar = {}, emotion = 'neutral', size = 44 }) {
  const skin = `hsl(${avatar.skinHue ?? 28} 55% 65%)`;
  const body = `hsl(${avatar.bodyHue ?? 260} 70% 58%)`;
  const eye = `hsl(${avatar.eyeHue ?? 220} 70% 40%)`;
  const browColor = `hsl(${avatar.skinHue ?? 28} 30% 25%)`;

  const mouth = {
    happy: 'M 32 60 Q 50 78 68 60',
    hype: 'M 34 58 Q 50 82 66 58 Q 50 70 34 58',
    cocky: 'M 36 62 Q 54 72 66 58',
    mad: 'M 34 68 Q 50 54 66 68',
    sad: 'M 34 70 Q 50 58 66 70',
    chill: 'M 36 64 L 64 64',
    neutral: 'M 36 62 Q 50 70 64 62',
  }[emotion] || 'M 36 62 Q 50 70 64 62';

  const browY = emotion === 'cocky' ? 34 : 38;
  const browL = { mad: 'rotate(18 36 38)', sad: 'rotate(-18 36 38)', cocky: 'rotate(-8 36 34)' }[emotion] || '';
  const browR = { mad: 'rotate(-18 64 38)', sad: 'rotate(18 64 38)', cocky: 'rotate(8 64 34)' }[emotion] || '';

  const shape =
    avatar.face === 'square'
      ? { rx: 30, ry: 30 }
      : avatar.face === 'oval'
      ? { rx: 34, ry: 40 }
      : avatar.face === 'bean'
      ? { rx: 40, ry: 34 }
      : { rx: 37, ry: 37 };

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`g-${avatar.skinHue}-${avatar.bodyHue}`} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor={skin} />
          <stop offset="100%" stopColor={`hsl(${avatar.skinHue ?? 28} 50% 52%)`} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="88" rx="40" ry="20" fill={body} />
      <ellipse cx="50" cy="46" rx={shape.rx} ry={shape.ry} fill={`url(#g-${avatar.skinHue}-${avatar.bodyHue})`} />
      {/* eyes */}
      <circle cx="36" cy="46" r="8" fill="#fff" />
      <circle cx="64" cy="46" r="8" fill="#fff" />
      <circle cx={emotion === 'cocky' ? 38 : 36} cy="47" r="4" fill={eye} />
      <circle cx={emotion === 'cocky' ? 66 : 64} cy="47" r="4" fill={eye} />
      {/* brows */}
      <rect x="28" y={browY} width="16" height="4" rx="2" fill={browColor} transform={browL} />
      <rect x="56" y={browY} width="16" height="4" rx="2" fill={browColor} transform={browR} />
      {/* mouth */}
      <path d={mouth} stroke={`hsl(0 50% 35%)`} strokeWidth="4" fill="none" strokeLinecap="round" />
      {avatar.accessory === 'shades' && <rect x="26" y="40" width="48" height="12" rx="4" fill="hsl(0 0% 12%)" />}
    </svg>
  );
}
