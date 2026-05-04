import re
import os
import calamancy
import calamancy.loaders
import requests
import orjson
from functools import lru_cache

# --- CONFIGURATION ---
ENGLISH_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/"
REQUEST_TIMEOUT = 5
MAX_CACHE_SIZE  = 10_000

_STRIP_CHARS = ".,!?"

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def clean(word: str) -> str:
    return word.lower().strip(_STRIP_CHARS)

import spacy

# --- calamancy MODEL LOADING ---
def _load_calamancy_model():
    return spacy.load("tl_calamancy_md")

NLP = _load_calamancy_model()

PROFANITY_LIST: frozenset[str] = frozenset({"gago", "tanga", "puta", "bobo", "tangina", "tarantado"})

# ---------------------------------------------------------------------------
# LIVE LEXICON — populated at startup from slang_seeds.json + discovered_slang.json
# ---------------------------------------------------------------------------
# To add a new word: edit data/slang_seeds.json — no Python changes needed.
#
# is_ambiguous: false → genuine novel coinage (not in any standard dictionary).
#               Immediately classified as slang on step 2 of classify_word.
# is_ambiguous: true  → standard word also used as slang (grabe, solid, etc.).
#               Requires semantic shift + burstiness evidence (Rule B).
# ---------------------------------------------------------------------------

KNOWN_SLANG:         dict[str, str] = {}   # word → short definition
FORMATION_TYPE:      dict[str, str] = {}   # word → formation label
PLAIN_WORD:          dict[str, str] = {}   # word → plain-English gloss
AMBIGUOUS_SLANG_SEEDS: set[str]     = set()
SLANG_ALIASES:       dict[str, str] = {}   # variant spelling → canonical form

# Full metadata (pos, origin, example, …) — served by /lexicon endpoint
SEED_LEXICON: dict[str, dict] = {}


def _merge_entry(word: str, meta: dict, overwrite: bool = False) -> None:
    """Merge one lexicon entry into the live working dicts."""
    if meta.get("definition") and (overwrite or word not in KNOWN_SLANG):
        KNOWN_SLANG[word] = meta["definition"]
    if meta.get("formation_type") and (overwrite or word not in FORMATION_TYPE):
        FORMATION_TYPE[word] = meta["formation_type"]
    if meta.get("plain") and (overwrite or word not in PLAIN_WORD):
        PLAIN_WORD[word] = meta["plain"]
    if meta.get("is_ambiguous", False):
        AMBIGUOUS_SLANG_SEEDS.add(word)
    else:
        # Genuine novel coinages also go into the seed set so _is_standard_cleaned
        # returns False for them (they're not standard words).
        AMBIGUOUS_SLANG_SEEDS.add(word)
    # Alias registration — each alias resolves back to the canonical entry,
    # so char/chariz/chz all share charot's definition + plain translation.
    for alias in meta.get("aliases") or []:
        a = (alias or "").lower().strip()
        if a and a != word and (overwrite or a not in SLANG_ALIASES):
            SLANG_ALIASES[a] = word

    # Bust the lru_cache on _is_standard_cleaned — that function reads
    # AMBIGUOUS_SLANG_SEEDS on entry, but @lru_cache freezes the answer at
    # first call. Without invalidating, words that were checked BEFORE being
    # added here would forever return "standard", which is exactly why
    # repeated import/sweep runs stopped finding new slang. Cheap to clear:
    # the cache rebuilds from word lookups, no network or model calls.
    try:
        _is_standard_cleaned.cache_clear()
    except Exception:
        pass


def resolve_canonical(word: str) -> str | None:
    """Return the canonical slang form for ``word`` — the word itself if it's
    in KNOWN_SLANG, the aliased form if it's a registered variant, else None.

    Falls back to a fuzzy match (rapidfuzz) when no exact / alias hit is
    found, so unregistered variants like 'petmaluu' or 'beshiee' resolve to
    'petmalu' / 'beshie'. The threshold is intentionally tight (≥90 ratio
    with a length difference ≤2) to avoid coupling unrelated short words.
    """
    w = clean(word)
    if w in KNOWN_SLANG:
        return w
    canonical = SLANG_ALIASES.get(w)
    if canonical and canonical in KNOWN_SLANG:
        return canonical
    return _fuzzy_canonical(w)


