import requests
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, date
from rich.console import Console

console = Console()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRAPE_SINCE      = date(2025, 8, 1)   # ignore posts older than this
COMMENT_MIN_SCORE = 3                   # only fetch comments for posts with score >= this
REQUEST_TIMEOUT   = 15                  # seconds

# Arctic Shift — free Reddit archive API that works from cloud IPs.
# Replaces the raw reddit.com/r/sub.json endpoint which is blocked on Fly.io.
ARCTIC_BASE    = "https://arctic-shift.photon-reddit.com/api"
ARCTIC_HEADERS = {"User-Agent": "PinoySpeak/1.0 language-research"}

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


def _to_ts(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


# ---------------------------------------------------------------------------
# Arctic Shift — fetch posts for one subreddit
# ---------------------------------------------------------------------------

def _fetch_arctic_sub(sub: str, since: date, pages: int = 3,
                      limit: int = 100) -> list[dict]:
    """
    Fetches posts from Arctic Shift for `sub` created on or after `since`.
    Paginates newest-first using the oldest timestamp on each page as the
    next `before` cursor, stopping when posts fall below `since`.
    """
    posts: list[dict] = []
    since_ts  = _to_ts(since)
    before_ts: int | None = None

    session = requests.Session()
    session.headers.update(ARCTIC_HEADERS)

    for _ in range(pages):
        params: dict = {
            "subreddit": sub,
            "after":     since_ts,
            "limit":     limit,
            "sort":      "created_utc",
            "order":     "desc",
        }
        if before_ts is not None:
            params["before"] = before_ts

        try:
            r = session.get(f"{ARCTIC_BASE}/posts/search",
                            params=params, timeout=REQUEST_TIMEOUT)
            if r.status_code == 429:
                time.sleep(12)
                r = session.get(f"{ARCTIC_BASE}/posts/search",
                                params=params, timeout=REQUEST_TIMEOUT)
            if r.status_code != 200:
                break

            batch = r.json().get("data", [])
            if not batch:
                break

            min_ts: int | None = None
            for post in batch:
                ts       = post.get("created_utc") or post.get("created", 0)
                ts_int   = int(float(ts)) if ts else 0
                post_date = _parse_date(_utc_to_date(ts_int))

                if post_date < since:
                    continue

                title    = post.get("title", "")
                selftext = post.get("selftext", "") or ""
                text     = (title + " " + selftext).strip().replace("\n", " ")
                if not text:
                    continue

                posts.append({
                    "text":   text,
                    "date":   _utc_to_date(ts_int),
                    "user":   post.get("author"),
                    "likes":  post.get("score", 0),
                    "source": "reddit",
                    "_id":    post.get("id", ""),
                    "_sub":   sub,
                })

                if ts_int and (min_ts is None or ts_int < min_ts):
                    min_ts = ts_int

            if min_ts is None or min_ts <= since_ts:
                break  # reached the cutoff — nothing older to fetch
            before_ts = min_ts - 1
            time.sleep(0.5)

        except Exception as e:
            console.print(f"[red]Arctic r/{sub}: {e}[/red]")
            break

    return posts


# ---------------------------------------------------------------------------
# Arctic Shift — fetch comments for a batch of post IDs
# ---------------------------------------------------------------------------

def _fetch_arctic_comments(post_ids: list[str]) -> list[dict]:
    """Fetch top comments for a list of post IDs via Arctic Shift."""
    comments: list[dict] = []
    if not post_ids:
        return comments

    session = requests.Session()
    session.headers.update(ARCTIC_HEADERS)

    # Arctic Shift accepts up to ~20 link IDs at a time
    for i in range(0, len(post_ids), 20):
        batch = post_ids[i : i + 20]
        try:
            r = session.get(
                f"{ARCTIC_BASE}/comments/search",
                params={"link_id": ",".join(f"t3_{pid}" for pid in batch), "limit": 100},
                timeout=REQUEST_TIMEOUT,
            )
            if r.status_code != 200:
                continue
            for c in r.json().get("data", []):
                body = (c.get("body") or "").strip().replace("\n", " ")
                if not body or body in ("[deleted]", "[removed]"):
                    continue
                comments.append({
                    "text":   body,
                    "date":   _utc_to_date(c.get("created_utc") or c.get("created", 0)),
                    "user":   c.get("author"),
                    "likes":  c.get("score", 0),
                    "source": "reddit",
                })
            time.sleep(0.4)
        except Exception:
            pass

    return comments


# ---------------------------------------------------------------------------
# Arctic Shift — parallel subreddit scraper (drop-in for scrape_reddit)
# ---------------------------------------------------------------------------

def scrape_reddit(subreddits: list[str] = None, limit: int = 100,
                  pages: int = 3, workers: int = 3,
                  seed: bool = False,
                  output_file: str = "data/raw_reddit.json") -> list[dict]:
    if subreddits is None:
        subreddits = REDDIT_SUBREDDITS

    fetch_pages = pages * 3 if seed else pages  # seed gets more pages

    console.print(
        f"\n[bold cyan]Arctic Shift — {len(subreddits)} subreddits, "
        f"{workers} workers, {fetch_pages} pages each"
        f"{' [seed]' if seed else ''}[/bold cyan]"
    )

    all_posts: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_fetch_arctic_sub, sub, SCRAPE_SINCE, fetch_pages, limit): sub
            for sub in subreddits
        }
        completed = 0
        for future in as_completed(futures):
            completed += 1
            sub = futures[future]
            try:
                result = future.result()
                # Also fetch comments for posts with enough score
                high_score_ids = [
                    p["_id"] for p in result
                    if p.get("likes", 0) >= COMMENT_MIN_SCORE and p.get("_id")
                ]
                if high_score_ids:
                    result.extend(_fetch_arctic_comments(high_score_ids))
                all_posts.extend(result)
                console.print(
                    f"[dim]  ({completed}/{len(subreddits)}) r/{sub}: "
                    f"{len(result)} posts[/dim]"
                )
            except Exception as e:
                console.print(f"[red]  r/{sub} failed: {e}[/red]")

    return _save_and_return(all_posts, output_file, "Arctic Shift")


# ---------------------------------------------------------------------------
# Focused seed scrape — Aug 2025 → now
# ---------------------------------------------------------------------------

# 15 subreddits most likely to produce Filipino slang and code-switched text.
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


def scrape_seed_data(output_file: str = "data/raw_reddit.json",
                     workers: int = 5) -> list[dict]:
    """One-shot historical scrape. Run this once to seed the Aug 2025+ dataset."""
    console.print(
        f"\n[bold cyan]Seed Scrape — {len(CORE_SUBREDDITS)} subreddits "
        f"(Aug 2025 → now)[/bold cyan]"
    )
    return scrape_reddit(
        subreddits=CORE_SUBREDDITS,
        limit=100,
        pages=10,   # 10 pages × 100 = up to 1,000 posts/sub
        workers=workers,
        seed=True,
        output_file=output_file,
    )


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
        if not t:
            continue
        d = str(r.get('date'))[:10] if r.get('date') else str(date.today())
        u = r.get('user')
        l = r.get('likes', 0)
        s = r.get('source', 'reddit')
        try:
            cursor.execute(
                "INSERT INTO posts (text, date, user, likes, source) VALUES (?, ?, ?, ?, ?)",
                (t, d, u, l, s),
            )
            new_records.append(r)
        except sqlite3.IntegrityError:
            pass  # duplicate

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
