"""
Gathers Filipino slang word candidates from external sources.

Three source types:
  • Reddit search — queries Reddit's public search.json for slang-related
    threads in r/Tagalog, r/Philippines, r/AskPilipinas. Walks each
    matching thread's comments. No auth needed.
  • Reddit threads — direct URLs (used when the user has a specific link).
  • LLMs — asks each available provider (Gemini / Groq / Ollama) for a
    list of common Filipino slang. Adds whatever they return to the pool.

Each source returns text snippets / explicit word lists; the caller filters
against the existing lexicon and re-verifies via the standard pipeline.
"""
from __future__ import annotations

import json as _json
import os
import re
import time
import requests
from urllib.parse import urlparse, quote_plus


# A direct-URL fallback. Mostly useful for ad-hoc imports — the search-based
# gatherer below finds far more threads dynamically.
DEFAULT_SOURCES: list[str] = [
    "https://www.reddit.com/r/Tagalog/comments/17magha/tagalog_slang_words/",
]

# Subreddits where Filipino slang lists tend to surface
SEARCH_SUBREDDITS: list[str] = [
    "Tagalog", "Philippines", "AskPilipinas", "Pilipinas", "studytips",
]
# Search queries to fan out across each subreddit
SEARCH_QUERIES: list[str] = [
    "slang words", "filipino slang", "tagalog slang", "internet slang",
    "gen z slang", "common slang",
]
SEARCH_LIMIT_PER_QUERY = 4   # threads to pull per subreddit × query combo

# Real Filipino words that aren't slang — exclude even when extracted as
# candidates. Conservative list to avoid filtering genuine slang variants.
COMMON_FILLERS: set[str] = {
    "the", "and", "but", "for", "are", "you", "this", "that", "with",
    "from", "have", "your", "they", "what", "when", "where", "how",
    "ang", "ng", "sa", "na", "ay", "po", "pero", "kasi", "lang",
    "yung", "naman", "talaga", "ako", "ikaw", "siya", "kami", "sila",
    "ito", "iyan", "iyon", "kung", "para", "din", "rin", "raw", "daw",
    "edit", "https", "comment", "reddit", "thread", "post", "tagalog",
    "english", "filipino", "slang", "words", "word", "definition",
    "example", "means", "meaning", "actually", "really", "though",
}


def _fetch(url: str, timeout: int = 12) -> str:
    """Fetches a URL with a polite User-Agent. Returns body text or raises."""
    headers = {
        "User-Agent": "PinoySpeak-SlangImporter/1.0 (Filipino slang dictionary builder)",
        "Accept-Language": "en-US,tl;q=0.8",
    }
    res = requests.get(url, headers=headers, timeout=timeout)
    res.raise_for_status()
    return res.text


def _walk_reddit_listing(node, sink: list[str]) -> None:
    """Recursively pulls comment bodies out of Reddit's .json structure."""
    if isinstance(node, list):
        for item in node:
            _walk_reddit_listing(item, sink)
        return
    if not isinstance(node, dict):
        return
    if node.get("kind") == "t1":
        body = (node.get("data") or {}).get("body")
        if body:
            sink.append(body)
    if node.get("kind") == "t3":
        sel = (node.get("data") or {}).get("selftext")
        if sel:
            sink.append(sel)
    data = node.get("data") or {}
    children = data.get("children")
    replies  = data.get("replies")
    if children: _walk_reddit_listing(children, sink)
    if replies:  _walk_reddit_listing(replies,  sink)


def _fetch_reddit_thread(url: str) -> list[str]:
    """Fetches all comments + selftext from a Reddit thread as raw text."""
    json_url = url.rstrip("/") + "/.json?limit=500&raw_json=1"
    import json as _json
    body = _fetch(json_url)
    data = _json.loads(body)
    out: list[str] = []
    _walk_reddit_listing(data, out)
    return out


def _strip_html(text: str) -> str:
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>",   " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&[a-z]+;", " ", text)
    return re.sub(r"\s+", " ", text)


def _fetch_generic(url: str) -> list[str]:
    return [_strip_html(_fetch(url))]


# ─── Candidate extraction ────────────────────────────────────────────────────

# Patterns where a word is defined inline:
#   "lodi - idol"     "lodi — idol"     "lodi: idol"
#   "**lodi** = idol" "lodi (slang for idol)"
_INLINE_DEF = re.compile(
    r"(?:^|[\s>*_`\-])\*{0,2}([a-z][a-z'-]{2,20})\*{0,2}\s*[-–—:=]\s*[a-zA-Z]",
    re.IGNORECASE,
)

