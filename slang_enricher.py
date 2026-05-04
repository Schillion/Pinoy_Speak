"""
Slang lexicon enricher — auto-discovers and defines new Filipino internet slang
from the live corpus using free LLM providers (no paid API required).

Provider priority (first available key wins):
  1. Google Gemini  — free tier, 500 req/day; reads GEMINI_API_KEY from env
                      or frontend/.env.local automatically (already configured)
  2. Groq           — free tier, 14 400 req/day (Llama 3.1 8B); GROQ_API_KEY
  3. Ollama         — completely free, runs locally; no key needed

Flow:
  find_slang_candidates() → enrich_candidates() → analyse_word()
  → saves to data/discovered_slang.json
  → _merge_into_lexicon() updates live dicts without restart
"""
from __future__ import annotations

import json, os, re
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

import orjson  # ~3-5x faster than stdlib json for the discovered/suspect files

if TYPE_CHECKING:
    from slang_detector import SlangDetector

# Anchor paths to the project root, not the current working directory —
# otherwise `uvicorn` started from a different folder writes to the wrong
# place (or fails outright). __file__ is slang_enricher.py at project root.
_PROJECT_ROOT   = Path(__file__).resolve().parent
DISCOVERED_PATH = _PROJECT_ROOT / "data" / "discovered_slang.json"
SUSPECT_PATH    = _PROJECT_ROOT / "data" / "suspect_slang.json"

# Entries flagged as likely false positives during post-insertion audit.
# Heuristics below are tuned for a hobby-scale corpus; adjust if your ratios differ.
SUSPECT_FREQUENCY_THRESHOLD = 500   # total corpus occurrences
SUSPECT_DAY_SPREAD          = 50    # appears on this many distinct days

_VALID_FORMATIONS = {
    "binaliktad", "contraction", "phonetic", "affixation",
    "clipping", "blending", "coinage", "native",
    "semantic_shift", "borrowing", "jejemon", "unknown",
}

# ── Auto-load GEMINI_API_KEY from frontend/.env.local ────────────────────────
# The key is already configured for the Next.js chatbot; reuse it here so the
# Python backend works without any extra setup.

def _maybe_load_gemini_key() -> None:
    if os.environ.get("GEMINI_API_KEY"):
        return
    env_path = Path(__file__).parent / "frontend" / ".env.local"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip()
                if key and not key.startswith("your_"):
                    os.environ["GEMINI_API_KEY"] = key
                    break
    except Exception:
        pass

_maybe_load_gemini_key()


# ── LLM provider calls (all via requests — no new dependencies) ──────────────

import requests as _requests

_PROMPT_TEMPLATE = (
    'You are an expert in Filipino internet slang and Tagalog linguistics.\n\n'
    'Word: "{word}"\n\n'
    'Real sentences from Filipino social media:\n{sample}\n\n'
    'Reply with ONLY a JSON object (no markdown fences). Keys:\n'
    '  "is_slang": bool\n'
    '  "definition": string|null  (concise English, 1-2 sentences)\n'
    '  "plain": string|null       (simplest English equivalent, 1-3 words)\n'
    '  "formation_type": binaliktad|contraction|phonetic|affixation|clipping'
    '|blending|coinage|native|semantic_shift|borrowing|jejemon|unknown\n'
    '  "origin": string|null      (brief etymology, 1 sentence)\n\n'
    'Only is_slang=true for distinctly Filipino internet terms.\n'
    'Examples of SLANG: "lodi", "petmalu", "charot", "yarn", "ferson", "eme".\n'
    'Examples of NOT SLANG: "sino", "bakit", "laptop", "building", "kasi", "dyan".\n'
    'Standard English or Tagalog dictionary words are NOT slang.'
)


def _build_prompt(word: str, sentences: list[str]) -> str:
    sample = "\n".join(f"  • {s}" for s in sentences[:5])
    return _PROMPT_TEMPLATE.format(word=word, sample=sample)


def _call_gemini(prompt: str) -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("No GEMINI_API_KEY")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={key}"
    )
    res = _requests.post(
        url,
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 300, "temperature": 0.1},
        },
        timeout=20,
    )
    res.raise_for_status()
    return res.json()["candidates"][0]["content"]["parts"][0]["text"]


def _call_groq(prompt: str) -> str:
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        raise ValueError("No GROQ_API_KEY")
    res = _requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.1-8b-instant",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 300,
            "temperature": 0.1,
        },
        timeout=20,
    )
    res.raise_for_status()
    return res.json()["choices"][0]["message"]["content"]


def _call_ollama(prompt: str) -> str:
    """Calls a local Ollama instance — completely free, no key needed."""
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    res = _requests.post(
        "http://localhost:11434/api/chat",
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        },
        timeout=60,
    )
    res.raise_for_status()
    return res.json()["message"]["content"]


def _call_llm(prompt: str) -> str:
    """Tries each free provider in order until one succeeds."""
    for fn in (_call_gemini, _call_groq, _call_ollama):
        try:
            return fn(prompt)
        except Exception:
            continue
    raise RuntimeError("No LLM provider available")


