"""
FastAPI ML service — run with:  uvicorn api.main:app --reload --port 8000
Exposes the SlangDetector and corpus utilities over HTTP for the Next.js frontend.
"""
from contextlib import asynccontextmanager
import sys, os, threading, asyncio
import time as _time
from functools import partial

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
from fastapi import Request, Depends

_RATE_LIMITS = {}

def rate_limit(req: Request):
    ip = req.client.host if req.client else "127.0.0.1"
    now = time.time()
    
    if ip not in _RATE_LIMITS:
        _RATE_LIMITS[ip] = []
        
    _RATE_LIMITS[ip] = [t for t in _RATE_LIMITS[ip] if now - t < 60]
    
    if len(_RATE_LIMITS[ip]) >= 30:
        raise HTTPException(429, "Rate limit exceeded (30 req/min). Please slow down.")
        
    _RATE_LIMITS[ip].append(now)

from slang_detector import SlangDetector
from dictionary_service import (
    KNOWN_SLANG, PLAIN_WORD, FORMATION_TYPE, SEED_LEXICON,
    is_standard_word, is_profane, get_formation_type, AMBIGUOUS_SLANG_SEEDS,
    KNOWN_MULTI_WORD_SLANG, resolve_canonical, _merge_entry,
    _STANDARD_FIL_BLOCKLIST, _STANDARD_FIL_PREFIX_RE,
)
from api.corpus_utils import scan_corpus, get_top_slang, load_posts, _STOP_WORDS

_detector: SlangDetector | None = None

_DATA_PATH  = "data/corpus.db"
_MODEL_PATH = "data/social_model.model"

# Serializes the read-modify-write of discovered_slang.json. /verify-slang
# and /import-online-slang can fire concurrently (the translator runs many
# verify calls in parallel via Promise.all), and without this lock each
# write loads-then-overwrites the file, clobbering siblings' new entries.
_lexicon_write_lock = threading.Lock()

# ── Frontend cache invalidation ───────────────────────────────────────────────
# After saving a new word, POST to Vercel's /api/revalidate so the cached
# lexicon is purged immediately (no waiting for the 60-second TTL).
_FRONTEND_URL = os.environ.get("FRONTEND_URL", "").rstrip("/")
_REVALIDATE_SECRET = os.environ.get("REVALIDATE_SECRET", "")

def _revalidate_frontend() -> None:
    if not _FRONTEND_URL:
        return
    import requests as _req
    try:
        _req.post(
            f"{_FRONTEND_URL}/api/revalidate",
            json={"secret": _REVALIDATE_SECRET, "tags": ["lexicon"]},
            timeout=3,
        )
    except Exception:
        pass  # best-effort — never block the learn path


def _continuous_learner() -> None:
    """
    Daemon thread: runs for the lifetime of the API server.

    Every 2 min  — hot-reload model if updated on disk (picks up automate.py runs)
    Every 10 min — scrape new Reddit posts from core Filipino subreddits
    On growth    — retrain when corpus grows ≥ 200 KB (~300-500 new posts)
    After retrain — ask Claude API to discover & define new slang candidates,
                    merging them into the live lexicon without a restart
    """
    from model_pipeline import PinoySpeakPipeline
    from gensim.models import FastText as _FastText
    from data_collection import scrape_reddit, CORE_SUBREDDITS
    from scrape import merge_all_sources
    from slang_enricher import find_slang_candidates, enrich_candidates, audit_discovered
    from api.corpus_utils import scan_corpus
    from youtube_scraper import scrape_youtube

    SIZE_DELTA      = 200_000   # ~300–500 new posts trigger retrain
    CHECK_INTERVAL  = 120       # seconds between model-watch ticks
    SCRAPE_INTERVAL = 600       # seconds between Reddit scrape rounds
    YOUTUBE_INTERVAL = 3600     # seconds between YouTube scrape rounds (hourly)
    AUDIT_INTERVAL  = 3600      # re-audit discovered lexicon every hour

    pipeline          = PinoySpeakPipeline()
    last_model_mtime  = 0.0
    last_corpus_size  = 0
    last_scrape_at    = 0.0
    last_yt_scrape_at = 0.0
    last_audit_at     = 0.0

    while True:
        _time.sleep(CHECK_INTERVAL)
        try:
            # ── 1. Hot-reload when model updated externally ──────────────────
            if os.path.exists(_MODEL_PATH):
                m_mtime = os.path.getmtime(_MODEL_PATH)
                if _detector and _detector.model is None:
                    # Model missing/corrupt at startup — load now that file exists
                    try:
                        _detector.model = _FastText.load(_MODEL_PATH, mmap='r')
                        _detector.word_freq_map = None  # invalidate; rebuilt lazily on demand
                        try:
                            _detector.classify_word.cache_clear()
                        except AttributeError:
                            pass
                        print("[learner] Model hot-loaded after startup (was missing)")
                    except Exception as load_err:
                        print(f"[learner] Model load attempt failed: {load_err}")
                elif last_model_mtime and m_mtime != last_model_mtime and _detector:
                    _detector.model = _FastText.load(_MODEL_PATH, mmap='r')
                    _detector.word_freq_map = None  # invalidate; rebuilt lazily on demand
                    try:
                        _detector.classify_word.cache_clear()
                    except AttributeError:
                        pass
                last_model_mtime = m_mtime
            elif not os.path.exists(_MODEL_PATH) and os.path.exists(_DATA_PATH) and _detector and _detector.model is None:
                # No model at all — train from existing corpus
                print("[learner] No model found but corpus exists — training now …")
                ok = pipeline.train(data_path=_DATA_PATH, model_path=_MODEL_PATH)
                if ok and os.path.exists(_MODEL_PATH):
                    _detector.model = _FastText.load(_MODEL_PATH, mmap='r')
                    _detector.word_freq_map = None  # invalidate; rebuilt lazily on demand
                    try:
                        _detector.classify_word.cache_clear()
                    except AttributeError:
                        pass
                    print("[learner] Model trained and loaded from existing corpus")

            # ── 2. Scrape new Reddit posts every SCRAPE_INTERVAL ────────────
            now = _time.time()
            if now - last_scrape_at >= SCRAPE_INTERVAL:
                scrape_reddit(CORE_SUBREDDITS, limit=100, pages=3, workers=3)
                merge_all_sources()
                last_scrape_at = now

            # ── 2b. Scrape YouTube comments every YOUTUBE_INTERVAL ──────────
            if now - last_yt_scrape_at >= YOUTUBE_INTERVAL:
                last_yt_scrape_at = now  # update before attempt so a crash doesn't retry every cycle
                try:
                    scrape_youtube()
                except Exception as yt_err:
                    print(f"[learner] YouTube scrape skipped: {yt_err}")

            # ── 3. Retrain when corpus has grown enough ──────────────────────
            if os.path.exists(_DATA_PATH):
                c_size = os.path.getsize(_DATA_PATH)
                if not last_corpus_size:
                    last_corpus_size = c_size
                elif c_size - last_corpus_size >= SIZE_DELTA:
                    ok = pipeline.train(data_path=_DATA_PATH, model_path=_MODEL_PATH)
                    if ok and _detector and os.path.exists(_MODEL_PATH):
                        _detector.model = _FastText.load(_MODEL_PATH, mmap='r')
                        _detector.word_freq_map = None  # invalidate; rebuilt lazily on demand
                        try:
                            _detector.classify_word.cache_clear()
                        except AttributeError:
                            pass
                        # ── 4. Claude API: discover & define new slang ───────
                        counts, _ = scan_corpus()
                        if counts and _detector and _detector.model:
                            candidates = find_slang_candidates(_detector, counts)
                            enrich_candidates(candidates, detector=_detector)
                    last_corpus_size = c_size

            # ── 5. Periodic re-audit of the discovered lexicon ──────────────
            # Re-checks every entry against the current corpus, independent
            # of whether anything was added this round. Catches old entries
            # that have drifted into "common word" territory.
            if now - last_audit_at >= AUDIT_INTERVAL and _detector and _detector.model:
                audit_discovered(_detector)
                last_audit_at = now
        except Exception as e:
            print(f"[learner] Background thread error: {e}")
            _time.sleep(10)  # prevent tight loop on persistent errors


