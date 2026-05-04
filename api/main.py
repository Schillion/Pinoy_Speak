"""
FastAPI ML service — run with:  uvicorn api.main:app --reload --port 8000
Exposes the SlangDetector and corpus utilities over HTTP for the Next.js frontend.
"""
from contextlib import asynccontextmanager
import sys, os, threading
import time as _time

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

    SIZE_DELTA      = 200_000   # ~300–500 new posts trigger retrain
    CHECK_INTERVAL  = 120       # seconds between model-watch ticks
    SCRAPE_INTERVAL = 600       # seconds between Reddit scrape rounds
    AUDIT_INTERVAL  = 3600      # re-audit discovered lexicon every hour

    pipeline         = PinoySpeakPipeline()
    last_model_mtime = 0.0
    last_corpus_size = 0
    last_scrape_at   = 0.0
    last_audit_at    = 0.0

    while True:
        _time.sleep(CHECK_INTERVAL)
        try:
            # ── 1. Hot-reload when model updated externally ──────────────────
            if os.path.exists(_MODEL_PATH):
                m_mtime = os.path.getmtime(_MODEL_PATH)
                if last_model_mtime and m_mtime != last_model_mtime and _detector:
                    _detector.model = _FastText.load(_MODEL_PATH)
                    _detector.word_freq_map = _detector._build_frequency_map(_DATA_PATH)
                    try:
                        _detector.classify_word.cache_clear()
                    except AttributeError:
                        pass
                last_model_mtime = m_mtime

            # ── 2. Scrape new Reddit posts every SCRAPE_INTERVAL ────────────
            now = _time.time()
            if now - last_scrape_at >= SCRAPE_INTERVAL:
                scrape_reddit(CORE_SUBREDDITS, limit=100, pages=3, workers=3)
                merge_all_sources()
                last_scrape_at = now

            # ── 3. Retrain when corpus has grown enough ──────────────────────
            if os.path.exists(_DATA_PATH):
                c_size = os.path.getsize(_DATA_PATH)
                if not last_corpus_size:
                    last_corpus_size = c_size
                elif c_size - last_corpus_size >= SIZE_DELTA:
                    ok = pipeline.train(data_path=_DATA_PATH, model_path=_MODEL_PATH)
                    if ok and _detector and os.path.exists(_MODEL_PATH):
                        _detector.model = _FastText.load(_MODEL_PATH)
                        _detector.word_freq_map = _detector._build_frequency_map(_DATA_PATH)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detector
    try:
        _detector = SlangDetector()
    except Exception as e:
        print(f"[startup] SlangDetector init failed (no model/data yet): {e}")
        print("[startup] API is running but analysis endpoints need data/social_model.model")
        _detector = None
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
        classification, reason = _detector.classify_word(clean_tok, _neighbors=neighbors)
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
def word_trends(words: str = "", days: int = 30):
    """
    Returns per-day occurrence counts for the requested words across the
    last N days. Powers the Word Popularity chart on the Overview page —
    the time-series the corpus already has, not the client-side mock.

    Query: ?words=grabe,feels,extra&days=30
    Shape: { days: ["2026-04-01", ...], series: { grabe: [...], feels: [...] } }
    """
    if not _detector or _detector.word_freq_map is None or _detector.word_freq_map.empty:
        return {"days": [], "series": {}, "available": False}

    requested = [w.strip().lower() for w in (words or "").split(",") if w.strip()]
    if not requested:
        return {"days": [], "series": {}, "available": True}

    days = max(1, min(days, 365))

    fm = _detector.word_freq_map
    # Tail to the last N days. Index is dates (datetime.date objects).
    if len(fm) > days:
        fm = fm.tail(days)

    day_labels = [
        d.isoformat() if hasattr(d, "isoformat") else str(d)
        for d in fm.index
    ]

    series: dict[str, list[int]] = {}
    for word in requested:
        if word in fm.columns:
            series[word] = [int(v) for v in fm[word].tolist()]
        else:
            # Word never appeared in the corpus — return zeros so the chart
            # still draws a flat line instead of dropping the legend entry.
            series[word] = [0] * len(day_labels)

    return {"days": day_labels, "series": series, "available": True}


