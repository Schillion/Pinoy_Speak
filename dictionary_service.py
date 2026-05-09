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


# ---------------------------------------------------------------------------
# Standard Filipino morphological patterns
# ---------------------------------------------------------------------------
# Filipino is an agglutinative language — standard words are heavily affixed.
# Words following these patterns are regular conjugations/derivations, NOT slang:
#
#   naka-    stative/perfective aspect of Actor-Focus verbs
#             nakapunta (went), nakaalis (left), nakakain (ate)
#   nakaka-  experiential aspect (nakakahiya, nakakagigil, nakakatawa)
#   napaka-  superlative intensifier — napakaganda, napakabuti
#   pinaka-  most/superlative — pinakamahusay, pinakamabait
#   maka-    abilitative — makatulog, makarating
#   naipa-   involuntary perfective — naipaliwanag, naipasok
#   nagpa-   causative completed — nagpatulog, nagpaaral
#   nagpaka- intensive causative — nagpakamatay
#   mapag-   agentive adj — mapagmahal, mapagbigay
#
# Minimum root length (4 chars after the prefix) keeps very short combos from
# matching accidental false positives.
_STANDARD_FIL_PREFIX_RE = re.compile(
    r'^(?:'
    r'naka[a-z]{4,}'          # nakapunta, nakaalis, nakakita
    r'|nakaka[a-z]{3,}'       # nakakahiya, nakakagigil
    r'|naipag[a-z]{3,}'       # naipagawa, naipagkaloob
    r'|naipa[a-z]{3,}'        # naipaliwanag, naipasok
    r'|napaka[a-z]{3,}'       # napakaganda, napakabuti
    r'|pinaka[a-z]{3,}'       # pinakamahusay, pinakamagaling
    r'|nagpaka[a-z]{3,}'      # nagpakamatay, nagpakabait
    r'|nagpa[a-z]{3,}'        # nagpatulog, nagpaaral
    r'|mapag[a-z]{3,}'        # mapagmahal, mapagbigay
    r'|makapag[a-z]{3,}'      # makapagsalita, makapag-aral
    r'|maka[a-z]{4,}'         # makatulog, makarating
    r')$'
)