# ── Async learn queue ────────────────────────────────────────────────────────
_learn_queue: asyncio.Queue = asyncio.Queue()

async def _learn_worker() -> None:
    """Drains _learn_queue one task at a time so file writes never race."""
    while True:
        req = await _learn_queue.get()
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, partial(_blocking_learn, req))
        except Exception as e:
            print(f"[learn_worker] unhandled error: {e}")
        finally:
            _learn_queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detector
    try:
        _detector = SlangDetector()
    except Exception as e:
        print(f"[startup] SlangDetector init failed (no model/data yet): {e}")
        print("[startup] API is running but analysis endpoints need data/social_model.model")
        _detector = None

    # Build RAG index from the live lexicon (non-blocking — runs in thread pool)
    try:
        import rag_store
        from dictionary_service import get_full_lexicon
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, rag_store.build_index, get_full_lexicon())
        print("[startup] RAG index built")
    except Exception as e:
        print(f"[startup] RAG index skipped: {e}")

    # Pre-build the frequency map in background so /word-trends works on first request
    if _detector:
        async def _prebuild_freq_map():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: _detector.word_freq_map)
            print("[startup] Frequency map pre-built")
        asyncio.create_task(_prebuild_freq_map())

    # Start the async learn worker
    asyncio.create_task(_learn_worker())
    print("[startup] async learn-queue worker started")

    if os.getenv("LEARNER_ENABLED", "0") == "1":
        print("[learner] background scraper + retrain loop enabled")
        threading.Thread(target=_continuous_learner, daemon=True, name="learner").start()
    else:
        print("[learner] disabled — set LEARNER_ENABLED=1 to enable background scraping/retraining")
    yield


