// Sketchsy dynamic word source.
//
// Strategy (Option B + Option A fallback):
//   B (primary):  fetch FRESH, on-theme, drawable nouns from the free Datamuse
//                 API (https://api.datamuse.com) by seeding it with concrete
//                 words from our curated genre lists ("means like" + noun
//                 filtering). Seeds are chosen randomly each fetch, so words
//                 rotate naturally instead of repeating a fixed list.
//   A (fallback): if the host is offline or a fetch fails / returns too few
//                 words, fall back to the bundled static GENRES corpus.
//
// Datamuse needs no API key and is rate-friendly. Only the HOST machine needs
// internet; players never call it. Results are cached in memory and refreshed
// in the background so turns never block on the network.

import { GENRES, GENRE_NAMES, getWordChoices as staticChoices } from './words.js';

const DATAMUSE = 'https://api.datamuse.com/words';
const FETCH_TIMEOUT = 4000; // ms
const CACHE_TTL = 1000 * 60 * 20; // 20 min freshness window
const MAX_PER_TIER = 80; // cap cached words per genre+tier
const SEEDS_PER_FETCH = 3; // how many curated seeds to expand per genre

// Topic bias per genre keeps Datamuse "means like" results on-theme.
const GENRE_TOPICS = {
  Animals: 'animal',
  Food: 'food',
  Movies: 'movie',
  Sports: 'sport',
  Objects: 'object',
  Nature: 'nature',
  Tech: 'technology',
  Fantasy: 'fantasy',
};

// Common but hard-to-draw abstract nouns we never want as words.
const STOPLIST = new Set([
  'idea', 'time', 'death', 'life', 'luxury', 'tomorrow', 'today', 'tonight',
  'business', 'quality', 'value', 'amount', 'reason', 'result', 'example',
  'moment', 'version', 'queue', 'feature', 'process', 'member', 'agency',
  'thing', 'way', 'part', 'kind', 'sort', 'type', 'area', 'case', 'fact',
  'point', 'matter', 'substance', 'being', 'organism', 'entity', 'concept',
  'percent', 'percentage', 'total', 'rate', 'level', 'degree', 'series',
  'putnam', 'edo', 'api', 'boring', 'sensual', 'carnal', 'humour', 'humor',
  // verb-ish / abstract words that are technically nouns but undrawable
  'close', 'closure', 'end', 'fix', 'fool', 'focus', 'aim', 'throw', 'pile',
  'preserve', 'try', 'use', 'run', 'set', 'turn', 'start', 'stop', 'move',
  'change', 'order', 'play', 'work', 'help', 'call', 'deal', 'sign', 'mark',
  'note', 'plan', 'view', 'show', 'form', 'state', 'group', 'side', 'line',
]);

const MIN_FREQ = 0.4; // drop ultra-rare/obscure words from easy & medium tiers

// genre -> { tiers: { giowa:Set, fun:Set, smartpants:Set }, ts, fetching }
const cache = new Map();

// Tracks whether the network appears reachable (best-effort, for status UI).
let online = true;
let lastError = null;

export function getWordSourceStatus() {
  return { online, lastError };
}

// Which tiers to draw from for a difficulty (mirror of words.js, with easier
// tiers mixed in for variety).
function tiersForDifficulty(difficulty) {
  if (difficulty === 'giowa') return ['giowa'];
  if (difficulty === 'fun') return ['fun', 'giowa'];
  return ['smartpants', 'fun'];
}