# Hard blocklist — words the ML model repeatedly misclassifies as slang despite
# being standard Filipino. Extend as new false positives are discovered.
_STANDARD_FIL_BLOCKLIST: frozenset[str] = frozenset({
    # ── Particles, conjunctions, discourse markers ───────────────────────────
    "sobrang", "talaga", "talagang", "naman", "pala", "kasi", "lang",
    "din", "rin", "daw", "raw", "nga", "po", "ho", "ba", "na", "pa",
    "muna", "sana", "para", "kung", "pag", "kapag", "dahil", "kahit",
    "hanggang", "habang", "parang", "siguro", "mismo", "lahat",
    "tapos", "bagay", "saka", "agad", "tuloy", "kaya", "pero",
    "nang", "noon", "iyon", "ito", "iyan", "doon", "dito", "diyan",
    "ganoon", "ganito", "ganyan", "basta", "pwede", "hindi", "oo",
    "talaga", "lagi", "palagi", "minsan", "madalas", "bihira",
    "mismo", "halos", "puro", "lahat", "wala", "may", "mayroon",

    # ── Pronouns & pronoun contractions ─────────────────────────────────────
    "sayo", "natin", "namin", "niyo", "niya", "nila", "kami", "tayo",
    "kayo", "sila", "kanila", "kanino", "sino", "akin", "atin",

    # ── Time words ───────────────────────────────────────────────────────────
    "kagabi",    # last night — fundamental time word, NOT slang
    "kanina",    # earlier / a while ago
    "mamaya",    # later
    "maaga",     # early
    "kahapon",   # yesterday
    "bukas",     # tomorrow
    "ngayon",    # now / today
    "kaninang",  # (earlier) inflected
    "hapon",     # afternoon (also: Philippines)
    "umaga",     # morning
    "tanghali",  # noon
    "gabi",      # night
    "hatinggabi", # midnight
    "dati",      # before / previously
    "dating",    # former / previous

    # ── Common adjectives / states (standard, not slang) ────────────────────
    "masaya",    # happy
    "malungkot", # sad
    "galit",     # angry
    "takot",     # afraid / scared
    "pagod",     # tired
    "gutom",     # hungry
    "antok",     # sleepy
    "mahal",     # love / expensive
    "hirap",     # difficulty / struggle
    "mahirap",   # poor / difficult
    "bago",      # new
    "luma",      # old
    "bata",      # young / child
    "matanda",   # old / elder
    "malaki",    # big
    "maliit",    # small
    "matagal",   # long time
    "mabilis",   # fast
    "mabagal",   # slow
    "maganda",   # beautiful
    "pangit",    # ugly
    "mabuti",    # good / fine
    "masama",    # bad / evil
    "magaling",  # skilled / excellent
    "matalino",  # intelligent
    "mabait",    # kind
    "masipag",   # hardworking
    "tamad",     # lazy
    "matapang",  # brave
    "mahiyain",  # shy
    "mataba",    # fat
    "payat",     # thin / skinny
    "matangkad", # tall
    "pandak",    # short (height)
    "mainit",    # hot
    "malamig",   # cold
    "maingay",   # noisy
    "tahimik",   # quiet / calm
    "maliwanag",  # bright / clear
    "madilim",   # dark
    "malinis",   # clean
    "marumi",    # dirty
    "masarap",   # delicious
    "maasim",    # sour
    "mapait",    # bitter
    "matamis",   # sweet
    "maalat",    # salty
    "mabango",   # fragrant
    "mabaho",    # smelly

    # ── Common nouns ─────────────────────────────────────────────────────────
    "kaibigan",  # friend
    "kasama",    # companion / together
    "kapwa",     # fellow person
    "barkada",   # friend group (informal but standard Filipino)
    "kalaban",   # opponent / enemy
    "pera",      # money
    "trabaho",   # work / job
    "oras",      # time / hour
    "linggo",    # week / Sunday
    "buwan",     # month / moon
    "taon",      # year
    "sulat",     # letter / write
    "kwento",    # story
    "problema",  # problem (from Spanish)
    "sagot",     # answer
    "tanong",    # question
    "laro",      # game / play
    "liham",     # letter (formal)
    "pagkain",   # food
    "damit",     # clothes
    "sapatos",   # shoes
    "kotse",     # car
    "jeep",      # jeepney
    "sasakyan",  # vehicle

    # ── Verb roots / infinitives (standard action words) ─────────────────────
    "kain",      # eat
    "inom",      # drink
    "tulog",     # sleep
    "gising",    # wake up / awake
    "lakad",     # walk
    "takbo",     # run
    "luha",      # tears
    "iyak",      # cry
    "tawa",      # laugh
    "kanta",     # sing
    "sayaw",     # dance
    "pag-aaral", # studying
    "trabaho",   # work
    "luto",      # cook
    "laba",      # laundry
    "linis",     # clean
    "bili",      # buy
    "ibig",      # want / love
    "gusto",     # want / like

    # ── Common naka- inflections (handled by prefix regex, but add key ones) ─
    "nakapunta", "nakaalis", "nakakain", "nakatulog", "nakakita",
    "nakabalik", "nakapasok", "nakaupo", "nakatayo", "nakalakad",
    "nakasulat", "nakainom", "nakabasa",

    # ── Filipino interjections / exclamations ────────────────────────────────
    "aray",     # ouch — basic pain/surprise interjection
    "aba",      # oh/well — expression of surprise or contradiction
    "abah",     # variant of aba
    "hoy",      # hey — calling someone's attention
    "nako",     # oh my — expression of surprise/dismay
    "naku",     # variant of nako
    "sus",      # expression of frustration (Susmaryosep contraction)
    "hay",      # sigh — expression of resignation
    "hays",     # variant of hay
    "duh",      # English exclamation used in Filipino text
    "ugh",      # English exclamation used in Filipino text
    "hala",     # watch out / oh no
    "halah",    # variant of hala
    "ambot",    # I don't know (Visayan, used in mixed Filipino text)

    # ── Common location / question contractions ──────────────────────────────
    "asan",     # contraction of nasaan = where is (standard)
    "nasa",     # locative particle = at/in/on (standard)
    "saan",     # where (standard interrogative)
    "kailan",   # when (standard interrogative)
    "bakit",    # why (standard interrogative)
    "paano",    # how (standard interrogative)
    "gaano",    # how much/many (standard)

    # ── Adjectives / states commonly mistaken for slang ─────────────────────
    "atat",     # eager/impatient — standard informal Filipino, NOT slang
    "bored",    # used in Filipino text; English word, not Filipino slang
    "busy",     # same as above
    "cute",     # same
    "sweet",    # same
    "chill",    # same
    "sure",     # same

    # ── Common Filipino nouns (household / nature / places) ─────────────────
    "bahay",    # house
    "kusina",   # kitchen
    "sala",     # living room
    "kwarto",   # room
    "banyo",    # bathroom
    "pinto",    # door
    "bintana",  # window
    "mesa",     # table
    "silya",    # chair
    "higaan",   # bed
    "unan",     # pillow
    "kumot",    # blanket
    "tubig",    # water
    "gatas",    # milk
    "kanin",    # cooked rice
    "ulam",     # viand/main dish
    "tinapay",  # bread
    "isda",     # fish
    "karne",    # meat
    "gulay",    # vegetables
    "prutas",   # fruits
    "asin",     # salt
    "asukal",   # sugar
    "mantika",  # cooking oil
    "ilaw",     # light/lamp
    "kuryente", # electricity
    "tubero",   # plumber (not slang)
    "ulan",     # rain
    "hangin",   # wind
    "araw",     # day/sun
    "bituin",   # star
    "buwan",    # moon (also: month — already in)
    "langit",   # sky/heaven
    "lupa",     # land/ground
    "dagat",    # sea/ocean
    "ilog",     # river
    "bundok",   # mountain
    "kagubatan", # forest
    "bukid",    # farm/field
    "kalye",    # street

    # ── Common Filipino verbs ────────────────────────────────────────────────
    "punta",    # go to (root of pumunta)
    "uwi",      # go home
    "balik",    # return
    "akyat",    # climb
    "baba",     # go down/descend (also: baby — standard noun too)
    "talon",    # jump
    "ligo",     # bathe
    "suot",     # wear
    "kuha",     # get/take
    "bigay",    # give
    "tanggap",  # accept/receive
    "ayos",     # fix/arrange (also used as "okay/fine" — borderline, but standard)
    "luto",     # cook (already in but confirm)
    "basa",     # read/wet
    "sulat",    # write
    "usap",     # talk
    "tingin",   # look
    "mahal",    # love/expensive (already in, but confirm)
    "tawag",    # call
    "hanap",    # look for/search
    "hintay",   # wait
    "alam",     # know
    "kilala",   # recognize/know (person)
    "intindi",  # understand
    "alala",    # remember/worry
    "sama",     # join/come with (also: bad — standard adjective)

    # ── Common Filipino adverbs / intensifiers ───────────────────────────────
    "medyo",    # somewhat/a bit (standard Filipino)
    "masyado",  # too much (standard)
    "sapat",    # enough (standard)
    "halos",    # almost (already in)
    "lalo",     # more/especially
    "lubos",    # fully/completely
    "tunay",    # truly/really
    "talagang", # really (already in)

    # ── Filipino school / work vocabulary ────────────────────────────────────
    "titser",   # teacher (Filipino pronunciation of English "teacher")
    "gradweyt", # graduate (informal but standard Filipino, not slang)
    "klase",    # class
    "exam",     # examination (English word used in Filipino)
    "report",   # English word used in Filipino
    "project",  # English word used in Filipino
    "pasok",    # go in / school day
    "bakasyon", # vacation (from Spanish)

    # ── Filipino relationship / social words ─────────────────────────────────
    "ate",      # older sister / respectful term for older woman
    "kuya",     # older brother / respectful term for older man
    "lola",     # grandmother
    "lolo",     # grandfather
    "tita",     # aunt
    "tito",     # uncle
    "pinsan",   # cousin
    "kapatid",  # sibling
    "asawa",    # spouse
    "anak",     # child (own child)
    "magulang", # parent(s)
    "nanay",    # mother (informal)
    "tatay",    # father (informal)
    "mama",     # mother
    "papa",     # father
})

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
    # Never seed standard/blocklisted words — they should stay standard even if
    # the auto-learn pipeline mistakenly tries to add them.
    if word not in _STANDARD_FIL_BLOCKLIST and not _STANDARD_FIL_PREFIX_RE.match(word):
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

