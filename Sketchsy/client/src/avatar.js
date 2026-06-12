// Avatar configuration shared across the customizer and the 3D renderer.
// Colors are generated from HSL hues (no hard-coded hex) so the palette stays
// vivid and dynamic.

export const SKIN_HUES = [28, 35, 18, 12, 280, 200, 140, 320];
export const BODY_HUES = [200, 260, 320, 350, 20, 50, 120, 160];

export const HATS = [
  { id: 'none', label: 'No hat' },
  { id: 'cap', label: 'Cap' },
  { id: 'top', label: 'Top hat' },
  { id: 'crown', label: 'Crown' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'party', label: 'Party hat' },
  { id: 'wizard', label: 'Wizard hat' },
  { id: 'halo', label: 'Halo' },
];

export const ACCESSORIES = [
  { id: 'none', label: 'None' },
  { id: 'glasses', label: 'Glasses' },
  { id: 'shades', label: 'Sunglasses' },
  { id: 'mustache', label: 'Mustache' },
  { id: 'bowtie', label: 'Bow tie' },
  { id: 'monocle', label: 'Monocle' },
  { id: 'earrings', label: 'Earrings' },
];

export const FACE_SHAPES = ['round', 'oval', 'square', 'bean'];

export function hsl(h, s = 70, l = 60) {
  return `hsl(${h} ${s}% ${l}%)`;
}

export function randomAvatar() {
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    skinHue: rnd(SKIN_HUES),
    bodyHue: rnd(BODY_HUES),
    face: rnd(FACE_SHAPES),
    hat: rnd(HATS).id,
    accessory: rnd(ACCESSORIES).id,
    eyeHue: rnd([200, 30, 120, 280, 0]),
  };
}

export const DEFAULT_AVATAR = {
  skinHue: 28,
  bodyHue: 260,
  face: 'round',
  hat: 'none',
  accessory: 'none',
  eyeHue: 220,
};