function sample(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// Pick concrete seed words from a genre's curated lists to expand.
function seedsForGenre(name) {
  const g = GENRES[name];
  if (!g) return [];
  const all = [...(g.giowa || []), ...(g.fun || []), ...(g.smartpants || [])];
  // Prefer single-word, drawable seeds for cleaner "means like" results.
  const simple = all.filter((w) => /^[a-z][a-z]+$/i.test(w));
  return sample(simple.length ? simple : all, SEEDS_PER_FETCH);
}

function freqOf(entry) {
  const tag = (entry.tags || []).find((t) => t.startsWith('f:'));
  return tag ? parseFloat(tag.slice(2)) : 0;
}

function isNoun(entry) {
  return (entry.tags || []).includes('n');
}

// Keep clean, drawable single-concept words.
function isDrawable(word) {
  if (!word) return false;
  if (!/^[a-z][a-z]*( [a-z]+){0,2}$/i.test(word)) return false; // up to 3 words
  if (word.length < 3 || word.length > 18) return false;
  // Reject gerunds/long verb forms ("training", "closing") which rarely draw well.
  if (/[a-z]{4,}ing$/i.test(word)) return false;
  return true;
}

// Bin a word into a difficulty tier from its frequency + length.
function classify(word, f) {
  const len = word.replace(/[^a-z]/gi, '').length;
  const multi = word.includes(' ');
  if (f >= 8 && len <= 8 && !multi) return 'giowa';
  if (f >= 1 && len <= 12) return 'fun';
  return 'smartpants';
}

async function datamuse(seed, topic) {
  const topicParam = topic ? `&topics=${encodeURIComponent(topic)}` : '';
  const url = `${DATAMUSE}?ml=${encodeURIComponent(seed)}${topicParam}&max=50&md=fp`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function emptyTiers() {
  return { giowa: new Set(), fun: new Set(), smartpants: new Set() };
}

function cap(set) {
  if (set.size <= MAX_PER_TIER) return;
  const arr = [...set];
  // drop oldest-ish (front) entries
  for (let i = 0; i < arr.length - MAX_PER_TIER; i++) set.delete(arr[i]);
}

// Fetch fresh words for one genre and merge into the cache. Best-effort.
async function refreshGenre(name) {
  const seeds = seedsForGenre(name);
  if (seeds.length === 0) return;

  const entry = cache.get(name) || { tiers: emptyTiers(), ts: 0, fetching: false };
  if (entry.fetching) return;
  entry.fetching = true;
  cache.set(name, entry);

  try {
    const results = await Promise.allSettled(seeds.map((s) => datamuse(s, GENRE_TOPICS[name])));
    let any = false;
    const seedSet = new Set(seeds);
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      any = true;
      for (const item of r.value) {
        const word = String(item.word || '').toLowerCase().trim();
        if (!isNoun(item) || !isDrawable(word)) continue;
        if (STOPLIST.has(word) || seedSet.has(word)) continue;
        const f = freqOf(item);
        const tier = classify(word, f);
        // Keep ultra-rare words only in the hard tier.
        if (f < MIN_FREQ && tier !== 'smartpants') continue;
        entry.tiers[tier].add(word);
      }
    }
    if (any) {
      online = true;
      lastError = null;
      for (const tier of Object.keys(entry.tiers)) cap(entry.tiers[tier]);
      entry.ts = Date.now();
    }
  } catch (err) {
    online = false;
    lastError = err.message;
  } finally {
    entry.fetching = false;
    cache.set(name, entry);
  }
}

function genresFor(settings) {
  if (settings.mode === 'random') return GENRE_NAMES;
  return settings.genres && settings.genres.length ? settings.genres : GENRE_NAMES;
}

// Public: warm the cache for the genres in play. Fire-and-forget friendly, but
// awaitable (with the caller's own timeout) so the first turn can be fresh.
export async function prefetchWords(settings) {
  if (!settings || settings.freshWords === false) return;
  const names = genresFor(settings).filter((n) => GENRES[n]);
  const stale = names.filter((n) => {
    const e = cache.get(n);
    return !e || Date.now() - e.ts > CACHE_TTL;
  });
  await Promise.allSettled(stale.map((n) => refreshGenre(n)));
}

// Collect cached dynamic words for the given settings + difficulty.
function dynamicPool(settings) {
  const tiers = tiersForDifficulty(settings.difficulty);
  const names = genresFor(settings);
  const pool = new Set();
  for (const name of names) {
    const entry = cache.get(name);
    if (!entry) continue;
    for (const tier of tiers) {
      for (const w of entry.tiers[tier]) pool.add(w);
    }
  }
  return [...pool];
}

function pick(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// Public: return `count` distinct word choices. Prefers FRESH dynamic words,
// falling back to the static corpus. Also triggers a background refresh so the
// next turn stays fresh. Never blocks on the network.
export function getWordChoices(settings, usedWords, count = 3) {
  // Kick off a background refresh if this genre set is stale (non-blocking).
  if (settings.freshWords !== false) {
    prefetchWords(settings).catch(() => {});
  }

  if (settings.freshWords !== false) {
    const dyn = dynamicPool(settings).filter((w) => !usedWords.has(w));
    if (dyn.length >= count) return pick(dyn, count);
    // Not enough fresh words yet — top up from the static corpus.
    if (dyn.length > 0) {
      const fill = staticChoices(settings, new Set([...usedWords, ...dyn]), count - dyn.length);
      return pick([...dyn, ...fill], count);
    }
  }

  // Offline / disabled / cold cache -> Option A (static corpus).
  return staticChoices(settings, usedWords, count);
}