# Fuzzy variant resolution. Lazy import so a missing rapidfuzz dep doesn't
# break the rest of the service — exact lookup still works without it.
try:
    from rapidfuzz import process as _rf_process, fuzz as _rf_fuzz
    _FUZZY_THRESHOLD = 85
except ImportError:
    _rf_process = None
    _rf_fuzz = None

@lru_cache(maxsize=MAX_CACHE_SIZE)
def _fuzzy_canonical(word: str) -> str | None:
    if _rf_process is None or len(word) < 4 or not KNOWN_SLANG:
        return None
    # Restrict the search space to slang words of similar length to avoid
    # spurious matches and keep the lookup fast even for large lexicons.
    candidates = [k for k in KNOWN_SLANG if abs(len(k) - len(word)) <= 2]
    if not candidates:
        return None
    match = _rf_process.extractOne(word, candidates, scorer=_rf_fuzz.ratio,
                                   score_cutoff=_FUZZY_THRESHOLD)
    return match[0] if match else None


def _load_seed_lexicon() -> None:
    """Load data/slang_seeds.json — the editable source of truth for seed words."""
    path = os.path.join(_BASE_DIR, "data", "slang_seeds.json")
    try:
        with open(path, "rb") as f:
            entries: dict = orjson.loads(f.read())
    except FileNotFoundError:
        print(f"[dictionary_service] slang_seeds.json not found at {path} — starting with empty lexicon.")
        return
    except Exception as e:
        print(f"[dictionary_service] Failed to load slang_seeds.json: {e}")
        return

    for word, meta in entries.items():
        SEED_LEXICON[word] = meta
        _merge_entry(word, meta)


def _load_discovered_slang() -> None:
    """Merge data/discovered_slang.json — auto-populated by slang_enricher.py."""
    path = os.path.join(_BASE_DIR, "data", "discovered_slang.json")
    if not os.path.exists(path):
        return
    try:
        with open(path, "rb") as f:
            entries: dict = orjson.loads(f.read())
    except Exception:
        return
    for word, meta in entries.items():
        _merge_entry(word, meta, overwrite=False)


_load_seed_lexicon()
_load_discovered_slang()


# ---------------------------------------------------------------------------
# MULTI-WORD SLANG LEXICON  (phrases that must be detected as a single unit)
# ---------------------------------------------------------------------------
# To add entries: edit data/multi_word_slang.json
# Format: { "phrase here": { "definition": "...", "plain": "..." } }
# ---------------------------------------------------------------------------

KNOWN_MULTI_WORD_SLANG: dict[str, dict] = {}


def _load_multi_word_slang() -> None:
    path = os.path.join(_BASE_DIR, "data", "multi_word_slang.json")
    if not os.path.exists(path):
        return
    try:
        with open(path, "rb") as f:
            entries: dict = orjson.loads(f.read())
        KNOWN_MULTI_WORD_SLANG.update(entries)
    except Exception as e:
        print(f"[dictionary_service] Failed to load multi_word_slang.json: {e}")


_load_multi_word_slang()


# ---------------------------------------------------------------------------
# BINALIKTAD (SYLLABLE REVERSAL) AUTO-DETECTION
# ---------------------------------------------------------------------------

_SYLLABLE_RE = re.compile(r"[bcdfghjklmnpqrstvwxyz]*[aeiou]+[bcdfghjklmnpqrstvwxyz]*", re.I)

def _split_syllables(word: str) -> list[str]:
    syllables = _SYLLABLE_RE.findall(word)
    return syllables if syllables else [word]

@lru_cache(maxsize=5_000)
def detect_binaliktad(word: str) -> str | None:
    cw = clean(word)
    syllables = _split_syllables(cw)
    if len(syllables) < 2:
        return None
    reversed_word = "".join(reversed(syllables))
    if reversed_word != cw and _is_standard_cleaned(reversed_word):
        return reversed_word
    return None

