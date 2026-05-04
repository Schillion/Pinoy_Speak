import requests
import time
import os
import tempfile
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, date
from rich.console import Console

console = Console()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRAPE_SINCE      = date(2025, 8, 1)   # ignore posts older than this
COMMENT_WORKERS   = 5                   # parallel threads for comment fetching per task
COMMENT_MIN_SCORE = 3                   # only fetch comments for posts with score >= this
REQUEST_TIMEOUT   = 10                  # seconds

# top/year and top/all skipped — those rarely gain new posts each round
REDDIT_SORTS = [
    ("new",    None),
    ("rising", None),
    ("hot",    None),
    ("top",    "month"),
]

# top/year + top/all run once at startup to seed historical data, then skipped
REDDIT_SORTS_SEED = [
    ("top", "year"),
    ("top", "all"),
]

REDDIT_SUBREDDITS = [
    # General
    "Philippines", "CasualPH", "truePhilippines", "AskPH",
    # Student life & universities
    "studentsph", "peyups", "Tomasino", "ADMU", "dlsu", "RateUPProfs",
    # Career & finance
    "phinvest", "phcareers", "buhaydigital", "phmoneysaving",
    # Food & lifestyle
    "filipinofood", "PHitness", "beautytalkph",
    # Gaming & entertainment
    "phgaming", "PHGamers", "mobilelegendsPINAS", "PinoyAnime",
    # Music
    "OPM", "indiemusicph",
    # Memes & humor
    "PHmemes", "pinoymemes", "pinoypasttensed",
    # Entertainment & Gossip
    "ChikaPH", "TiktokPH",
    # Adulting & Support
    "adultingph", "PanganaySupportGroup", "BPOinPH",
    # Classifieds
    "phclassifieds",
    # Regional
    "Cebu", "Manila",
    # Tech & programming
    "PinoyProgrammer", "InternetPH",
    # Support & misc
    "OffMyChestPH", "MentalHealthPH", "PHsports",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_to_date(ts) -> str:
    try:
        ts = float(ts)
        if ts <= 0:
            raise ValueError
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
    except (TypeError, ValueError, OSError):
        return datetime.now(tz=timezone.utc).strftime('%Y-%m-%d')


def _parse_date(date_str: str) -> date:
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return date.today()


# ---------------------------------------------------------------------------
# Reddit — per-post comment fetch (runs inside a thread pool)
# ---------------------------------------------------------------------------

def _fetch_comments(task: tuple) -> list[dict]:
    sub, post_id, session = task
    results = []
    try:
        cr = session.get(
            f"https://www.reddit.com/r/{sub}/comments/{post_id}.json?limit=5",
            timeout=REQUEST_TIMEOUT,
        )
        parsed = cr.json() if cr.status_code == 200 else None
        if parsed and len(parsed) > 1:
            for c in parsed[1]['data']['children']:
                body = c['data'].get('body', '').strip().replace('\n', ' ')
                if body and body not in ('[deleted]', '[removed]'):
                    results.append({
                        'text':   body,
                        'date':   _utc_to_date(c['data'].get('created_utc')),
                        'user':   c['data'].get('author'),
                        'likes':  c['data'].get('score', 0),
                        'source': 'reddit',
                    })
    except Exception:
        pass
    return results


# ---------------------------------------------------------------------------
# Reddit — one (subreddit, sort) task
# ---------------------------------------------------------------------------

def _fetch_one(sub: str, sort: str, time_filter: str | None,
               limit: int, pages: int, headers: dict,
               since: date | None = None, until: date | None = None) -> list[dict]:
    effective_since = since or SCRAPE_SINCE
    posts = []
    session = requests.Session()
    session.headers.update(headers)

    after = None
    base  = f"https://www.reddit.com/r/{sub}/{sort}.json?limit={limit}"
    if time_filter:
        base += f"&t={time_filter}"

    # Single pool reused across all pages for this task
    with ThreadPoolExecutor(max_workers=COMMENT_WORKERS) as comment_pool:
        for _ in range(pages):
            url = base + (f"&after={after}" if after else "")
            try:
                r = None
                for attempt in range(3):
                    try:
                        r = session.get(url, timeout=REQUEST_TIMEOUT)
                        break
                    except requests.exceptions.Timeout:
                        if attempt < 2:
                            time.sleep(4 * (attempt + 1))
                        else:
                            raise
                if r.status_code == 429:
                    time.sleep(12)
                    r = session.get(url, timeout=REQUEST_TIMEOUT)
                if r.status_code != 200:
                    break

                data     = r.json().get('data', {})
                children = data.get('children', [])
                if not children:
                    break

                page_posts:    list[dict]  = []
                comment_tasks: list[tuple] = []
                page_all_old = True

                for post in children:
                    d             = post['data']
                    post_date_str = _utc_to_date(d.get('created_utc'))
                    post_date     = _parse_date(post_date_str)

                    if post_date < effective_since:
                        continue
                    if until and post_date > until:
                        continue
                    page_all_old = False

                    text = (d.get('title', '') + ' ' + d.get('selftext', '')).strip().replace('\n', ' ')
                    if not text:
                        continue

                    page_posts.append({
                        'text':   text,
                        'date':   post_date_str,
                        'user':   d.get('author'),
                        'likes':  d.get('score', 0),
                        'source': 'reddit',
                    })

                    if d.get('score', 0) >= COMMENT_MIN_SCORE:
                        comment_tasks.append((sub, d['id'], session))

                posts.extend(page_posts)

                if comment_tasks:
                    for comment_list in comment_pool.map(_fetch_comments, comment_tasks):
                        posts.extend(comment_list)

                # early exit for time-ordered sorts once all posts are too old
                # "top" is score-ordered, not time-ordered — never early-exit on it
                if page_all_old and sort in ("new", "rising"):
                    break

                after = data.get('after')
                if not after:
                    break

                time.sleep(0.2)

            except Exception as e:
                console.print(f"[red]r/{sub} {sort}: {e}[/red]")
                break

    return posts


# ---------------------------------------------------------------------------
# Reddit — parallel subreddit scraper
# ---------------------------------------------------------------------------

def scrape_reddit(subreddits: list[str] = None, limit: int = 100,
                  pages: int = 10, workers: int = 5,
                  seed: bool = False,
                  output_file: str = "data/raw_reddit.json") -> list[dict]:
    if subreddits is None:
        subreddits = REDDIT_SUBREDDITS

    headers = {'User-Agent': 'Mozilla/5.0 PinoySpeakBot/1.0'}
    sorts   = REDDIT_SORTS + (REDDIT_SORTS_SEED if seed else [])

    tasks = [(sub, sort, tf) for sub in subreddits for sort, tf in sorts]
    console.print(f"\n[bold cyan]Reddit — {len(tasks)} tasks, {workers} outer workers, "
                  f"{COMMENT_WORKERS} comment workers each"
                  f"{' [seed]' if seed else ''}[/bold cyan]")

    all_posts = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_fetch_one, sub, sort, tf, limit, pages, headers): (sub, sort)
            for sub, sort, tf in tasks
        }
        completed = 0
        for future in as_completed(futures):
            completed += 1
            sub, sort = futures[future]
            try:
                result = future.result()
                all_posts.extend(result)
                console.print(
                    f"[dim]  ({completed}/{len(tasks)}) r/{sub} {sort}: {len(result)} posts[/dim]"
                )
            except Exception as e:
                console.print(f"[red]  r/{sub} {sort} failed: {e}[/red]")

    return _save_and_return(all_posts, output_file, "Reddit")