# Bullet-list items that begin with a single word
_BULLET = re.compile(
    r"(?:^|\n)\s*(?:[-*•▪►]|\d+\.)\s*\*{0,2}([a-z][a-z'-]{2,20})\*{0,2}",
    re.IGNORECASE,
)

# **bold** or `code` words — strong signal in markdown they're being highlighted
_FORMATTED = re.compile(
    r"(?:\*\*([a-z][a-z'-]{2,20})\*\*|`([a-z][a-z'-]{2,20})`)",
    re.IGNORECASE,
)


def extract_candidates(texts: list[str]) -> list[str]:
    """Pulls likely slang word candidates from raw text snippets."""
    found: dict[str, int] = {}    # word → occurrences (used for ranking)
    for text in texts:
        if not text:
            continue
        for m in _INLINE_DEF.finditer(text):
            w = m.group(1).lower().strip("'-")
            if _is_plausible(w):
                found[w] = found.get(w, 0) + 2  # higher weight for explicit defs
        for m in _BULLET.finditer(text):
            w = m.group(1).lower().strip("'-")
            if _is_plausible(w):
                found[w] = found.get(w, 0) + 1
        for m in _FORMATTED.finditer(text):
            w = (m.group(1) or m.group(2) or "").lower().strip("'-")
            if _is_plausible(w):
                found[w] = found.get(w, 0) + 1
    # Rank by occurrences so the most-frequently-cited words come first
    return [w for w, _ in sorted(found.items(), key=lambda kv: -kv[1])]


def _is_plausible(word: str) -> bool:
    if not word or not (3 <= len(word) <= 20):
        return False
    if not re.fullmatch(r"[a-z][a-z'-]+", word):
        return False
    if word in COMMON_FILLERS:
        return False
    return True


# ─── Reddit search (dynamic thread discovery) ───────────────────────────────

def _reddit_search_thread_urls(
    subreddits: list[str], queries: list[str], per_query: int,
    *, delay_seconds: float = 0.4,
) -> tuple[list[str], list[dict]]:
    """Cross-product of (subreddit × query) → thread URLs found via Reddit search."""
    urls: list[str] = []
    seen: set[str] = set()
    diags: list[dict] = []
    for sr in subreddits:
        for q in queries:
            search_url = (
                f"https://www.reddit.com/r/{sr}/search.json"
                f"?q={quote_plus(q)}&restrict_sr=1&sort=relevance&limit={per_query}"
            )
            try:
                data = _json.loads(_fetch(search_url))
                children = (data.get("data") or {}).get("children") or []
                hits = 0
                for c in children:
                    permalink = (c.get("data") or {}).get("permalink") or ""
                    if not permalink:
                        continue
                    full = "https://www.reddit.com" + permalink
                    if full in seen:
                        continue
                    seen.add(full)
                    urls.append(full)
                    hits += 1
                diags.append({
                    "kind": "reddit-search", "subreddit": sr, "query": q,
                    "ok": True, "found": hits,
                })
            except Exception as e:
                diags.append({
                    "kind": "reddit-search", "subreddit": sr, "query": q,
                    "ok": False, "error": str(e)[:120],
                })
            time.sleep(delay_seconds)
    return urls, diags


# ─── LLM brainstorming (Gemini / Groq / Ollama) ─────────────────────────────

_LLM_PROMPT = (
    "List the 40 most common modern Filipino internet slang words used on "
    "social media (Twitter, Reddit, TikTok). Include both Tagalog-origin "
    "coinages (petmalu, lodi, werpa, charot, sana all, jowa, gigil) and "
    "English-origin slang adopted by Filipinos (basic, lit, slay, sus). "
    "Return ONLY a JSON array of single-word strings — no definitions, "
    "no commentary. Example format: [\"lodi\", \"petmalu\", \"werpa\"]"
)


def _post_json(url: str, payload: dict, headers: dict | None = None,
               timeout: int = 25) -> dict:
    res = requests.post(url, json=payload, headers=headers or {}, timeout=timeout)
    res.raise_for_status()
    return res.json()


def _gemini_brainstorm() -> list[str]:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return []
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={key}"
    )
    data = _post_json(url, {
        "contents": [{"parts": [{"text": _LLM_PROMPT}]}],
        "generationConfig": {"maxOutputTokens": 400, "temperature": 0.7},
    })
    raw = data["candidates"][0]["content"]["parts"][0]["text"]
    return _parse_llm_word_list(raw)


def _groq_brainstorm() -> list[str]:
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        return []
    data = _post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": _LLM_PROMPT}],
            "max_tokens": 400,
            "temperature": 0.7,
        },
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    raw = data["choices"][0]["message"]["content"]
    return _parse_llm_word_list(raw)


