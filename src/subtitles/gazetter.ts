import words_th from '../assets/words_th.txt?raw';

// A Set for fast O(1) lookups to check if a string is a known phrase.
export const phraseSet = new Set<string>(words_th.split('\n'));

// An array of the same phrases, sorted by length in descending order.
// This is used to ensure we match the longest possible phrase first.
export const sortedPhrases = Array.from(phraseSet).sort((a, b) => b.length - a.length);