# ---------------------------------------------------------------------------
# Focused seed scrape — Aug 2025 → now, targeting ≥50 posts/day
# ---------------------------------------------------------------------------

# 13 subreddits most likely to produce Filipino slang and code-switched text.
# These are used for both the initial seed scrape and ongoing collection.
CORE_SUBREDDITS = [
    # University communities — primary slang producers
    "peyups", "ADMU", "dlsu", "Tomasino", "RateUPProfs",
    # Student life & casual Taglish
    "studentsph", "CasualPH", "OffMyChestPH",
    # Young & gaming communities — high slang density
    "mobilelegendsPINAS", "phgaming", "OPM",
    # Tech-focused but heavy code-switching
    "PinoyProgrammer",
    # Gossip, Trends, & Gen Z heavy
    "ChikaPH", "TiktokPH", "BPOinPH",
]

# Per-sort page counts:
#   new  × 8 pages = 800 posts/sub  — chronological coverage across days
#   top/year × 4 pages = 400 posts/sub — most-shared posts from Aug 2025+
# 13 subs × 1 200 posts = 15 600 potential → ~50+ posts/day after dedup & filter
_SEED_TASKS: list[tuple[str, str | None, int]] = [
    ("new",  None,   8),
    ("top", "year",  4),
]


def scrape_seed_data(output_file: str = "data/raw_reddit.json",
                     workers: int = 5) -> list[dict]:
    """
    One-shot focused scrape to seed the Aug 2025+ dataset.
    Run this once before starting the continuous loop.
    """
    headers = {'User-Agent': 'Mozilla/5.0 PinoySpeakBot/1.0'}
    tasks = [
        (sub, sort, tf, pages)
        for sub in CORE_SUBREDDITS
        for sort, tf, pages in _SEED_TASKS
    ]

    console.print(
        f"\n[bold cyan]Seed Scrape — {len(CORE_SUBREDDITS)} subreddits, "
        f"{len(tasks)} tasks (Aug 2025 → now)[/bold cyan]"
    )
    console.print("[dim]  new×8 pages + top/year×4 pages per subreddit[/dim]")

    all_posts = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                _fetch_one, sub, sort, tf, 100, pages, headers, SCRAPE_SINCE
            ): (sub, sort)
            for sub, sort, tf, pages in tasks
        }
        completed = 0
        for future in as_completed(futures):
            completed += 1
            sub, sort = futures[future]
            try:
                result = future.result()
                all_posts.extend(result)
                console.print(
                    f"[dim]  ({completed}/{len(tasks)}) r/{sub} {sort}: "
                    f"{len(result)} posts[/dim]"
                )
            except Exception as e:
                console.print(f"[red]  r/{sub} {sort} failed: {e}[/red]")

    return _save_and_return(all_posts, output_file, "Seed")