def _parse_response(raw: str) -> dict | None:
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract a JSON object even if there's surrounding text
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return None
        result = json.loads(m.group())

    if not result.get("is_slang"):
        return None

    ft = result.get("formation_type", "unknown")
    if ft not in _VALID_FORMATIONS:
        ft = "unknown"

    return {
        "definition":     result.get("definition") or "",
        "plain":          result.get("plain") or "",
        "formation_type": ft,
        "origin":         result.get("origin") or "",
    }


# ── Persistence ──────────────────────────────────────────────────────────────

def load_discovered() -> dict[str, dict]:
    if DISCOVERED_PATH.exists():
        try:
            return orjson.loads(DISCOVERED_PATH.read_bytes())
        except Exception:
            pass
    return {}


def _save_discovered(data: dict) -> None:
    DISCOVERED_PATH.parent.mkdir(exist_ok=True)
    DISCOVERED_PATH.write_bytes(orjson.dumps(data, option=orjson.OPT_INDENT_2))


# ── Candidate discovery ──────────────────────────────────────────────────────

def find_slang_candidates(
    detector: "SlangDetector",
    corpus_counts: Counter,
    top_n: int = 30,
) -> list[tuple[str, list[str]]]:
    """
    Surfaces two flavours of candidate words for the LLM to adjudicate:

      • Emerging   — novel (not in any standard dictionary) AND trending
                     upward. Ranked by burstiness.
      • Established — already corpus-stable (high frequency, many days)
                     but not an English dictionary word. These are the
                     "currently in use" Filipino slang the corpus-stability
                     gate in is_likely_standard would otherwise treat as
                     standard. Ranked by raw frequency.

    Both pools are merged so the lexicon grows beyond just newly-bursting
    coinages. False positives from the established pool (common Tagalog
    words calamanCy/English don't recognise) are caught by the SUSPECT
    audit after the LLM tags them.
    """
    from dictionary_service import (
        AMBIGUOUS_SLANG_SEEDS, KNOWN_SLANG, _check_english_api, is_known_tagalog,
    )
    from api.corpus_utils import load_posts

    already_known = set(AMBIGUOUS_SLANG_SEEDS) | set(KNOWN_SLANG) | set(load_discovered())

    # rapidfuzz lets us skip near-duplicate variants we'd otherwise pay LLM
    # budget to re-define. e.g. 'petmaluu' shouldn't get its own entry when
    # 'petmalu' already exists.
    try:
        from rapidfuzz import process as _rf_process, fuzz as _rf_fuzz
    except ImportError:
        _rf_process = None
        _rf_fuzz = None
    known_list = list(already_known)

    def _is_variant_of_known(word: str) -> bool:
        if _rf_process is None or not known_list:
            return False
        # Same length-window heuristic as resolve_canonical.
        scope = [k for k in known_list if abs(len(k) - len(word)) <= 2]
        if not scope:
            return False
        match = _rf_process.extractOne(word, scope, scorer=_rf_fuzz.ratio, score_cutoff=90)
        return match is not None

    # Headroom on each pool so the parallel English-API filter still leaves
    # us with enough non-English words to fill top_n after rejections.
    POOL_TARGET = max(top_n, 30)

    # Phase 1 — cheap filters only. Bucket as established (corpus-stable) or
    # emerging (novel). No network calls in this loop, so it's bounded by
    # the cap, not by the 2000-word scan.
    emerging:    list[tuple[str, float, int]] = []
    established: list[tuple[str, float, int]] = []

    for word, count in corpus_counts.most_common(2000):
        if len(emerging) >= POOL_TARGET and len(established) >= POOL_TARGET:
            break
        if (
            count < 10
            or len(word) < 3
            or not word.isalpha()
            or word in already_known
            or _is_variant_of_known(word)
            or (detector.model and word not in detector.model.wv)
        ):
            continue
        # Cheap pandas-only stability check (no English API yet).
        is_stable = (
            detector._word_corpus_count(word) >= 300
            and detector._word_days_present(word) >= 50
        )
        if is_stable:
            if len(established) >= POOL_TARGET:
                continue
            established.append((word, detector.get_burstiness(word), count))
        else:
            if len(emerging) >= POOL_TARGET:
                continue
            emerging.append((word, detector.get_burstiness(word), count))

    # Phase 2 — drop any candidate that's a standard English OR standard
    # Tagalog word. is_known_tagalog combines the offline wordlist with
    # roberta-tagalog's tokenizer vocab so we catch words missing from
    # either source individually. Genuine slang (multi-token in roberta,
    # absent from wordlist) survives both checks.
    def _is_known_standard(word: str) -> bool:
        return _check_english_api(word) or is_known_tagalog(word)

    emerging    = [t for t in emerging    if not _is_known_standard(t[0])]
    established = [t for t in established if not _is_known_standard(t[0])]

    emerging.sort(key=lambda t: (-t[1], -t[2]))           # burst, then freq
    established.sort(key=lambda t: (-t[2], -t[1]))        # freq, then burst

    # Split the budget so neither pool starves the other.
    half = max(1, top_n // 2)
    candidates: list[str] = [w for w, _, _ in emerging[:top_n - half]]
    for w, _, _ in established[:half]:
        if w not in candidates:
            candidates.append(w)
    candidates = candidates[:top_n]

    posts = load_posts()
    result: list[tuple[str, list[str]]] = []
    for word in candidates:
        pat = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
        examples: list[str] = []
        for post in posts:
            text = post.get("text", "")
            if pat.search(text) and 15 < len(text) < 300:
                examples.append(text.strip())
                if len(examples) >= 5:
                    break
        if examples:
            result.append((word, examples))

    return result


# ── Word analysis ─────────────────────────────────────────────────────────────

def analyse_word(word: str, context_sentences: list[str]) -> dict | None:
    try:
        raw = _call_llm(_build_prompt(word, context_sentences))
        return _parse_response(raw)
    except Exception:
        return None


# ── Batch enrichment ─────────────────────────────────────────────────────────

def enrich_candidates(
    candidates: list[tuple[str, list[str]]],
    max_new: int = 15,
    detector: "SlangDetector | None" = None,
) -> int:
    """
    Analyses up to `max_new` candidates, saves confirmed slang to
    data/discovered_slang.json, and hot-merges into the live lexicon.
    Returns count of newly added words.

    If ``detector`` is provided, newly added entries are audited against the
    corpus frequency map; high-frequency, widely-used words (likely common
    Tagalog words the LLM misjudged) are written to data/suspect_slang.json
    for manual review via scripts/unflag_slang.py.
    """
    discovered = load_discovered()
    new_words: list[str] = []

    for word, sentences in candidates:
        if word in discovered or len(new_words) >= max_new:
            continue
        entry = analyse_word(word, sentences)
        if entry:
            discovered[word] = entry
            new_words.append(word)

    if new_words:
        _save_discovered(discovered)
        _merge_into_lexicon(discovered)
    if detector is not None:
        # Re-audit every discovered entry against the current corpus, not just
        # the ones we just added. Older entries that have grown into common
        # words with the corpus should surface here.
        audit_discovered(detector)

    return len(new_words)


def audit_discovered(detector: "SlangDetector") -> int:
    """
    Scan every entry in data/discovered_slang.json against the live frequency
    map. Anything that looks like a common Tagalog word the LLM misjudged
    (very high total occurrences + consistent presence across many days) is
    written to data/suspect_slang.json for manual review. Returns the number
    of currently-flagged suspects (not just newly added ones).
    """
    if detector.word_freq_map.empty:
        return 0

    discovered = load_discovered()
    if not discovered:
        return 0

    freq = detector.word_freq_map
    suspects: dict = {}
    for word in discovered:
        if word not in freq.columns:
            continue
        series = freq[word]
        total  = int(series.sum())
        days   = int((series > 0).sum())
        if total >= SUSPECT_FREQUENCY_THRESHOLD and days >= SUSPECT_DAY_SPREAD:
            suspects[word] = {
                "total_count": total,
                "days_present": days,
                "reason": (
                    f"Very common and stable ({total} occurrences across {days} days) "
                    "— probably a standard word wrongly classified as slang by the LLM."
                ),
            }

    # Drop anything that was a suspect before but is no longer (e.g. corpus
    # churn made the stats shift). This keeps suspect_slang.json self-healing.
    previous = {}
    if SUSPECT_PATH.exists():
        try:
            previous = orjson.loads(SUSPECT_PATH.read_bytes())
        except Exception:
            previous = {}

    if suspects != previous:
        SUSPECT_PATH.parent.mkdir(exist_ok=True)
        SUSPECT_PATH.write_bytes(orjson.dumps(suspects, option=orjson.OPT_INDENT_2))
        added   = sorted(set(suspects) - set(previous))
        cleared = sorted(set(previous) - set(suspects))
        for w in added:
            meta = suspects[w]
            print(f"[enricher] SUSPECT: '{w}' flagged for review "
                  f"(count={meta['total_count']}, days={meta['days_present']})")
        for w in cleared:
            print(f"[enricher] SUSPECT cleared: '{w}' no longer meets the audit threshold")

    return len(suspects)


def _merge_into_lexicon(discovered: dict) -> None:
    """Hot-merges discovered entries into the live dictionary_service dicts."""
    try:
        import dictionary_service as ds
        for word, meta in discovered.items():
            if word not in ds.KNOWN_SLANG:
                ds.KNOWN_SLANG[word] = meta.get("definition", "")
            if word not in ds.PLAIN_WORD and meta.get("plain"):
                ds.PLAIN_WORD[word] = meta["plain"]
            if word not in ds.FORMATION_TYPE and meta.get("formation_type"):
                ds.FORMATION_TYPE[word] = meta["formation_type"]
            # Only semantic-shift words are ambiguous; novel coinages are not.
            if meta.get("formation_type") == "semantic_shift":
                ds.AMBIGUOUS_SLANG_SEEDS.add(word)
    except Exception:
        pass