# ---------------------------------------------------------------------------
# NUMBER-AS-SYLLABLE DETECTION  (su10 → suggestion, gr8 → great, l8r → later)
# ---------------------------------------------------------------------------
# Distinct from Jejemon leet-speak: here the *number itself* sounds like a syllable.
# Pattern: a token that mixes letters and digits (but is not a pure number).
# ---------------------------------------------------------------------------

def has_number_syllable_markers(word: str) -> bool:
    """True for tokens where a number represents a whole syllable sound.

    Conservative — only triggers when the number clearly acts as a syllable,
    not as a simple letter substitute (which is handled by Jejemon detection):

    • Multi-digit sequences next to letters: su10, na100  (10 → '-tion', 100 → '-daan')
    • Digit 8 next to letters: gr8, l8r  (8 sounds like '-ate', '-eight')
    • Digit 2 next to letters: na2, 2gether  (2 sounds like 'to'/'tu' in Filipino)

    Single leet-digits (3=e, 0=o, 4=a, 7=t, 1=i) are left to has_jejemon_markers.
    Pure numbers (67, 100 alone) are a separate category — returns False for those.
    """
    if not word or word.isdigit():
        return False
    if not (any(c.isalpha() for c in word) and any(c.isdigit() for c in word)):
        return False
    # Multi-digit number (2+ consecutive digits) adjacent to letters: su10, mag-s10
    if re.search(r"[a-zA-Z]\d{2,}|\d{2,}[a-zA-Z]", word):
        return True
    # Phonetically unambiguous single digits: 8 (→ 'ate'/'ight') or 2 (→ 'to'/'tu')
    if re.search(r"[a-zA-Z][28]|[28][a-zA-Z]", word):
        return True
    return False


# ---------------------------------------------------------------------------
# JEJEMON / ORTHOGRAPHIC SLANG DETECTION  (leet-speak: 3=e, 0=o, 4=a, 7=t, 1=i)
# ---------------------------------------------------------------------------

_JEJE_NUMBER_SUB = re.compile(r"[30471]")
_JEJE_EXCESS_H   = re.compile(r"h{2,}", re.I)
_JEJE_XZ_SUB     = re.compile(r"(?<![aeiou])[xz](?![aeiou])", re.I)

def has_jejemon_markers(word: str) -> bool:
    # Pure numbers (e.g. 67) are not Jejemon — they are number-slang, checked separately.
    if not word or word.isdigit():
        return False
    return bool(
        _JEJE_NUMBER_SUB.search(word) or
        _JEJE_EXCESS_H.search(word) or
        _JEJE_XZ_SUB.search(word)
    )

# ---------------------------------------------------------------------------
# STANDARD WORD CHECK
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# OFFLINE ENGLISH WORDLIST
# ---------------------------------------------------------------------------
# Replaces dictionaryapi.dev for "is this an English word?" checks. The API
# was unreliable for this purpose: it rate-limits parallel use (poisoning the
# cache with rate-limit failures) and returns 404 for valid common words like
# "their" / "com" because they aren't dictionary headwords. An offline
# wordlist is constant-time, fully reliable, and removes the network entirely.
#
# Source: github.com/dwyl/english-words (public domain, ~370K words, ~4 MB).
# Downloaded once on first use, then served from disk forever.
# ---------------------------------------------------------------------------

_WORDLIST_PATH = os.path.join(_BASE_DIR, "data", "english_words.txt")
_WORDLIST_URL  = "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt"
_english_wordlist: frozenset[str] | None = None