# ---------------------------------------------------------------------------
# Shared save helper
# ---------------------------------------------------------------------------

def _valid_date(d) -> bool:
    return isinstance(d, str) and len(d) == 10


def _save_and_return(records: list[dict], output_file: str, label: str) -> list[dict]:
    if not records:
        console.print(f"[bold red]{label}: no data collected.[/bold red]")
        return []

    import sqlite3
    db_path = "data/corpus.db"
    out_dir = os.path.dirname(db_path) or "."
    os.makedirs(out_dir, exist_ok=True)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT UNIQUE,
        date TEXT,
        user TEXT,
        likes INTEGER,
        source TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date)")

    new_records = []
    for r in records:
        t = r.get('text')
        if not t: continue
        
        d = str(r.get('date'))[:10] if r.get('date') else str(date.today())
        u = r.get('user')
        l = r.get('likes', 0)
        s = r.get('source', 'reddit')
        
        try:
            cursor.execute("""
            INSERT INTO posts (text, date, user, likes, source)
            VALUES (?, ?, ?, ?, ?)
            """, (t, d, u, l, s))
            new_records.append(r)
        except sqlite3.IntegrityError:
            pass # already exists

    conn.commit()
    cursor.execute("SELECT COUNT(*) FROM posts")
    total = cursor.fetchone()[0]
    conn.close()

    if not new_records:
        console.print(f"[yellow]{label}: 0 new posts (all duplicates).[/yellow]")
        return []

    console.print(
        f"[bold green]{label}: +{len(new_records)} new posts "
        f"(total {total:,}) → {db_path}[/bold green]"
    )
    return new_records
