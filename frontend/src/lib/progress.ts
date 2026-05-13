const KEY = "pinoyspeak_progress";
const V   = 1;

interface ProgressData {
  v: number;
  flashcard: { knownWords: string[] };
  quiz:      { bestPct: number; attempts: number };
  match:     { totalRounds: number; totalMatches: number };
}

const DEFAULTS: ProgressData = {
  v: V,
  flashcard: { knownWords: [] },
  quiz:      { bestPct: 0, attempts: 0 },
  match:     { totalRounds: 0, totalMatches: 0 },
};

function load(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const p = JSON.parse(raw) as Partial<ProgressData>;
    if (p?.v !== V) return structuredClone(DEFAULTS);
    return {
      v: V,
      flashcard: p.flashcard ?? structuredClone(DEFAULTS.flashcard),
      quiz:      p.quiz      ?? structuredClone(DEFAULTS.quiz),
      match:     p.match     ?? structuredClone(DEFAULTS.match),
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(data: ProgressData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota */ }
}

// ── Flashcard ──────────────────────────────────────────────────────────────
export function getKnownWords(): Set<string> {
  return new Set(load().flashcard.knownWords);
}
export function markWordKnown(word: string) {
  const d = load();
  if (!d.flashcard.knownWords.includes(word)) {
    d.flashcard.knownWords.push(word);
    save(d);
  }
}
export function resetFlashcardProgress() {
  const d = load();
  d.flashcard.knownWords = [];
  save(d);
}

// ── Quiz ───────────────────────────────────────────────────────────────────
export function getQuizProgress() { return load().quiz; }
export function saveQuizResult(pct: number) {
  const d = load();
  d.quiz.bestPct  = Math.max(d.quiz.bestPct, pct);
  d.quiz.attempts += 1;
  save(d);
}

// ── Match ──────────────────────────────────────────────────────────────────
export function getMatchProgress() { return load().match; }
export function saveMatchRound(correctMatches: number) {
  const d = load();
  d.match.totalRounds  += 1;
  d.match.totalMatches += correctMatches;
  save(d);
}
