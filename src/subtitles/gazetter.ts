import words_th from '../assets/words_th.txt?raw';

// Normalize Thai strings for reliable comparisons across sources
const normalizeThai = (s: string): string =>
  (s || '')
    .trim()
    .normalize('NFC')
    // strip zero-width and variation selectors often embedded in subtitle payloads
    .replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '');

const normalizedLines = words_th
  .split(/\r?\n/)
  .map((line) => normalizeThai(line))
  .filter((line) => line.length > 0);

// A Set for fast O(1) lookups to check if a string is a known phrase.
export const phraseSet = new Set<string>(normalizedLines);

// An array of the same phrases, sorted by length in descending order.
// This is used to ensure we match the longest possible phrase first.
export const sortedPhrases = Array.from(phraseSet).sort((a, b) => b.length - a.length);