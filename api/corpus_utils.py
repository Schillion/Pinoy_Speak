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
    # Common standard Tagalog words that are OOV for English NLP models but not slang
    'sobrang','talaga','grabe','naman','kasi','kahit','hanggang','habang',
    'dahil','ngayon','gawa','gabi','umaga','hapon','tanghali','bukas','kahapon',
    'taon','araw','bata','tao','lugar','bahay','puso','isip','buhay',
    # High-frequency standard Tagalog particles / pronouns / conjunctions
    'muna','sayo','natin','namin','niyo','niya','sana','para','kung',
    'pag','kapag','tapos','parang','siguro','mismo','lahat','talagang',
    'bagay','mismo','talaga','ngayon','yun','iyon','ito','yan','doon',
    # Time words
    'kagabi','kanina','mamaya','maaga','hatinggabi','dati','dating',
    # Common adjectives / states
    'masaya','malungkot','galit','takot','pagod','gutom','antok','mahal',
    'hirap','mahirap','bago','luma','malaki','maliit','mabilis','mabagal',
    'maganda','pangit','mabuti','masama','magaling','matalino','mabait',
    'masipag','tamad','matapang','mainit','malamig','tahimik','masarap',
    # Common nouns
    'kaibigan','kasama','kapwa','barkada','kalaban','pera','trabaho','oras',
    'linggo','buwan','kwento','problema','sagot','tanong','laro','pagkain',
    # Common verbs / actions
    'kain','inom','tulog','gising','lakad','takbo','iyak','tawa','kanta',
    'sayaw','luto','laba','linis','gusto',
    # Filipino interjections / exclamations (never slang)
    'aray','aba','abah','hoy','nako','naku','sus','hay','hays','hala','halah',
    # Location / question contractions
    'asan','nasa','saan','kailan','bakit','paano','gaano',
    # Commonly misclassified adjectives / states
    'atat','bored','busy','cute','sweet','chill','sure',
    'medyo','masyado','sapat','lalo','lubos','tunay',
    # Filipino nouns (household / nature / places)
    'bahay','kusina','sala','kwarto','banyo','pinto','bintana',
    'mesa','silya','higaan','unan','kumot',
    'tubig','gatas','kanin','ulam','tinapay','isda','karne','gulay',
    'prutas','asin','asukal','ilaw','ulan','hangin','araw','bituin',
    'langit','lupa','dagat','ilog','bundok','bukid','kalye',
    # Common Filipino verbs
    'punta','uwi','balik','akyat','baba','talon','ligo','suot','kuha',
    'bigay','tanggap','ayos','basa','sulat','usap','tingin','tawag',
    'hanap','hintay','alam','kilala','intindi','alala','sama',
    # Relationship / social words
    'ate','kuya','lola','lolo','tita','tito','pinsan','kapatid',
    'asawa','anak','magulang','nanay','tatay','mama','papa',
}

_RE_WORD = re.compile(r"\b[a-z]{3,}\b")

# File-mtime-based caches — invalidated automatically when corpus.db changes.
_corpus_cache: tuple[Counter, int] | None = None
_corpus_cache_mtime: float = 0.0
_posts_cache: list[dict] | None = None
_posts_cache_mtime: float = 0.0
_today_cache: tuple[Counter, int] | None = None
_today_cache_date: str = ""


def load_posts() -> list[dict]:
    """Returns recent posts (last 50k rows), cached by file mtime."""
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
        cursor.execute(
            "SELECT text, date, user, likes, source FROM posts "
            "ORDER BY rowid DESC LIMIT 50000"
        )
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
        import sqlite3

        conn = sqlite3.connect(_DATA_PATH)
        cursor = conn.cursor()

        # Efficient total — no need to load all rows
        cursor.execute("SELECT COUNT(*) FROM posts")
        total = cursor.fetchone()[0]

        # Word frequency — sample 50k recent rows for accurate overall ranking
        all_words: list[str] = []
        for (text,) in cursor.execute(
            "SELECT text FROM posts ORDER BY rowid DESC LIMIT 50000"
        ):
            if text:
                all_words.extend(_RE_WORD.findall(str(text).lower()))
        conn.close()

        counts = Counter(w for w in all_words if w not in _STOP_WORDS)
        _corpus_cache = (counts, total)
        _corpus_cache_mtime = mtime
        return _corpus_cache
    except Exception:
        return Counter(), 0


def scan_corpus_today() -> tuple[Counter, int]:
    """Scans only today's posts, cached for the current calendar day."""
    global _today_cache, _today_cache_date
    from datetime import date as _date
    today = _date.today().isoformat()
    if _today_cache is not None and _today_cache_date == today:
        return _today_cache
    try:
        import sqlite3
        conn = sqlite3.connect(_DATA_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM posts WHERE date = ?", (today,))
        total = cursor.fetchone()[0]
        all_words: list[str] = []
        for (text,) in cursor.execute("SELECT text FROM posts WHERE date = ?", (today,)):
            if text:
                all_words.extend(_RE_WORD.findall(str(text).lower()))
        conn.close()
        counts = Counter(w for w in all_words if w not in _STOP_WORDS)
        _today_cache = (counts, total)
        _today_cache_date = today
        return _today_cache
    except Exception:
        return Counter(), 0


def get_top_slang(model, n: int = 15, period: str = "overall") -> list[dict]:
    counts, _ = scan_corpus_today() if period == "today" else scan_corpus()
    if not counts:
        return []

    seen: set[str] = set()
    results: list[tuple[str, int]] = []

    # most_common() is already descending — no sort needed after this pass
    for word, count in counts.most_common():
        if count < 3:
            break
        if word in AMBIGUOUS_SLANG_SEEDS and word not in seen and not is_standard_word(word):
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
                if is_oov and not is_standard_word(word):
                    results.append((word, count))
                    seen.add(word)
        results.sort(key=lambda x: x[1], reverse=True)

    return [
        {"word": w, "count": c, "definition": KNOWN_SLANG.get(w), "plain_word": PLAIN_WORD.get(w)}
        for w, c in results[:n]
    ]
