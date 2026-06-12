import React, { useEffect, useState } from 'react';

const THEME_KEY = 'sketchsy:theme';

function getInitial() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'night' || saved === 'vibrant') return saved;
  } catch {}
  return 'vibrant';
}

// Floating, always-available theme switch. "Night mode" calms the colors,
// dims the glow and stops the animated hue cycling for easier-on-the-eyes play.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const night = theme === 'night';

  return (
    <button
      className="theme-toggle no-select"
      onClick={() => setTheme(night ? 'vibrant' : 'night')}
      title={night ? 'Switch to vibrant mode' : 'Switch to night mode'}
      aria-label="Toggle night mode"
    >
      <span className="theme-toggle-icon">{night ? '🌙' : '☀️'}</span>
      <span className="theme-toggle-label">{night ? 'Night' : 'Vibrant'}</span>
    </button>
  );
}