app = FastAPI(title="PinoySpeak ML API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    sentence: str
    profanity_filter: bool = True

class LogChatRequest(BaseModel):
    text: str

class VerifySlangRequest(BaseModel):
    word: str

class ImportOnlineRequest(BaseModel):
    sources: list[str] | None = None
    max_new: int = 30

class LearnSlangRequest(BaseModel):
    word: str
    definition: str | None = None
    plain: str | None = None
    pos: str | None = None
    origin: str | None = None
    example: str | None = None
    formation_type: str | None = None

class TranslateRequest(BaseModel):
    sentence: str


@app.get("/health")
def health():
    loaded = _detector is not None and _detector.model is not None
    vocab  = len(_detector.model.wv) if loaded else 0
    discovered = 0
    try:
        from slang_enricher import load_discovered
        discovered = len(load_discovered())
    except Exception:
        pass
    return {
        "status": "ok",
        "model_loaded": loaded,
        "vocab_size": vocab,
        "lexicon_size": len(AMBIGUOUS_SLANG_SEEDS),
        "discovered_slang": discovered,
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest, _ = Depends(rate_limit)):
    if not _detector or not _detector.model:
        raise HTTPException(503, "Model not loaded — run automate.py first")

    raw_tokens = req.sentence.lower().split()
    cleaned    = [t.strip(".,!?'\"") for t in raw_tokens]

    results: dict = {}
    wv = _detector.model.wv

    # ── Pass 1: multi-word slang (greedy, longest-match first) ──────────────────
    # Runs before single-token classification so "shene ol" is caught as a unit
    # rather than two separate unknown words.
    multi_matches = _detector.find_multi_word_slang(cleaned)
    consumed = {idx for start, end, _ in multi_matches for idx in range(start, end)}

    for start, end, phrase in multi_matches:
        meta = KNOWN_MULTI_WORD_SLANG[phrase]
        results[phrase] = {
            "classification": "slang",
            "reason": "Known multi-word Filipino slang phrase.",
            "formation_type": "multi_word",
            "burstiness": 0.0,
            "definition": meta.get("definition", ""),
            "plain_word": meta.get("plain"),
            "standard_approx": [],
            "related": [],
        }

    # ── Rebuild token list: multi-word phrases become single entries ─────────────
    final_tokens: list[str] = []
    i = 0
    while i < len(raw_tokens):
        if i in consumed:
            for start, end, phrase in multi_matches:
                if start == i:
                    final_tokens.append(phrase)
                    i = end
                    break
            else:
                i += 1  # middle of a multi-word match — skip (already covered by start)
        else:
            final_tokens.append(raw_tokens[i])
            i += 1

    # ── Pass 2: classify remaining single tokens ─────────────────────────────────
    for token in final_tokens:
        if " " in token:
            continue  # already handled as multi-word above
        clean_tok = token.strip(".,!?'\"")
        if not clean_tok or clean_tok in results:
            continue

        # Fetch neighbors once — reused by classify_word and response fields
        neighbors = wv.most_similar(clean_tok, topn=20) if clean_tok in wv else []
        classification, reason = _detector.classify_word(clean_tok, _neighbors=tuple(neighbors))
        z = _detector.get_burstiness(clean_tok)

        # Resolve alias → canonical so variants (char → charot, chariz → charot)
        # inherit the canonical entry's definition and plain-English gloss.
        canonical      = resolve_canonical(clean_tok) or clean_tok
        definition     = KNOWN_SLANG.get(canonical)
        plain_word     = PLAIN_WORD.get(canonical)
        formation      = get_formation_type(canonical)
        standard_approx = [w for w, _ in neighbors if is_standard_word(w) and w != clean_tok][:4]
        related = [w for w, _ in neighbors if w not in standard_approx and w != clean_tok][:5]

        results[clean_tok] = {
            "classification": classification,
            "reason": reason,
            "formation_type": formation,
            "burstiness": round(z, 2),
            "definition": definition,
            "plain_word": plain_word,
            "canonical": canonical if canonical != clean_tok else None,
            "standard_approx": standard_approx,
            "related": related,
        }

    return {"tokens": final_tokens, "results": results}


_lang_mix_cache: dict | None = None
_lang_mix_cache_at: float = 0.0
_LANG_MIX_TTL = 30 * 60   # 30 min — corpus doesn't shift fast

# Cache version — bump when classification logic changes so old cached
# results don't silently leak through after a restart.
_LANG_MIX_VERSION = 2


@app.get("/language-mix")
def language_mix():
    """
    Classifies every post in the corpus into one of:
      • Tagalog  — predominantly Tagalog vocabulary
      • English  — predominantly English vocabulary
      • Taglish  — meaningful mix of both (code-switching)
      • Slang    — has at least one known slang word

    Returns counts and percentages. Cached for 30 min so this isn't
    recomputed on every page load.
    """
    global _lang_mix_cache, _lang_mix_cache_at
    now = _time.time()
    if (_lang_mix_cache
            and _lang_mix_cache.get("_v") == _LANG_MIX_VERSION
            and (now - _lang_mix_cache_at) < _LANG_MIX_TTL):
        return _lang_mix_cache

    from dictionary_service import (
        is_tagalog_word, _check_english_api, KNOWN_SLANG, AMBIGUOUS_SLANG_SEEDS,
    )
    import re as _re

    posts = load_posts()
    if not posts:
        return {"available": False, "total": 0, "data": []}

    tok_re = _re.compile(r"[a-z][a-z'-]{1,30}", _re.IGNORECASE)
    counts = {"Taglish": 0, "Tagalog": 0, "English": 0, "Slang": 0}

    for post in posts:
        text = (post.get("text") or "").lower()
        if not text or len(text) < 8:
            continue
        tokens = tok_re.findall(text)
        if not tokens:
            continue

        # Independent membership counts. Critical: many words exist in BOTH
        # wordlists ("solid", "extra"), so the elif-chain we had before
        # always credited Tagalog and starved English. Count separately,
        # then decide language based on words that are ONLY in one set.
        # Also: use the offline Tagalog wordlist (not the roberta-augmented
        # is_known_tagalog) — roberta tokenizes many English words to single
        # pieces and would make English look like Tagalog.
        en_only = tg_only = both = n_slang = 0
        for t in tokens:
            if t in KNOWN_SLANG or t in AMBIGUOUS_SLANG_SEEDS:
                n_slang += 1
            in_en = _check_english_api(t)
            in_tg = is_tagalog_word(t)
            if in_en and in_tg:
                both += 1
            elif in_en:
                en_only += 1
            elif in_tg:
                tg_only += 1
            # else: unknown / proper noun — uncounted

        # Classification — priority order. Slang now triggers on ANY known
        # slang word in the post (was 10% threshold, far too strict).
        if n_slang >= 1:
            counts["Slang"] += 1
        elif en_only >= 2 and tg_only >= 2:
            counts["Taglish"] += 1
        elif en_only > tg_only:
            counts["English"] += 1
        elif tg_only > 0:
            counts["Tagalog"] += 1
        else:
            # Pure-OOV (proper nouns, gibberish) — default to Tagalog
            counts["Tagalog"] += 1

    total = sum(counts.values())
    data = [
        {
            "name":  name,
            "value": cnt,
            "pct":   round((cnt / total) * 100, 1) if total else 0.0,
        }
        for name, cnt in counts.items()
    ]
    _lang_mix_cache = {"available": True, "total": total, "data": data, "_v": _LANG_MIX_VERSION}
    _lang_mix_cache_at = now
    return _lang_mix_cache


@app.get("/word-trends")
def word_trends(words: str = "", days: int = 30, n: int = 0):
    """
    Returns per-day occurrence counts across the last N days.

    Two modes:
      ?words=grabe,feels&days=30  — explicit word list (legacy)
      ?n=5&days=30                — auto-pick top-N words within that window

    Shape: { days: [...], series: { word: [...] }, words: [...], available: bool }
    """
    if not _detector or _detector.word_freq_map is None or _detector.word_freq_map.empty:
        return {"days": [], "series": {}, "words": [], "available": False}

    days = max(1, min(days, 365))

    fm = _detector.word_freq_map
    if len(fm) > days:
        fm = fm.tail(days)

    if n > 0:
        # Pick the top-N words by total occurrences within this time window
        totals = fm.sum().sort_values(ascending=False)
        requested = list(totals.head(n).index)
    else:
        requested = [w.strip().lower() for w in (words or "").split(",") if w.strip()]

    if not requested:
        return {"days": [], "series": {}, "words": [], "available": True}

    day_labels = [
        d.isoformat() if hasattr(d, "isoformat") else str(d)
        for d in fm.index
    ]

    series: dict[str, list[int]] = {}
    for word in requested:
        if word in fm.columns:
            series[word] = [int(v) for v in fm[word].tolist()]
        else:
            series[word] = [0] * len(day_labels)

    return {"days": day_labels, "series": series, "words": requested, "available": True}


@app.get("/top-slang")
def top_slang(n: int = 15, period: str = "overall"):
    if not _detector or not _detector.model:
        raise HTTPException(503, "Model not loaded")
    words = get_top_slang(_detector.model, n, period=period)
    return {"words": words}


@app.get("/corpus-stats")
def corpus_stats():
    counts, total = scan_corpus()
    top = next((w for w, _ in counts.most_common(500) if w in AMBIGUOUS_SLANG_SEEDS and not is_standard_word(w)), "—")
    # Derive slang_count from lexicon() so the number is always identical to
    # what the Dictionary page shows — no risk of the two endpoints drifting.
    lex = lexicon()
    return {"total_posts": total, "top_slang": top, "slang_count": lex["count"]}


@app.post("/log-chat")
def log_chat(req: LogChatRequest, _ = Depends(rate_limit)):
    """Logs a user chat message into corpus.db for training."""
    from datetime import date

    text = req.text.strip()
    if not text or len(text) < 10:
        return {"logged": False}

    try:
        import sqlite3
        conn = sqlite3.connect("data/corpus.db")
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR IGNORE INTO posts (text, date, user, likes, source)
        VALUES (?, ?, ?, ?, ?)
        """, (text, str(date.today()), "chat_user", 0, "chat"))
        conn.commit()
        conn.close()
        return {"logged": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/import-online-slang")
def import_online_slang(req: ImportOnlineRequest):
    """
    Pulls candidate words from public web sources (Reddit threads, blog
    posts, etc.) and runs each through the LLM verification pipeline.
    Confirmed entries are persisted to data/discovered_slang.json.

    This is what users mean when they say "check online resources" —
    we actually fetch and parse community-curated lists, not just rely
    on whatever the LLM happens to know.
    """
    from api.online_slang_sources import gather_candidates_from_sources, DEFAULT_SOURCES
    from slang_enricher import load_discovered, _build_prompt, _call_llm, _parse_response

    sources = req.sources or DEFAULT_SOURCES
    max_new = max(1, min(req.max_new or 30, 60))

    # Build the already-known set first so we can pass it to the gatherer,
    # letting the LLM brainstorm skip words we already have.
    discovered_now = load_discovered()
    already_known = (
        set(KNOWN_SLANG) | set(SEED_LEXICON) | set(discovered_now)
    )

    candidates, diagnostics = gather_candidates_from_sources(
        sources, known_words=already_known
    )

    # Drop anything already in the lexicon or in standard dictionaries

    fresh: list[str] = []
    for word in candidates:
        if word in already_known:
            continue
        if is_standard_word(word):
            continue   # skip plain English/Tagalog dictionary words
        fresh.append(word)
        if len(fresh) >= max_new * 2:    # a 2× pool to allow for LLM rejections
            break

    # Verify each remaining candidate via the LLM. We piggy-back on the
    # existing /learn-slang flow (corpus enrichment + dedup + audit) so
    # newly imported words get the same metadata quality as auto-learned ones.
    added = 0
    rejected = 0
    accepted_words: list[str] = []
    for word in fresh:
        if added >= max_new:
            break
        try:
            raw    = _call_llm(_build_prompt(word, []))
            parsed = _parse_response(raw)
        except Exception:
            continue
        if not parsed:
            rejected += 1
            continue
        learn_req = LearnSlangRequest(
            word=word,
            definition=parsed.get("definition") or "",
            plain=parsed.get("plain") or None,
            origin=parsed.get("origin") or None,
            formation_type=parsed.get("formation_type") or None,
        )
        result = learn_slang(learn_req)
        if result.get("saved"):
            added += 1
            accepted_words.append(word)

    return {
        "sources":          diagnostics,
        "candidates_found": len(candidates),
        "fresh":            len(fresh),
        "verified":         added + rejected,
        "added":            added,
        "rejected":         rejected,
        "added_words":      accepted_words,
        "lexicon_size":     len(load_discovered()) + len(SEED_LEXICON),
    }


@app.post("/sweep-corpus")
def sweep_corpus(max_new: int = 15):
    """
    Full corpus sweep: surfaces every reasonably-frequent word that isn't
    already in the lexicon, asks the LLM to confirm whether each is genuine
    Filipino slang, and persists confirmed entries to discovered_slang.json.

    This is the on-demand version of the background `_continuous_learner` —
    use it when you want to immediately catch slang the corpus-only detector
    has been silently missing.

    Returns a summary so the UI can show meaningful progress without polling.
    """
    if not _detector or not _detector.model:
        raise HTTPException(503, "Model not loaded")

    from slang_enricher import find_slang_candidates, enrich_candidates, load_discovered

    counts, _total = scan_corpus()
    if not counts:
        return {"scanned": 0, "candidates": 0, "added": 0, "lexicon_size": 0}

    candidates = find_slang_candidates(_detector, counts, top_n=max(max_new, 30))
    before = len(load_discovered())
    added = enrich_candidates(candidates, max_new=max_new, detector=_detector)
    after = len(load_discovered())

    return {
        "scanned":      sum(counts.values()),
        "candidates":   len(candidates),
        "added":        added,
        "lexicon_size": after,
        "delta":        after - before,
    }


def _web_search_slang(word: str) -> list[str]:
    """
    Search DuckDuckGo for Filipino slang definitions of `word`.
    Returns up to 3 text snippets (no API key needed).
    Fails silently — callers should treat an empty list as "no results".
    """
    import requests as _req
    import re as _re
    query = f"{word} Filipino slang meaning"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; PinoySpeak/1.0 slang-research)"}
    snippets: list[str] = []

    # Pass 1 — DuckDuckGo Instant Answers (structured JSON, fast)
    try:
        r = _req.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_redirect": "1", "no_html": "1", "skip_disambig": "1"},
            headers=headers, timeout=5,
        )
        data = r.json()
        for key in ("AbstractText", "Answer"):
            val = (data.get(key) or "").strip()
            if val:
                snippets.append(val[:400])
        for topic in (data.get("RelatedTopics") or [])[:3]:
            if isinstance(topic, dict) and topic.get("Text"):
                snippets.append(topic["Text"][:250])
    except Exception:
        pass

    if snippets:
        return snippets[:3]

    # Pass 2 — DuckDuckGo HTML search (broader coverage, scrape snippets)
    try:
        r2 = _req.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers=headers, timeout=6,
        )
        raw_snippets = _re.findall(
            r'class="result__snippet"[^>]*>(.*?)</(?:a|span)>',
            r2.text, _re.DOTALL,
        )
        for s in raw_snippets[:5]:
            clean = _re.sub(r"<[^>]+>", "", s).strip()
            if len(clean) > 20:
                snippets.append(clean[:300])
            if len(snippets) >= 3:
                break
    except Exception:
        pass

    return snippets[:3]


@app.post("/verify-slang")
def verify_slang(req: VerifySlangRequest, _ = Depends(rate_limit)):
    """
    Online sanity check for words the corpus-based detector flagged as
    'unknown' or 'standard'. Asks an LLM whether the word is genuinely
    Filipino slang and, if so, returns a definition + saves it to the
    discovered lexicon (with corpus enrichment).

    Flow: cache check → corpus samples + LLM → web search fallback → save.
    """
    from slang_enricher import (
        load_discovered, _build_prompt, _call_llm, _parse_response,
    )

    word = (req.word or "").lower().strip(".,!?'\" ")
    if not word or " " in word or len(word) < 2 or len(word) > 40:
        return {"is_slang": False, "reason": "invalid word"}

    # Standard Filipino/English words are never slang — skip LLM entirely.
    # is_standard_word returns False for words in AMBIGUOUS_SLANG_SEEDS (genuine
    # ambiguous words like "grabe", "solid"), so this gate won't block them.
    if is_standard_word(word):
        return {"is_slang": False, "reason": "standard_word"}

    # Already known — no need to verify
    if word in KNOWN_SLANG or word in SEED_LEXICON:
        meta = SEED_LEXICON.get(word, {})
        return {
            "is_slang":   True,
            "from_cache": True,
            "definition": meta.get("definition") or KNOWN_SLANG.get(word, ""),
            "plain":      meta.get("plain") or PLAIN_WORD.get(word),
            "formation_type": meta.get("formation_type") or get_formation_type(word),
        }
    discovered = load_discovered()
    if word in discovered:
        d = discovered[word]
        return {
            "is_slang":   True,
            "from_cache": True,
            "definition": d.get("definition", ""),
            "plain":      d.get("plain"),
            "formation_type": d.get("formation_type") or get_formation_type(word),
        }

    # Pull a few corpus examples to ground the LLM's answer
    samples: list[str] = []
    try:
        import re as _re
        from api.corpus_utils import load_posts
        pat = _re.compile(rf"\b{_re.escape(word)}\b", _re.IGNORECASE)
        for post in load_posts() or []:
            text = (post.get("text") or "").strip()
            if pat.search(text) and 15 < len(text) < 250:
                samples.append(text)
                if len(samples) >= 5:
                    break
    except Exception:
        pass

    try:
        raw    = _call_llm(_build_prompt(word, samples))
        parsed = _parse_response(raw)
    except Exception as e:
        return {"is_slang": False, "reason": f"llm_unavailable: {e}"}

    # LLM pass 1 failed — try web search and feed results back to LLM
    if not parsed:
        web_snippets = _web_search_slang(word)
        if web_snippets:
            web_context = "\n".join(f"  • {s}" for s in web_snippets)
            web_prompt = (
                f'Is "{word}" Filipino internet slang? Here are web search results:\n\n'
                f'{web_context}\n\n'
                f'Return ONLY JSON:\n'
                f'{{"is_slang": bool, "definition": "≤25 words", '
                f'"plain": "English equivalent", "origin": "1-sentence etymology or null", '
                f'"formation_type": "acronym|contraction|loanword|syllable_reversal|semantic_shift|coinage|jejemon|unknown"}}\n'
                f'Set is_slang=false if the results do not confirm Filipino slang usage.'
            )
            try:
                raw2   = _call_llm(web_prompt)
                parsed = _parse_response(raw2)
                if parsed:
                    parsed["from_web"] = True
            except Exception:
                pass

    if not parsed:
        return {"is_slang": False, "reason": "llm rejected"}

    # Persist via /learn-slang's flow (corpus-enriched, dedup, etc.)
    learn_req = LearnSlangRequest(
        word=word,
        definition=parsed.get("definition") or "",
        plain=parsed.get("plain") or None,
        origin=parsed.get("origin") or None,
        formation_type=parsed.get("formation_type") or None,
    )
    learn_slang(learn_req)

    return {
        "is_slang":     True,
        "from_cache":   False,
        "from_web":     parsed.get("from_web", False),
        "definition":   parsed.get("definition", ""),
        "plain":        parsed.get("plain"),
        "formation_type": parsed.get("formation_type") or get_formation_type(word),
    }


@app.post("/translate")
def translate_sentence(req: TranslateRequest, _ = Depends(rate_limit)):
    """
    Full English translation of a Filipino/Taglish sentence.
    Uses the LLM to produce a natural, fluent English rendering —
    not just slang-word substitution.
    """
    from slang_enricher import _call_llm

    sentence = (req.sentence or "").strip()
    if not sentence:
        raise HTTPException(400, "No sentence provided")
    if len(sentence) > 1000:
        raise HTTPException(400, "Sentence too long (max 1000 chars)")

    prompt = (
        "Translate the following Filipino/Tagalog sentence into natural, fluent English. "
        "Output ONLY the English translation — no explanation, no quotation marks, no extra text.\n\n"
        f"Filipino: {sentence}\nEnglish:"
    )
    try:
        raw = _call_llm(prompt)
        translation = raw.strip().strip('"').strip("'").strip()
        return {"translation": translation}
    except Exception as e:
        raise HTTPException(503, f"Translation unavailable: {e}")


def _blocking_learn(req: "LearnSlangRequest") -> dict:
    """
    All the heavy work for /learn-slang — corpus scan, FastText lookup,
    file write — runs in a thread-pool executor so the event loop stays free.
    Called exclusively by _learn_worker.
    """
    """
    Tutor auto-learning: when the chatbot defines a slang the lexicon doesn't
    know, the chat route POSTs here to persist it into discovered_slang.json.

    Before saving, we ALSO mine the corpus for the word — pulling a real
    example sentence, the closest standard-word neighbor (plain English
    fallback), and a corpus-derived formation type. This means the dictionary
    entry is grounded in actual data even when the LLM's metadata is sparse.
    """
    import orjson, re
    from slang_enricher import DISCOVERED_PATH, load_discovered
    from api.corpus_utils import load_posts

    word = (req.word or "").lower().strip()
    if not word or " " in word or len(word) < 2 or len(word) > 40:
        return {"saved": False, "reason": "invalid word"}
    if word in KNOWN_SLANG or word in SEED_LEXICON:
        return {"saved": False, "reason": "already in seed lexicon"}

    # Quick, lock-free pre-check — gives a fast path for the common
    # "already discovered" case without serializing every request.
    if word in load_discovered():
        return {"saved": False, "reason": "already discovered"}

    # ── Corpus enrichment ──────────────────────────────────────────────
    corpus_example: str | None = None
    corpus_plain:   str | None = None
    corpus_count:   int        = 0

    posts = load_posts()
    if posts:
        try:
            pat = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
            for post in posts:
                text = post.get("text", "") or ""
                if not pat.search(text):
                    continue
                corpus_count += 1
                if corpus_example is None:
                    for sent in re.split(r"[.!?\n]+", text):
                        sent = sent.strip()
                        if pat.search(sent) and 15 < len(sent) < 220:
                            corpus_example = sent
                            break
                # cheap cap — we only need one good example
                if corpus_example and corpus_count >= 50:
                    break
        except Exception:
            pass

    # Closest standard-word neighbor from FastText (plain-English approximation)
    if _detector and _detector.model and word in _detector.model.wv:
        try:
            for n_word, _ in _detector.model.wv.most_similar(word, topn=20):
                if is_standard_word(n_word) and n_word != word:
                    corpus_plain = n_word
                    break
        except Exception:
            pass

    # ── Merge LLM metadata with corpus signals (corpus fills gaps) ─────
    entry = {
        "definition":     (req.definition or "").strip(),
        "plain":          (req.plain or "").strip() or corpus_plain,
        "pos":            (req.pos or "").strip() or None,
        "origin":         (req.origin or "").strip() or None,
        # Prefer a real corpus example over the LLM's invented one
        "example":        corpus_example or (req.example or "").strip() or None,
        "formation_type": (req.formation_type or get_formation_type(word) or "unknown"),
        "source":         "tutor_auto_learn",
        "corpus_count":   corpus_count,
        "corpus_grounded": corpus_count > 0,
    }

    # ── Atomic read-modify-write under a process-wide lock ─────────────
    # Without this, parallel /verify-slang calls each load → mutate → write
    # the same file and the last writer wins (clobbering siblings).
    with _lexicon_write_lock:
        discovered = load_discovered()
        if word in discovered:
            # Lost a race — another concurrent request already added it
            return {"saved": False, "reason": "already discovered"}
        discovered[word] = entry
        DISCOVERED_PATH.parent.mkdir(exist_ok=True)
        DISCOVERED_PATH.write_bytes(orjson.dumps(discovered, option=orjson.OPT_INDENT_2))

    # ── Hot-merge into the live lexicon so the next /analyze call classifies
    # this word as slang immediately, without waiting for an API restart.
    _merge_entry(word, entry, overwrite=True)

    # ── Also upsert into SEED_LEXICON so /lexicon reflects it right away ─
    SEED_LEXICON[word] = entry

    # ── Incrementally update the RAG index with the new word ────────────
    try:
        import rag_store
        rag_store.add_entry(word, entry)
    except Exception:
        pass

    # ── Bust the Vercel lexicon cache so the dictionary page updates within
    # seconds instead of waiting for the 60-second TTL to expire ──────────
    _revalidate_frontend()

    return {"saved": True, "word": word, "corpus_count": corpus_count, "corpus_grounded": corpus_count > 0}


@app.post("/learn-slang")
async def learn_slang(req: LearnSlangRequest, _ = Depends(rate_limit)):
    """
    Enqueues the learn task and returns immediately (non-blocking).
    The async worker (_learn_worker) processes tasks one at a time,
    preventing file-write races and keeping the event loop unblocked.
    """
    word = (req.word or "").lower().strip()
    if not word or " " in word or len(word) < 2 or len(word) > 40:
        return {"queued": False, "reason": "invalid word"}
    if word in KNOWN_SLANG or word in SEED_LEXICON:
        return {"queued": False, "reason": "already in seed lexicon"}
    from slang_enricher import load_discovered
    if word in load_discovered():
        return {"queued": False, "reason": "already discovered"}
    await _learn_queue.put(req)
    return {"queued": True, "word": word, "queue_size": _learn_queue.qsize()}


@app.post("/train")
def train():
    """Trigger an incremental retrain on the current corpus and hot-reload."""
    from model_pipeline import PinoySpeakPipeline
    from gensim.models import FastText as _FastText
    try:
        ok = PinoySpeakPipeline().train(data_path=_DATA_PATH, model_path=_MODEL_PATH)
        if ok and _detector and os.path.exists(_MODEL_PATH):
            _detector.model = _FastText.load(_MODEL_PATH, mmap='r')
            _detector.word_freq_map = None  # invalidate; rebuilt lazily on demand
        vocab = len(_detector.model.wv) if _detector and _detector.model else 0
        return {"success": ok, "vocab": vocab}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/define")
def define_word(word: str, _ = Depends(rate_limit)):
    """
    Derives a word's meaning purely from the corpus and FastText embeddings:
      - plain English  → closest standard-word neighbor in embedding space
      - context words  → most frequent co-occurring words in a ±5-token window
      - examples       → real sentences from the corpus containing the word
    Falls back to the hardcoded KNOWN_SLANG / PLAIN_WORD entries when available.
    """
    w = word.lower().strip(".,!? ")

    out: dict = {
        "word": w,
        "in_dictionary":  w in KNOWN_SLANG,
        "formation_type": get_formation_type(w),
        "description":    KNOWN_SLANG.get(w),
        "plain":          PLAIN_WORD.get(w),
        "plain_from_model": None,
        "neighbors":      [],
        "context_words":  [],
        "examples":       [],
    }

    # ── 1. FastText: nearest neighbours → plain English approximation ──────────
    if _detector and _detector.model and w in _detector.model.wv:
        try:
            neighbors = _detector.model.wv.most_similar(w, topn=20)
            out["neighbors"] = [n for n, _ in neighbors[:8]]
            for n_word, _ in neighbors:
                if is_standard_word(n_word) and n_word != w:
                    out["plain_from_model"] = n_word
                    if not out["plain"]:          # only override if nothing hardcoded
                        out["plain"] = n_word
                    break
        except Exception:
            pass

    # ── 2. Corpus: example sentences + context-window word counts ─────────────
    posts = load_posts()
    if posts:
        try:
            import re
            from collections import Counter as Ctr

            pat  = re.compile(rf"\b{re.escape(w)}\b", re.IGNORECASE)
            STOP = _STOP_WORDS

            examples:  list[str] = []
            ctx_all:   list[str] = []
            scanned = 0

            for post in posts:
                text = post.get("text", "")
                if not pat.search(text):
                    continue

                # Best sentence containing the word
                if len(examples) < 5:
                    for sent in re.split(r"[.!?\n]+", text):
                        sent = sent.strip()
                        if pat.search(sent) and 15 < len(sent) < 250:
                            examples.append(sent)
                            break

                # Context window ±5 tokens (include alphanumeric for number-slang like su10, 67)
                tokens = re.findall(r"\b[a-z0-9]{2,}\b", text.lower())
                for i, tok in enumerate(tokens):
                    if tok == w:
                        window = tokens[max(0, i - 5):i] + tokens[i + 1:i + 6]
                        ctx_all.extend(
                            t for t in window
                            if t not in STOP and t != w and len(t) > 2
                        )

                scanned += 1
                if scanned >= 600 and len(examples) >= 3:
                    break

            out["examples"] = examples
            out["context_words"] = [cw for cw, _ in Ctr(ctx_all).most_common(10)]

        except Exception:
            pass  # corpus unavailable — return what we have

    return out


@app.get("/lexicon")
def lexicon():
    """
    Returns the full combined slang lexicon: seed words (from slang_seeds.json)
    merged with any auto-discovered words (from discovered_slang.json).
    Each entry carries all metadata needed by the frontend.
    """
    from slang_enricher import load_discovered
    discovered = load_discovered()

    # Start from the rich seed metadata, then layer in discovered entries
    combined: dict[str, dict] = {}
    for word, meta in SEED_LEXICON.items():
        combined[word] = {
            "definition":    meta.get("definition") or KNOWN_SLANG.get(word, ""),
            "formation_type": meta.get("formation_type") or get_formation_type(word),
            "plain":         meta.get("plain") or PLAIN_WORD.get(word),
            "pos":           meta.get("pos"),
            "origin":        meta.get("origin"),
            "example":       meta.get("example"),
            "is_ambiguous":  meta.get("is_ambiguous", False),
        }

    for word, meta in discovered.items():
        if word not in combined:
            combined[word] = {
                "definition":    meta.get("definition", ""),
                "formation_type": meta.get("formation_type") or get_formation_type(word),
                "plain":         meta.get("plain"),
                "pos":           meta.get("pos"),
                "origin":        meta.get("origin"),
                "example":       meta.get("example"),
                "is_ambiguous":  meta.get("formation_type") == "semantic_shift",
            }

    # Only surface words that actually appear in the scraped corpus.
    # scan_corpus() uses word-boundary regex, so single-word slang must appear
    # as a standalone token. Multi-word phrases use a substring check against posts.
    counts, _ = scan_corpus()
    _posts_cache = None  # lazily loaded only for multi-word phrases

    def _in_corpus(word: str) -> bool:
        if " " in word:
            nonlocal _posts_cache
            if _posts_cache is None:
                _posts_cache = load_posts()
            kw = word.lower()
            return any(kw in (p.get("text") or "").lower() for p in _posts_cache)
        return counts.get(word, 0) > 0

    filtered = {
        w: v for w, v in combined.items()
        if _in_corpus(w)
        and w not in _STANDARD_FIL_BLOCKLIST
        and not _STANDARD_FIL_PREFIX_RE.match(w)
    }
    return {"entries": filtered, "count": len(filtered)}


class RelevantContextRequest(BaseModel):
    query: str
    top_k: int = 5

@app.post("/relevant-context")
def relevant_context(req: RelevantContextRequest):
    """
    RAG endpoint: given a user's chat message, returns the top-k most
    semantically relevant slang entries so the LLM gets focused context
    instead of the entire dictionary (reduces prompt tokens by ~97%).
    """
    try:
        import rag_store
        results = rag_store.query(req.query.strip(), top_k=req.top_k)
        return {"results": results}
    except Exception as e:
        return {"results": [], "error": str(e)}


@app.get("/posts")
def posts(page: int = 1, limit: int = 50, search: str = ""):
    try:
        all_posts = load_posts()
        if search.strip():
            import re as _re
            kw = _re.escape(search.strip().lower())
            _pat = _re.compile(r'\b' + kw + r'\b')
            all_posts = [p for p in all_posts if _pat.search((p.get("text") or "").lower())]
        total = len(all_posts)
        all_posts = sorted(all_posts, key=lambda p: p.get("date") or "", reverse=True)
        page_posts = all_posts[(page - 1) * limit : page * limit]
        records = [
            {
                "text":   p.get("text"),
                "date":   p.get("date"),
                "author": p.get("user"),
                "likes":  p.get("likes"),
                "source": p.get("source"),
            }
            for p in page_posts
        ]
        return {"posts": records, "total": total}
    except Exception as e:
        raise HTTPException(500, str(e))


class IngestPost(BaseModel):
    text:   str
    date:   str | None = None
    user:   str | None = None
    likes:  int        = 0
    source: str        = "local"


@app.post("/ingest-posts")
def ingest_posts(posts: list[IngestPost], request: Request):
    """
    Accepts a batch of posts from the local scraper and inserts them into
    corpus.db. Protected by INGEST_KEY env var — pass it as X-Ingest-Key header.
    """
    expected_key = os.getenv("INGEST_KEY", "")
    if expected_key:
        provided = request.headers.get("x-ingest-key", "")
        if provided != expected_key:
            raise HTTPException(status_code=403, detail="Invalid ingest key")

    import sqlite3
    from datetime import date as _date
    conn   = sqlite3.connect(_DATA_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT UNIQUE, date TEXT, user TEXT, likes INTEGER, source TEXT
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date)")

    new_count = 0
    for p in posts:
        text = (p.text or "").strip()
        if not text:
            continue
        d = str(p.date)[:10] if p.date else str(_date.today())
        try:
            cursor.execute(
                "INSERT INTO posts (text, date, user, likes, source) VALUES (?,?,?,?,?)",
                (text, d, p.user, p.likes, p.source),
            )
            new_count += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    cursor.execute("SELECT COUNT(*) FROM posts")
    total = cursor.fetchone()[0]
    conn.close()
    return {"new": new_count, "received": len(posts), "total_in_db": total}