def _ollama_brainstorm() -> list[str]:
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    try:
        data = _post_json(
            "http://localhost:11434/api/chat",
            {
                "model": model,
                "messages": [{"role": "user", "content": _LLM_PROMPT}],
                "stream": False,
            },
            timeout=60,
        )
        raw = data["message"]["content"]
        return _parse_llm_word_list(raw)
    except Exception:
        return []


def _parse_llm_word_list(raw: str) -> list[str]:
    """Parse the LLM's reply into a clean list of single-word slang candidates."""
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE).strip()
    # Try as JSON array first
    try:
        arr = _json.loads(raw)
        if isinstance(arr, list):
            return [str(x).lower().strip() for x in arr if isinstance(x, (str,)) and _is_plausible(str(x).lower().strip())]
    except _json.JSONDecodeError:
        pass
    # Fallback: extract any JSON-array-like substring
    m = re.search(r"\[[\s\S]*?\]", raw)
    if m:
        try:
            arr = _json.loads(m.group())
            return [str(x).lower().strip() for x in arr if _is_plausible(str(x).lower().strip())]
        except Exception:
            pass
    # Last resort: comma/newline-separated tokens
    out: list[str] = []
    for piece in re.split(r"[,\n]", raw):
        w = piece.strip().strip("\"'`*-•").lower()
        if _is_plausible(w):
            out.append(w)
    return out


def gather_from_llms() -> tuple[list[str], list[dict]]:
    """Asks each configured LLM provider for a brainstormed slang list."""
    providers: list[tuple[str, callable]] = [
        ("gemini",  _gemini_brainstorm),
        ("groq",    _groq_brainstorm),
        ("ollama",  _ollama_brainstorm),
    ]
    diagnostics: list[dict] = []
    pooled: list[str] = []
    for name, fn in providers:
        try:
            words = fn()
            if words:
                pooled.extend(words)
                diagnostics.append({"kind": "llm", "provider": name, "ok": True, "words": len(words)})
            else:
                diagnostics.append({"kind": "llm", "provider": name, "ok": False, "error": "no_key_or_empty"})
        except Exception as e:
            diagnostics.append({"kind": "llm", "provider": name, "ok": False, "error": str(e)[:120]})
    return pooled, diagnostics


# ─── Public entry point ──────────────────────────────────────────────────────

def gather_candidates_from_sources(
    sources: list[str] | None = None,
    *,
    delay_seconds: float = 0.6,
    use_search: bool = True,
    use_llms: bool = True,
) -> tuple[list[str], list[dict]]:
    """
    Fetches every source, extracts candidate words, and returns:
      • flat ranked list of candidate words (most-cited first)
      • per-source diagnostics for each fetch attempt
    """
    explicit_sources = sources or DEFAULT_SOURCES
    diagnostics: list[dict] = []
    all_text: list[str] = []
    explicit_words: list[str] = []

    # 1) Dynamically discover slang threads on Reddit
    discovered_urls: list[str] = []
    if use_search:
        discovered_urls, search_diags = _reddit_search_thread_urls(
            SEARCH_SUBREDDITS, SEARCH_QUERIES, SEARCH_LIMIT_PER_QUERY,
            delay_seconds=delay_seconds / 2,
        )
        diagnostics.extend(search_diags)

    # 2) Fetch every URL (explicit + discovered), dedup
    seen_urls: set[str] = set()
    for url in (*explicit_sources, *discovered_urls):
        if url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            host = urlparse(url).netloc
            if "reddit.com" in host:
                snippets = _fetch_reddit_thread(url)
            else:
                snippets = _fetch_generic(url)
            all_text.extend(snippets)
            diagnostics.append({"kind": "url", "url": url, "ok": True, "snippets": len(snippets)})
        except Exception as e:
            diagnostics.append({"kind": "url", "url": url, "ok": False, "error": str(e)[:120]})
        time.sleep(delay_seconds)

    # 3) Brainstorm via available LLMs
    if use_llms:
        llm_words, llm_diags = gather_from_llms()
        explicit_words.extend(llm_words)
        diagnostics.extend(llm_diags)

    # Combine: heuristic-extracted Reddit candidates + LLM-listed words
    reddit_candidates = extract_candidates(all_text)
    combined: dict[str, int] = {}
    for w in reddit_candidates:
        combined[w] = combined.get(w, 0) + 2     # heuristic-extracted: high signal
    for w in explicit_words:
        if _is_plausible(w):
            combined[w] = combined.get(w, 0) + 1 # LLM list: moderate signal

    # Re-rank — words confirmed by multiple source types come first
    ranked = [w for w, _ in sorted(combined.items(), key=lambda kv: -kv[1])]
    return ranked, diagnostics