# Hard definition overrides — applied AFTER both JSON files so they always win.
# Use only when a word was auto-learned with a wrong definition and the fix
# can't be pushed via slang_seeds.json (which is gitignored as a runtime file).
_DEFINITION_OVERRIDES: dict[str, dict] = {
    "jebs": {
        "definition": "poop or feces; also used as a surprised/disgusted exclamation meaning 'oh crap!'",
        "formation_type": "jejemon",
        "plain": "poop",
        "pos": "noun",
        "is_ambiguous": False,
    },
    "najebs": {
        "definition": "natatae; to poop or have a poop accident; used for extreme fright or embarrassment",
        "formation_type": "affixation",
        "plain": "pooped / natatae",
        "pos": "verb",
        "is_ambiguous": False,
    },
    "bonak": {
        "definition": "stupid / dumb / idiot — used as a mild friendly insult among close friends",
        "formation_type": "unknown",
        "plain": "idiot",
        "pos": "adjective / noun",
        "is_ambiguous": True,
    },
    "marites": {
        "definition": "nosy gossip queen — someone who loves spreading chismis (rumors) about others; from the viral Filipino meme 'Alam mo na ba? Si Marites...'",
        "formation_type": "coinage",
        "plain": "gossip",
        "pos": "noun",
        "is_ambiguous": False,
    },
    "dogshow": {
        "definition": "shameless showing off / ostentatious display — being a total show-off in front of others",
        "formation_type": "semantic_shift",
        "plain": "show-off",
        "pos": "noun / verb",
        "is_ambiguous": False,
    },
    "budol": {
        "definition": "to be tricked or persuaded into an impulse purchase; also means to scam / deceive someone into buying something they didn't plan to get",
        "formation_type": "semantic_shift",
        "plain": "scammed into buying",
        "pos": "verb / noun",
        "origin": "from 'budol-budol', the classic Filipino distraction scam; evolved in internet culture to mean impulsive or persuaded buying — 'na-budol ako sa TikTok'",
        "example": "Na-budol na naman ako sa Shopee — grabe talaga yung mga 'budol finds' videos!",
        "is_ambiguous": False,
    },
}