def _load_english_wordlist() -> frozenset[str]:
    global _english_wordlist
    if _english_wordlist is not None:
        return _english_wordlist
    if os.path.exists(_WORDLIST_PATH):
        try:
            with open(_WORDLIST_PATH, encoding="utf-8") as f:
                _english_wordlist = frozenset(
                    line.strip().lower() for line in f if line.strip()
                )
            return _english_wordlist
        except OSError:
            pass
    # First-time fetch — one-off network call, then cached on disk forever.
    try:
        print("[dictionary_service] Downloading English wordlist (one-time, ~4 MB)...")
        resp = requests.get(_WORDLIST_URL, timeout=30)
        resp.raise_for_status()
        text = resp.text
        os.makedirs(os.path.dirname(_WORDLIST_PATH), exist_ok=True)
        with open(_WORDLIST_PATH, "w", encoding="utf-8") as f:
            f.write(text)
        _english_wordlist = frozenset(
            line.strip().lower() for line in text.splitlines() if line.strip()
        )
        print(f"[dictionary_service] Loaded {len(_english_wordlist):,} English words.")
        return _english_wordlist
    except Exception as e:
        print(f"[dictionary_service] Wordlist fetch failed ({e}); slang detection will be less accurate.")
        _english_wordlist = frozenset()
        return _english_wordlist

# Eager-load so the first call doesn't pay the I/O cost mid-pipeline.
_load_english_wordlist()


# ---------------------------------------------------------------------------
# OFFLINE TAGALOG WORDLIST
# ---------------------------------------------------------------------------
# Same pattern as the English wordlist, used to filter out standard Tagalog
# vocabulary (e.g. "gawin", "bata", "sino") from slang-discovery candidates.
# Without it, the LLM gets handed common dictionary words that it correctly
# rejects, wasting API budget on every run.
#
# Source: github.com/AustinZuniga/Filipino-wordlist (~108K unique tokens).
# Important property: includes standard Tagalog and colloquial spellings
# (kase, dyan) but NOT genuine internet slang (lodi, petmalu, beshie, bes,
# char), so it discriminates exactly along the line we care about.
# ---------------------------------------------------------------------------

_TL_WORDLIST_PATH = os.path.join(_BASE_DIR, "data", "tagalog_words.txt")
_TL_WORDLIST_URL  = "https://raw.githubusercontent.com/AustinZuniga/Filipino-wordlist/master/Filipino-wordlist.txt"
_tagalog_wordlist: frozenset[str] | None = None

def _load_tagalog_wordlist() -> frozenset[str]:
    global _tagalog_wordlist
    if _tagalog_wordlist is not None:
        return _tagalog_wordlist

    def _tokenize(text: str) -> frozenset[str]:
        toks: set[str] = set()
        for line in text.splitlines():
            for tok in line.strip().split():
                t = tok.lower()
                if t.isalpha() and len(t) >= 2:
                    toks.add(t)
        return frozenset(toks)

    if os.path.exists(_TL_WORDLIST_PATH):
        try:
            with open(_TL_WORDLIST_PATH, encoding="utf-8") as f:
                _tagalog_wordlist = _tokenize(f.read())
            return _tagalog_wordlist
        except OSError:
            pass

    try:
        print("[dictionary_service] Downloading Tagalog wordlist (one-time, ~2 MB)...")
        resp = requests.get(_TL_WORDLIST_URL, timeout=30)
        resp.raise_for_status()
        text = resp.text
        os.makedirs(os.path.dirname(_TL_WORDLIST_PATH), exist_ok=True)
        with open(_TL_WORDLIST_PATH, "w", encoding="utf-8") as f:
            f.write(text)
        _tagalog_wordlist = _tokenize(text)
        print(f"[dictionary_service] Loaded {len(_tagalog_wordlist):,} Tagalog words.")
        return _tagalog_wordlist
    except Exception as e:
        print(f"[dictionary_service] Tagalog wordlist fetch failed ({e}); slang discovery will surface more dictionary noise.")
        _tagalog_wordlist = frozenset()
        return _tagalog_wordlist

_load_tagalog_wordlist()

@lru_cache(maxsize=MAX_CACHE_SIZE)
def is_tagalog_word(word: str) -> bool:
    """True if ``word`` is a known standard Tagalog dictionary word.
    Genuine internet slang (lodi, petmalu, beshie, etc.) is intentionally
    NOT in the source wordlist, so this returns False for them."""
    return word in _load_tagalog_wordlist()