@app.get("/top-slang")
def top_slang(n: int = 15):
    if not _detector or not _detector.model:
        raise HTTPException(503, "Model not loaded")
    words = get_top_slang(_detector.model, n)
    return {"words": words}


@app.get("/corpus-stats")
def corpus_stats():
    counts, total = scan_corpus()
    top = next((w for w, _ in counts.most_common(500) if w in AMBIGUOUS_SLANG_SEEDS), "—")
    return {"total_posts": total, "top_slang": top, "slang_count": len(AMBIGUOUS_SLANG_SEEDS)}


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

    candidates, diagnostics = gather_candidates_from_sources(sources)

    # Drop anything already in the lexicon or in standard dictionaries
    discovered_now = load_discovered()
    already_known = (
        set(KNOWN_SLANG) | set(SEED_LEXICON) | set(discovered_now)
    )

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


@app.post("/verify-slang")
def verify_slang(req: VerifySlangRequest, _ = Depends(rate_limit)):
    """
    Online sanity check for words the corpus-based detector flagged as
    'unknown' or 'standard'. Asks an LLM whether the word is genuinely
    Filipino slang and, if so, returns a definition + saves it to the
    discovered lexicon (with corpus enrichment).

    Designed to be called from the translator for any token classified
    as 'unknown' so real slang isn't missed just because it isn't
    trending in our local corpus yet.
    """
    from slang_enricher import (
        load_discovered, _build_prompt, _call_llm, _parse_response,
    )

    word = (req.word or "").lower().strip(".,!?'\" ")
    if not word or " " in word or len(word) < 2 or len(word) > 40:
        return {"is_slang": False, "reason": "invalid word"}

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
        "is_slang":   True,
        "from_cache": False,
        "definition": parsed.get("definition", ""),
        "plain":      parsed.get("plain"),
        "formation_type": parsed.get("formation_type") or get_formation_type(word),
    }


@app.post("/learn-slang")
def learn_slang(req: LearnSlangRequest, _ = Depends(rate_limit)):
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

    return {"saved": True, "word": word, "corpus_count": corpus_count, "corpus_grounded": corpus_count > 0}


@app.post("/train")
def train():
    """Trigger an incremental retrain on the current corpus and hot-reload."""
    from model_pipeline import PinoySpeakPipeline
    from gensim.models import FastText as _FastText
    try:
        ok = PinoySpeakPipeline().train(data_path=_DATA_PATH, model_path=_MODEL_PATH)
        if ok and _detector and os.path.exists(_MODEL_PATH):
            _detector.model = _FastText.load(_MODEL_PATH)
            _detector.word_freq_map = _detector._build_frequency_map(_DATA_PATH)
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

    return {"entries": combined, "count": len(combined)}


@app.get("/posts")
def posts(page: int = 1, limit: int = 50, search: str = ""):
    from api.corpus_utils import _DATA_PATH
    if not os.path.exists(_DATA_PATH):
        return {"posts": [], "total": 0}
    try:
        df = pd.read_json(_DATA_PATH, dtype=False, convert_dates=False)
        df["date"] = df["date"].apply(lambda d: d if isinstance(d, str) and len(d) == 10 else None)
        if search.strip():
            df = df[df["text"].str.contains(search.strip(), case=False, na=False)]
        total = len(df)
        df = df.sort_values("date", ascending=False).iloc[(page - 1) * limit : page * limit]
        records = df.rename(columns={"user": "author"})[["text", "date", "author", "likes", "source"]].to_dict("records")
        return {"posts": records, "total": total}
    except Exception as e:
        raise HTTPException(500, str(e))
