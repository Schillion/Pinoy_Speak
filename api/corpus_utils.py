import os, re

from collections import Counter
from dictionary_service import KNOWN_SLANG, PLAIN_WORD, is_standard_word, AMBIGUOUS_SLANG_SEEDS

_DATA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "corpus.db")

_STOP_WORDS = {
    'the','and','for','are','but','not','you','all','can','has','her',
    'was','one','our','out','day','get','him','his','how','its','may',
    'new','now','old','see','two','who','did','man','let','put','say',
    'too','use','ang','nga','nag','din','rin','ito','siya','ako','ka',
    'ko','mo','na','ng','sa','mga','ay','lang','yung','kasi','dito',
    'nila','kami','tayo','kayo','sila','wala','pag','naman','para',
    'kung','niya','daw','raw','pala','talaga','pero','kaya','bakit',
    'nito','that','this','with','have','from','they','been','were',
    'will','what','when','your','more','also','some','than','then',
    'just','like','into','over','after','about','very',
    # short function words caught by 2-char corpus patterns
    'an','is','it','in','of','to','be','si','ni','po','ung','dun','sana',
}

_RE_WORD = re.compile(r"\b[a-z]{3,}\b")

# File-mtime-based caches — invalidated automatically when corpus.db changes.
_corpus_cache: tuple[Counter, int] | None = None
_corpus_cache_mtime: float = 0.0
_posts_cache: list[dict] | None = None
_posts_cache_mtime: float = 0.0


def load_posts() -> list[dict]:
    """Returns the raw posts list, cached by file mtime."""
    global _posts_cache, _posts_cache_mtime
    try:
        mtime = os.path.getmtime(_DATA_PATH)
    except OSError:
        return []
    if _posts_cache is not None and mtime == _posts_cache_mtime:
        return _posts_cache
    try:
        import sqlite3
        conn = sqlite3.connect(_DATA_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT text, date, user, likes, source FROM posts")
        rows = cursor.fetchall()
        _posts_cache = [dict(r) for r in rows]
        conn.close()
        _posts_cache_mtime = mtime
        return _posts_cache
    except Exception:
        return []


def scan_corpus() -> tuple[Counter, int]:
    global _corpus_cache, _corpus_cache_mtime
    try:
        mtime = os.path.getmtime(_DATA_PATH)
    except OSError:
        return Counter(), 0

    if _corpus_cache is not None and mtime == _corpus_cache_mtime:
        return _corpus_cache

    try:
        posts = load_posts()
        total = len(posts)
        all_words: list[str] = []
        for post in posts:
            if "text" in post and post["text"]:
                all_words.extend(_RE_WORD.findall(str(post["text"]).lower()))
        counts = Counter(w for w in all_words if w not in _STOP_WORDS)
        _corpus_cache = (counts, total)
        _corpus_cache_mtime = mtime
        return _corpus_cache
    except Exception:
        return Counter(), 0


def get_top_slang(model, n: int = 15) -> list[dict]:
    counts, _ = scan_corpus()
    if not counts:
        return []

    seen: set[str] = set()
    results: list[tuple[str, int]] = []

    # most_common() is already descending — no sort needed after this pass
    for word, count in counts.most_common():
        if count < 3:
            break
        if word in AMBIGUOUS_SLANG_SEEDS and word not in seen:
            results.append((word, count))
            seen.add(word)

    if len(results) < n and model:
        from dictionary_service import NLP
        # Collect candidates first, then batch through NLP in one pipe call
        candidates = [
            (word, count) for word, count in counts.most_common(300)
            if count >= 5 and word not in seen and word in model.wv
        ]
        if candidates:
            oov_flags = [doc[0].is_oov for doc in NLP.pipe(w for w, _ in candidates)]
            for (word, count), is_oov in zip(candidates, oov_flags):
                if len(results) >= n:
                    break
                if is_oov:
                    results.append((word, count))
                    seen.add(word)
        results.sort(key=lambda x: x[1], reverse=True)

    return [
        {"word": w, "count": c, "definition": KNOWN_SLANG.get(w), "plain_word": PLAIN_WORD.get(w)}
        for w, c in results[:n]
    ]
