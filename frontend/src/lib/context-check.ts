// Immutable grammatical particles that will never become slang — used as
// Filipino context signals when no other lexicon word appears in a post.
export const BASE_FILIPINO_SIGNALS = new Set([
  "ang","ng","sa","na","at","ay","si","ni","ko","mo","ka","kami","kayo","sila",
  "ako","tayo","pero","kasi","lang","yung","ung","din","rin","raw","daw","pala",
  "naman","talaga","sana","ba","ha","eh","sige","oo","hindi","wala","ano",
  "sobrang","parang","kahit","kaya","kuya","ate","tsaka","tol","pare","pre",
]);

// Returns a function that checks whether a post is in a Filipino/Taglish
// context. Uses the live lexicon as the primary signal — any known slang word
// (other than the target itself) is strong evidence. Falls back to the static
// particle list for posts with no other lexicon words.
export function makeContextChecker(lexiconWords: Set<string>, targetWord: string) {
  return function hasFilipinoCOntext(text: string): boolean {
    const tokens = text.toLowerCase().match(/[a-z'-]{2,}/g) ?? [];
    return tokens.some(
      (t) => t !== targetWord && (BASE_FILIPINO_SIGNALS.has(t) || lexiconWords.has(t))
    );
  };
}
