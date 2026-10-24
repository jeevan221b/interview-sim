// Speech metrics computed from the transcript alone, shared by the server (stored
// with each answer) and the web app (live stats while you speak).

export const FILLER_PHRASES = [
  'you know',
  'i mean',
  'kind of',
  'sort of',
  'basically',
  'actually',
  'literally',
  'honestly',
  'like',
  'um',
  'umm',
  'uh',
  'uhh',
  'er',
  'hmm',
  'so yeah',
];

// Longest phrases first so "you know" is matched before anything shorter inside it.
const fillerPattern = new RegExp(
  `\\b(${[...FILLER_PHRASES].sort((a, b) => b.length - a.length).map((p) => p.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

export function countWords(text) {
  const words = (text || '').trim().match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}

/** @returns {{ total: number, byWord: Record<string, number> }} */
export function findFillers(text) {
  const byWord = {};
  let total = 0;
  for (const match of (text || '').matchAll(fillerPattern)) {
    const word = match[1].toLowerCase().replace(/\s+/g, ' ');
    byWord[word] = (byWord[word] || 0) + 1;
    total += 1;
  }
  return { total, byWord };
}

/** Splits text into segments flagged as filler or not, for highlighting in the UI. */
export function splitFillers(text) {
  const parts = [];
  let last = 0;
  for (const match of (text || '').matchAll(fillerPattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), filler: false });
    parts.push({ text: match[0], filler: true });
    last = match.index + match[0].length;
  }
  if (last < (text || '').length) parts.push({ text: text.slice(last), filler: false });
  return parts;
}

/**
 * @param {string} transcript
 * @param {number} durationSec  seconds actually spent speaking/recording
 * @param {number} pauseCount   silences longer than ~2.5s detected while recording
 */
export function computeMetrics(transcript, durationSec = 0, pauseCount = 0) {
  const wordCount = countWords(transcript);
  const fillers = findFillers(transcript);
  const minutes = durationSec / 60;
  const wpm = minutes > 0.05 ? Math.round(wordCount / minutes) : 0;
  const fillerRate = wordCount > 0 ? +((fillers.total / wordCount) * 100).toFixed(1) : 0;
  return {
    wordCount,
    durationSec: Math.round(durationSec),
    wpm,
    fillerCount: fillers.total,
    fillerRate,
    fillers: fillers.byWord,
    pauseCount,
    delivery: deliveryScore({ wordCount, wpm, fillerRate, pauseCount, durationSec }),
  };
}

/** 0–10 score for how the answer was delivered (pace, fillers, pauses, length). */
export function deliveryScore({ wordCount, wpm, fillerRate, pauseCount, durationSec }) {
  if (!wordCount) return 0;
  let score = 10;
  // Comfortable interview pace is roughly 120–160 wpm; typed answers have no pace.
  if (wpm > 0) {
    if (wpm < 90) score -= Math.min(3, (90 - wpm) / 15);
    else if (wpm < 120) score -= (120 - wpm) / 30;
    else if (wpm > 190) score -= Math.min(3, (wpm - 190) / 15);
    else if (wpm > 160) score -= (wpm - 160) / 30;
  }
  score -= Math.min(4, fillerRate * 0.6);
  const minutes = Math.max(durationSec / 60, 0.5);
  score -= Math.min(2, Math.max(0, pauseCount / minutes - 2) * 0.5);
  if (wordCount < 25) score -= 2;
  return Math.max(0, Math.min(10, +score.toFixed(1)));
}