for _w, _m in _DEFINITION_OVERRIDES.items():
    _merge_entry(_w, _m, overwrite=True)
    # Also upsert into SEED_LEXICON so /lexicon includes new entries added here
    if _w not in SEED_LEXICON:
        SEED_LEXICON[_w] = _m
    else:
        SEED_LEXICON[_w] = {**SEED_LEXICON[_w], **{k: v for k, v in _m.items() if v is not None}}

# Prune any standard Filipino words that slipped into the lexicon via
# slang_seeds.json or discovered_slang.json. Runs once at startup.
for _w in list(KNOWN_SLANG.keys()):
    if _w in _STANDARD_FIL_BLOCKLIST or _STANDARD_FIL_PREFIX_RE.match(_w):
        KNOWN_SLANG.pop(_w, None)
        FORMATION_TYPE.pop(_w, None)
        PLAIN_WORD.pop(_w, None)
        SEED_LEXICON.pop(_w, None)
        AMBIGUOUS_SLANG_SEEDS.discard(_w)


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
    # Blocklist and prefix regex take priority — even if the word was
    # auto-learned and added to AMBIGUOUS_SLANG_SEEDS, these hard rules win.
    if clean_word in _STANDARD_FIL_BLOCKLIST:
        return True
    if _STANDARD_FIL_PREFIX_RE.match(clean_word):
        return True
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
