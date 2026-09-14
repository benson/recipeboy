const TONES = ['red', 'green', 'blue', 'yellow'];

// Keep a recipe's palette stable across filtering, sorting, and direct links.
export function recipeTone(id) {
  let hash = 0;
  for (const character of String(id)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}
