import re
import pandas as pd
from functools import lru_cache
from gensim.models import FastText
import os
from rich.console import Console

_WORD_RE = re.compile(r"\b\w+\b")

from dictionary_service import (
    is_standard_word, is_profane, NLP,
    AMBIGUOUS_SLANG_SEEDS, KNOWN_SLANG,
    detect_binaliktad, has_number_syllable_markers, has_jejemon_markers,
    get_formation_type, clean, KNOWN_MULTI_WORD_SLANG,
    resolve_canonical,
)

console = Console()

# --- Detection thresholds (tune these without touching logic) ---
BURSTINESS_NOVEL_THRESHOLD  = 2.0  # Z-score: novel word must exceed this to be slang
BURSTINESS_SHIFT_THRESHOLD  = 1.8  # Z-score: known word must exceed this when meaning-shifted
SEMANTIC_SHIFT_THRESHOLD    = 0.4  # Fraction of non-standard neighbors that signals a shift
MIN_HISTORY_DAYS            = 3    # Min days of data needed for a meaningful Z-score
SEMANTIC_NEIGHBORS          = 10   # How many nearest neighbors to inspect for semantic shift


class SlangDetector:
    """
    Core slang detection logic combining novelty, temporal burstiness,
    and semantic shift analysis.
    """

    def __init__(self,
                 model_path: str = "data/social_model.model",
                 data_path: str = "data/corpus.db"):
        console.print("[bold blue]Initializing Slang Detector...[/bold blue]")
        self._data_path    = data_path
        self.model         = self._load_model(model_path)
        self._freq_map_cache: pd.DataFrame | None = None

    # ------------------------------------------------------------------
    # Initialisation helpers
    # ------------------------------------------------------------------

    @property
    def word_freq_map(self) -> pd.DataFrame:
        if self._freq_map_cache is None:
            self._freq_map_cache = self._build_frequency_map(self._data_path)
        return self._freq_map_cache

    @word_freq_map.setter
    def word_freq_map(self, value: pd.DataFrame | None) -> None:
        self._freq_map_cache = value

    def _load_model(self, model_path: str):
        if os.path.exists(model_path):
            console.print(f"Loading model from [cyan]{model_path}[/cyan]")
            try:
                return FastText.load(model_path, mmap='r')
            except Exception as e:
                console.print(f"[red]Failed to load model: {e}[/red]")
                return None
        console.print(f"[red]Model not found at {model_path}. Run automate.py first.[/red]")
        return None

    def _build_frequency_map(self, data_path: str) -> pd.DataFrame:
        """
        Builds a date × slang-word frequency matrix for the last 90 days.
        Only tracks words in the slang lexicon to keep memory bounded.
        """
        if not os.path.exists(data_path):
            return pd.DataFrame()

        try:
            import sqlite3
            from dictionary_service import SEED_LEXICON
            from datetime import date, timedelta

            cutoff = (date.today() - timedelta(days=90)).isoformat()
            conn = sqlite3.connect(data_path)
            df = pd.read_sql(
                "SELECT text, date FROM posts WHERE date >= ?",
                conn, params=(cutoff,)
            )
            conn.close()

            if df.empty:
                return pd.DataFrame()

            # Only pivot slang words (~200-300 cols) — not entire 50k+ vocab
            slang_words = frozenset(w.lower() for w in SEED_LEXICON)
            df['date']  = pd.to_datetime(df['date']).dt.date
            df['words'] = df['text'].str.lower().str.findall(_WORD_RE)

            exploded = df.explode('words')
            exploded = exploded[exploded['words'].isin(slang_words)]
            if exploded.empty:
                return pd.DataFrame()

            word_counts = (
                exploded
                  .groupby(['date', 'words'])
                  .size()
                  .reset_index(name='counts')
            )
            freq_map = word_counts.pivot_table(
                index='date', columns='words', values='counts', fill_value=0
            )
            console.print(
                f"[green]Frequency map: {len(freq_map)} days × "
                f"{len(freq_map.columns)} slang words.[/green]"
            )
            return freq_map
        except Exception as e:
            console.print(f"[red]Error building frequency map: {e}[/red]")
            return pd.DataFrame()

    # ------------------------------------------------------------------
    # Signal calculators
    # ------------------------------------------------------------------

    def _word_corpus_count(self, word: str) -> int:
        """Total occurrences of ``word`` across the whole corpus."""
        clean_word = clean(word)
        if self.word_freq_map.empty or clean_word not in self.word_freq_map.columns:
            return 0
        return int(self.word_freq_map[clean_word].sum())

    def _word_days_present(self, word: str) -> int:
        """Number of distinct days on which ``word`` appears in the corpus."""
        clean_word = clean(word)
        if self.word_freq_map.empty or clean_word not in self.word_freq_map.columns:
            return 0
        return int((self.word_freq_map[clean_word] > 0).sum())

    def is_likely_standard(self, word: str) -> bool:
        """
        Corpus-aware "is this a standard word" check.

        calamanCy's ``is_oov`` signal turned out to be useless — it returns
        False for real words, slang, AND pure gibberish alike. So we use the
        most reliable signal we have: our own corpus. A word seen consistently
        across many months is almost certainly a real Tagalog word we don't
        have a dictionary for. For code-switched tokens we fall back to the
        English dictionary API (lru-cached, may also fail closed on network).
        """
        from dictionary_service import (
            AMBIGUOUS_SLANG_SEEDS, _check_english_api,
            _STANDARD_FIL_BLOCKLIST, _STANDARD_FIL_PREFIX_RE,
            is_known_tagalog,
        )
        clean_word = clean(word)
        # Blocklist/prefix take priority over AMBIGUOUS_SLANG_SEEDS — a word
        # that was mistakenly auto-learned must not override these hard rules.
        if clean_word in _STANDARD_FIL_BLOCKLIST:
            return True
        if _STANDARD_FIL_PREFIX_RE.match(clean_word):
            return True
        if clean_word in AMBIGUOUS_SLANG_SEEDS:
            return False
        # Stable, widely-seen word in our own corpus → almost certainly a real
        # word we just don't have a dictionary for. Threshold deliberately
        # leaves a wide grey zone (≈100–300 count, ≈30–50 days) for the LLM
        # to adjudicate during enrichment; we'd rather over-send candidates
        # than silently filter out real slang.
        if (self._word_corpus_count(clean_word) >= 300
                and self._word_days_present(clean_word) >= 50):
            return True
        if is_known_tagalog(clean_word):
            return True
        return _check_english_api(clean_word)

    def get_burstiness(self, word: str) -> float:
        """
        Z-score of the word's frequency on the most recent day vs its
        historical average.  High Z → sudden spike in usage.
        """
        clean_word = clean(word)
        if self.word_freq_map.empty or clean_word not in self.word_freq_map.columns:
            return 0.0

        series = self.word_freq_map[clean_word]
        if len(series) < MIN_HISTORY_DAYS:
            return 0.0

        history  = series.iloc[:-1]
        mean_freq = history.mean()
        std_freq  = history.std()

        if pd.isna(std_freq) or std_freq == 0:
            return 5.0 if series.iloc[-1] > mean_freq else 0.0

        z = (series.iloc[-1] - mean_freq) / std_freq
        return float(z) if not pd.isna(z) else 0.0

    def get_semantic_shift(self, word: str, _neighbors: list | None = None) -> float:
        """
        Measures semantic shift as the fraction of the word's nearest
        neighbors (in the social-media FastText model) that are NOT
        standard Tagalog/English words.

        Returns a value in [0.0, 1.0]:
          0.0 → all neighbors are standard words (stable meaning)
          1.0 → all neighbors are non-standard (fully shifted meaning)

        Falls back to 0.0 (no shift) when the model is unavailable or
        the word is out-of-vocabulary.

        Pass pre-fetched ``_neighbors`` to avoid a second most_similar call.
        """
        clean_word = clean(word)

        if self.model is None or clean_word not in self.model.wv:
            return 0.0

        if _neighbors is None:
            try:
                _neighbors = self.model.wv.most_similar(clean_word, topn=SEMANTIC_NEIGHBORS)
            except Exception:
                return 0.0

        if not _neighbors:
            return 0.0

        # Batch all neighbors through calamanCy in one pass (faster than 10 individual calls)
        check = _neighbors[:SEMANTIC_NEIGHBORS]
        neighbor_words = [w for w, _ in check]
        non_standard = sum(doc[0].is_oov for doc in NLP.pipe(neighbor_words))
        return non_standard / len(check)

    # ------------------------------------------------------------------
    # Multi-word slang scanner
    # ------------------------------------------------------------------

    @staticmethod
    def find_multi_word_slang(tokens: list[str]) -> list[tuple[int, int, str]]:
        """
        Greedy left-to-right scan for known multi-word slang phrases.

        Tries trigrams before bigrams so longer matches take priority.
        Returns a list of (start_idx, end_idx, phrase) tuples where
        tokens[start_idx:end_idx] form the matched phrase.
        """
        matches: list[tuple[int, int, str]] = []
        i = 0
        while i < len(tokens):
            found = False
            for size in (3, 2):
                end = i + size
                if end <= len(tokens):
                    phrase = " ".join(tokens[i:end])
                    if phrase in KNOWN_MULTI_WORD_SLANG:
                        matches.append((i, end, phrase))
                        i = end
                        found = True
                        break
            if not found:
                i += 1
        return matches

    # ------------------------------------------------------------------
    # Main classifier
    # ------------------------------------------------------------------

    @lru_cache(maxsize=10000)
    def classify_word(self, word: str, _neighbors: tuple | None = None) -> tuple[str, str]:
        """
        Combines all signals to classify a word as:
          'profane'  — on the profanity list
          'slang'    — novel/shifted + trending
          'unknown'  — novel but not trending (could be typo / rare proper noun)
          'standard' — in standard dictionaries with stable meaning

        Pass pre-fetched ``_neighbors`` (from model.wv.most_similar) to avoid
        a redundant most_similar call inside get_semantic_shift.
        """
        if self.model is None:
            return "unknown", "Model not loaded — run automate.py to train."

        clean_word = clean(word)

        # 0. Hard blocklist / morphological prefix — wins over everything including
        # the lexicon. Prevents auto-learned standard words (sobrang, kagabi, etc.)
        # from being returned as slang even if they ended up in KNOWN_SLANG.
        from dictionary_service import _STANDARD_FIL_BLOCKLIST, _STANDARD_FIL_PREFIX_RE
        if clean_word in _STANDARD_FIL_BLOCKLIST or _STANDARD_FIL_PREFIX_RE.match(clean_word):
            return "standard", "Standard Filipino word — not slang."

        # 1. Profanity check first (ethical gate)
        if is_profane(clean_word):
            return "profane", "Word is on the profanity list."

        # 2. Known slang lexicon — immediate match (genuinely non-standard coinages).
        # Also catches registered variant spellings via resolve_canonical, so
        # char/chariz/chz resolve back to charot's entry.
        canonical = resolve_canonical(clean_word)
        if canonical:
            formation = get_formation_type(canonical)
            definition = KNOWN_SLANG[canonical]
            if canonical == clean_word:
                return "slang", f"Known Filipino slang [{formation}]: {definition}"
            return "slang", f"Variant of '{canonical}' [{formation}]: {definition}"

        # 3. Binaliktad auto-detection — reversed syllables of a known word.
        # detect_binaliktad relies on calamanCy's OOV check, which is loose —
        # it happily accepts gibberish like "angsobr" (reversal of "sobrang")
        # as a "standard" source. Corpus-validate: require the reversed form
        # to actually appear in our collected posts before trusting the match.
        source_word = detect_binaliktad(clean_word)
        if source_word and self._word_corpus_count(source_word) >= 20:
            return "slang", f"Binaliktad (syllable reversal) of '{source_word}' — a Filipino wordplay coinage."

        # 4a. Number-as-syllable Filipino typing (su10, gr8, l8r) — checked first
        #     because these tokens also contain digits that would match the Jejemon check.
        if has_number_syllable_markers(word):
            return "slang", "Number-as-syllable Filipino typing (e.g. 'su10' → 'suggestion', 'gr8' → 'great', 'l8r' → 'later')."

        # 4b. Jejemon / leet-speak markers (3=e, 0=o, 4=a, 7=t, 1=i; x/z subs; excess H)
        if has_jejemon_markers(word):
            return "slang", "Contains Jejemon / orthographic slang markers (number-as-letter, x/z substitution, or excess H)."

        # 5. Lexical novelty — not in any standard dictionary.
        # Ambiguous seeds are *known* words (standard + slang usage) — not novel coinages.
        # Treating them as novel would let Rule A fire on burstiness alone, bypassing the
        # semantic-shift check that is the correct gate for these words.
        is_ambiguous = clean_word in AMBIGUOUS_SLANG_SEEDS
        is_novel     = not self.is_likely_standard(clean_word) and not is_ambiguous

        # 6. Burstiness — cheap pandas lookup
        burstiness = self.get_burstiness(clean_word)

        # Words in the ambiguous seed list get a 30 % lower detection threshold
        # so they aren't dismissed as purely standard when used as slang.
        burst_threshold = BURSTINESS_SHIFT_THRESHOLD * 0.7 if is_ambiguous else BURSTINESS_SHIFT_THRESHOLD

        # Rule A: Novel + trending → slang (skip expensive semantic check)
        if is_novel and burstiness > BURSTINESS_NOVEL_THRESHOLD:
            return "slang", f"Novel word (not in any dictionary) with high trend score (Z={burstiness:.2f})."

        # 7. Semantic shift — only when it can affect outcome
        shift_threshold = SEMANTIC_SHIFT_THRESHOLD * 0.7 if is_ambiguous else SEMANTIC_SHIFT_THRESHOLD
        semantic_shift  = self.get_semantic_shift(clean_word, _neighbors=_neighbors)

        # Rule B: Known ambiguous word (listed in slang seeds) whose meaning
        # has shifted + is trending → slang. We deliberately don't fire this
        # for arbitrary standard words: FastText's nearest neighbors are often
        # orthographic variants (subword embeddings), which makes the "semantic
        # shift" heuristic unreliable for common Tagalog words. Genuine new
        # slang use of a standard word is picked up by the slang_enricher
        # pipeline and added to AMBIGUOUS_SLANG_SEEDS before reaching here.
        if (is_ambiguous and not is_novel
                and semantic_shift > shift_threshold
                and burstiness > burst_threshold):
            return "slang", (
                f"Known ambiguous English-Filipino word with significant semantic shift "
                f"({semantic_shift:.0%} non-standard neighbors) "
                f"and high trend (Z={burstiness:.2f})."
            )

        # Rule C: Novel but not trending → likely a typo, rare name, or niche term
        if is_novel:
            return "unknown", "Not in standard dictionaries, but not currently trending — may be a typo or niche term."

        # Default: standard word used normally
        return "standard", "Found in standard dictionaries with stable meaning and no significant semantic shift."