# ---------------------------------------------------------------------------
# ROBERTA-TAGALOG VOCABULARY SIGNAL
# ---------------------------------------------------------------------------
# jcblaise/roberta-tagalog-base is a transformer trained on modern Tagalog.
# Its tokenizer (only ~5 MB; we don't load the 500 MB model weights) acts as
# a second "is this a known Tagalog word?" check that complements the
# wordlist: words trained into the model's vocab tokenize as a single piece,
# slang/coinages tokenize into multiple subwords. Empirical behaviour:
#   gawin / kase / dyan / kahit  → 1 token  (known Tagalog)
#   lodi / petmalu / beshie / chariz → 2-3 tokens (slang — split)
#   xyz123 / randomgibberish     → 4+ tokens (out of vocab)
#
# Lazy-loaded so import-time stays fast for callers that never touch it.
# ---------------------------------------------------------------------------

_roberta_tokenizer = None
_roberta_load_failed = False

def _load_roberta_tokenizer():
    global _roberta_tokenizer, _roberta_load_failed
    if _roberta_tokenizer is not None or _roberta_load_failed:
        return _roberta_tokenizer
    try:
        from transformers import AutoTokenizer
        _roberta_tokenizer = AutoTokenizer.from_pretrained("jcblaise/roberta-tagalog-base")
    except Exception as e:
        print(f"[dictionary_service] roberta-tagalog tokenizer unavailable ({e}); skipping signal.")
        _roberta_load_failed = True
    return _roberta_tokenizer

@lru_cache(maxsize=MAX_CACHE_SIZE)
def is_in_roberta_vocab(word: str) -> bool:
    """True if ``word`` tokenizes to exactly one piece in roberta-tagalog —
    a strong indicator it was learned as a real Tagalog word during training."""
    tok = _load_roberta_tokenizer()
    if tok is None:
        return False
    try:
        # Leading space triggers roberta's whole-word matching convention.
        return len(tok.tokenize(" " + word)) == 1
    except Exception:
        return False

def is_known_tagalog(word: str) -> bool:
    """Composite Tagalog membership check: wordlist OR roberta-tagalog vocab.
    The wordlist gives broad coverage of the formal lexicon; roberta catches
    modern/colloquial words the wordlist contributors never added. Both are
    O(1) after first call (tokenizer load is one-time, then cached lookups)."""
    return is_tagalog_word(word) or is_in_roberta_vocab(word)

def flush_english_cache() -> None:
    """No-op kept for back-compat — the wordlist replaces the API cache."""
    return

@lru_cache(maxsize=MAX_CACHE_SIZE)
def _check_english_api(word: str) -> bool:
    """Returns True if ``word`` is in the offline English wordlist.

    Name kept for backwards compatibility with existing callers; the
    implementation is now a constant-time set lookup (no network).
    """
    return word in _load_english_wordlist()

@lru_cache(maxsize=MAX_CACHE_SIZE)
def _is_standard_cleaned(clean_word: str) -> bool:
    if clean_word in AMBIGUOUS_SLANG_SEEDS:
        return False
    if not NLP(clean_word)[0].is_oov:
        return True
    # Real Tagalog words (e.g. "kagabi" = "last night") were getting flagged
    # as slang because the standard-word gate only checked English. The Tagalog
    # wordlist + roberta-tagalog vocab give us proper coverage.
    if is_known_tagalog(clean_word):
        return True
    return _check_english_api(clean_word)

def is_standard_word(word: str) -> bool:
    return _is_standard_cleaned(clean(word))

def is_profane(word: str) -> bool:
    return clean(word) in PROFANITY_LIST

def get_formation_type(word: str) -> str:
    cw = clean(word)
    if cw in FORMATION_TYPE:
        return FORMATION_TYPE[cw]
    if has_number_syllable_markers(word):
        return "number_syllable"
    if has_jejemon_markers(word):
        return "jejemon"
    if detect_binaliktad(cw):
        return "binaliktad"
    return "unknown"
