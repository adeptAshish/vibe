// Sketchsy word bank.
// Difficulty tiers:
//   giowa     -> easy   (short, very common, concrete words)
//   fun       -> medium (everyday but a little trickier)
//   smartpants-> hard   (abstract / obscure / multi-word)
//
// Each genre exposes the three tiers. "random" pulls from every genre.

export const DIFFICULTIES = [
  { id: 'giowa', label: 'Giowa', sub: 'Easy', emoji: '🍼' },
  { id: 'fun', label: 'Fun', sub: 'Medium', emoji: '🎉' },
  { id: 'smartpants', label: 'Smartpants', sub: 'Hard', emoji: '🧠' },
];

export const GENRES = {
  Animals: {
    emoji: '🐾',
    giowa: ['cat', 'dog', 'fish', 'cow', 'pig', 'bird', 'frog', 'duck', 'bee', 'ant', 'owl', 'bat', 'fox', 'goat'],
    fun: ['elephant', 'giraffe', 'penguin', 'octopus', 'kangaroo', 'dolphin', 'squirrel', 'hedgehog', 'flamingo', 'raccoon', 'panda', 'zebra'],
    smartpants: ['platypus', 'chameleon', 'narwhal', 'axolotl', 'pangolin', 'wildebeest', 'cuttlefish', 'praying mantis', 'komodo dragon', 'mandrill'],
  },
  Food: {
    emoji: '🍔',
    giowa: ['pizza', 'apple', 'egg', 'cake', 'milk', 'bread', 'rice', 'soup', 'taco', 'fries', 'jam', 'pie'],
    fun: ['hamburger', 'spaghetti', 'pancake', 'popcorn', 'cupcake', 'sandwich', 'sushi', 'donut', 'pretzel', 'waffle', 'burrito'],
    smartpants: ['ratatouille', 'bruschetta', 'tiramisu', 'gazpacho', 'croissant', 'quesadilla', 'meringue', 'gnocchi', 'baklava', 'soufflé'],
  },
  Movies: {
    emoji: '🎬',
    giowa: ['cars', 'up', 'shrek', 'frozen', 'jaws', 'bambi', 'dumbo', 'rio', 'brave'],
    fun: ['titanic', 'avatar', 'gladiator', 'inception', 'jumanji', 'aladdin', 'zootopia', 'moana', 'tangled'],
    smartpants: ['interstellar', 'reservoir dogs', 'pulp fiction', 'the godfather', 'blade runner', 'pan\'s labyrinth', 'whiplash', 'parasite'],
  },
  Sports: {
    emoji: '⚽',
    giowa: ['ball', 'goal', 'run', 'swim', 'jump', 'golf', 'box', 'ski', 'bat'],
    fun: ['football', 'tennis', 'cricket', 'hockey', 'cycling', 'surfing', 'archery', 'bowling', 'skating', 'rowing'],
    smartpants: ['decathlon', 'curling', 'fencing', 'badminton', 'water polo', 'pole vault', 'triathlon', 'lacrosse', 'parkour'],
  },
  Objects: {
    emoji: '🪑',
    giowa: ['cup', 'key', 'pen', 'book', 'chair', 'lamp', 'door', 'shoe', 'hat', 'fork', 'clock'],
    fun: ['umbrella', 'backpack', 'scissors', 'telescope', 'keyboard', 'guitar', 'camera', 'ladder', 'compass', 'anchor'],
    smartpants: ['metronome', 'chandelier', 'kaleidoscope', 'typewriter', 'sextant', 'gramophone', 'harmonica', 'abacus', 'periscope'],
  },
  Nature: {
    emoji: '🌿',
    giowa: ['tree', 'sun', 'moon', 'star', 'rain', 'leaf', 'rock', 'hill', 'lake', 'fire', 'snow'],
    fun: ['volcano', 'rainbow', 'waterfall', 'glacier', 'tornado', 'desert', 'island', 'canyon', 'meadow', 'aurora'],
    smartpants: ['stalactite', 'photosynthesis', 'archipelago', 'peninsula', 'tundra', 'estuary', 'geyser', 'fjord', 'savanna'],
  },
  Tech: {
    emoji: '💻',
    giowa: ['phone', 'mouse', 'plug', 'wifi', 'chip', 'cable', 'app', 'robot', 'drone'],
    fun: ['laptop', 'satellite', 'headphones', 'joystick', 'router', 'printer', 'speaker', 'antenna', 'monitor'],
    smartpants: ['algorithm', 'blockchain', 'semiconductor', 'hologram', 'gyroscope', 'quantum bit', 'firmware', 'transistor'],
  },
  Fantasy: {
    emoji: '🐉',
    giowa: ['wand', 'crown', 'sword', 'witch', 'troll', 'fairy', 'ghost', 'genie', 'cape'],
    fun: ['dragon', 'wizard', 'unicorn', 'mermaid', 'griffin', 'goblin', 'phoenix', 'centaur', 'minotaur'],
    smartpants: ['necromancer', 'leviathan', 'basilisk', 'doppelganger', 'manticore', 'cockatrice', 'sorceress', 'gargoyle'],
  },
};

export const GENRE_NAMES = Object.keys(GENRES);

// Custom lists are added at runtime per-room: { name, words: { giowa:[], fun:[], smartpants:[] } }
// If a custom list only has a flat array, treat it as all difficulties.

function pick(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function tiersForDifficulty(difficulty) {
  // Include current tier plus easier ones for variety, weighted toward the chosen tier.
  if (difficulty === 'giowa') return ['giowa'];
  if (difficulty === 'fun') return ['fun', 'giowa'];
  return ['smartpants', 'fun'];
}

// Build a flat pool of candidate words given room settings.
export function buildWordPool({ mode, genres, difficulty, customLists }) {
  const tiers = tiersForDifficulty(difficulty);
  const pool = new Set();

  const addFromGenreObj = (genreObj) => {
    for (const tier of tiers) {
      const words = genreObj[tier];
      if (Array.isArray(words)) words.forEach((w) => pool.add(w));
    }
  };

  if (mode === 'random') {
    for (const name of GENRE_NAMES) addFromGenreObj(GENRES[name]);
  } else {
    const selected = genres && genres.length ? genres : GENRE_NAMES;
    for (const name of selected) {
      if (GENRES[name]) addFromGenreObj(GENRES[name]);
    }
  }

  // Always mix in any custom lists the room created.
  if (Array.isArray(customLists)) {
    for (const list of customLists) {
      if (!list || !list.words) continue;
      if (Array.isArray(list.words)) {
        list.words.forEach((w) => pool.add(String(w).trim()));
      } else {
        for (const tier of tiers) {
          const words = list.words[tier];
          if (Array.isArray(words)) words.forEach((w) => pool.add(String(w).trim()));
        }
      }
    }
  }

  return [...pool].filter(Boolean);
}

// Return `count` distinct word choices, avoiding already-used words when possible.
export function getWordChoices(settings, usedWords, count = 3) {
  let pool = buildWordPool(settings);
  const fresh = pool.filter((w) => !usedWords.has(w));
  pool = fresh.length >= count ? fresh : pool;
  if (pool.length === 0) pool = ['mystery', 'doodle', 'sketch'];
  return pick(pool, Math.min(count, pool.length));
}
