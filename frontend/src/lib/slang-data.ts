export type FormationType =
  | "binaliktad"
  | "contraction"
  | "phonetic"
  | "affixation"
  | "clipping"
  | "blending"
  | "coinage"
  | "native"
  | "semantic_shift"
  | "borrowing"
  | "jejemon"
  | "number_syllable"
  | "multi_word"
  | "unknown";

export const FORMATION_LABELS: Record<FormationType, string> = {
  binaliktad:      "Binaliktad — syllable reversal",
  contraction:     "Contraction — phrase compressed into one word",
  phonetic:        "Phonetic respelling",
  affixation:      "Affixation — foreign root + Filipino suffix",
  clipping:        "Clipping — truncated from a longer word",
  blending:        "Blending — two words fused",
  coinage:         "Coinage — invented internet expression",
  native:          "Native Filipino — no English equivalent",
  semantic_shift:  "Same word, new meaning — a common word used differently online",
  borrowing:       "Borrowing — adopted from another language",
  jejemon:         "Jejemon — leet-speak letter substitution",
  number_syllable: "Number-as-syllable — digits replace syllable sounds (su10, gr8)",
  multi_word:      "Multi-word slang — phrase detected as a single unit",
  unknown:         "Formation unknown",
};
