"""
Run this on your LOCAL machine (not the server) to scrape Reddit + YouTube
and push the new posts to the live Fly.io server.

Your home/office IP is not blocked by Reddit. The server's IP is.

Usage:
    python local_sync.py            # scrape + upload
    python local_sync.py --upload-only   # skip scraping, just upload local DB
    python local_sync.py --scrape-only   # scrape but don't upload

Setup (one-time):
    set INGEST_KEY=<the key you set on Fly> in your environment,
    or create a .env file in this folder with: INGEST_KEY=yourkey
"""
import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime

import requests
from rich.console import Console

console = Console()

# ── Config ────────────────────────────────────────────────────────────────────
SERVER_URL   = "https://pinoyspeak-project.fly.dev"
DB_PATH      = "data/corpus.db"
SYNC_STAMP   = "data/.last_sync_ts"   # stores Unix timestamp of last upload
BATCH_SIZE   = 500                     # posts per HTTP request
# ─────────────────────────────────────────────────────────────────────────────


def _load_env():
    """Load .env file from project root if it exists."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())


def _ingest_key() -> str:
    key = os.environ.get("INGEST_KEY", "")
    if not key:
        console.print("[red]INGEST_KEY not set.[/red]")
        console.print("[dim]  Add INGEST_KEY=yourkey to a .env file or set the env var.[/dim]")
        sys.exit(1)
    return key


def _last_sync_ts() -> float:
    try:
        with open(SYNC_STAMP) as f:
            return float(f.read().strip())
    except Exception:
        return 0.0


def _save_sync_ts(ts: float):
    os.makedirs(os.path.dirname(SYNC_STAMP), exist_ok=True)
    with open(SYNC_STAMP, "w") as f:
        f.write(str(ts))


def get_new_local_posts(since_ts: float) -> list[dict]:
    """Return posts added to local DB after `since_ts` (unix timestamp)."""
    if not os.path.exists(DB_PATH):
        return []
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        # Use rowid as a cheap proxy for insertion order
        # We store the last uploaded rowid in SYNC_STAMP instead of a timestamp
        last_id = int(since_ts)  # we repurpose the field as last rowid
        cursor.execute(
            "SELECT rowid, text, date, user, likes, source FROM posts WHERE rowid > ? ORDER BY rowid",
            (last_id,),
        )
        rows = cursor.fetchall()
    except Exception:
        rows = []
    finally:
        conn.close()

    posts = []
    for row in rows:
        posts.append({
            "_rowid": row[0],
            "text":   row[1],
            "date":   row[2],
            "user":   row[3],
            "likes":  row[4],
            "source": row[5],
        })
    return posts


def upload_posts(posts: list[dict], key: str) -> int:
    """Upload posts to the server in batches. Returns count of new posts added."""
    total_new = 0
    headers = {"x-ingest-key": key, "Content-Type": "application/json"}

    for i in range(0, len(posts), BATCH_SIZE):
        batch = posts[i : i + BATCH_SIZE]
        payload = [
            {k: v for k, v in p.items() if k != "_rowid"}
            for p in batch
        ]
        try:
            r = requests.post(
                f"{SERVER_URL}/ingest-posts",
                json=payload,
                headers=headers,
                timeout=60,
            )
            if r.status_code == 200:
                data = r.json()
                total_new += data.get("new", 0)
                console.print(
                    f"[dim]  Batch {i // BATCH_SIZE + 1}: "
                    f"+{data.get('new', 0)} new / {len(batch)} sent "
                    f"(server total: {data.get('total_in_db', '?')})[/dim]"
                )
            elif r.status_code == 403:
                console.print("[red]❌ Wrong INGEST_KEY — check your .env file[/red]")
                sys.exit(1)
            else:
                console.print(f"[red]  Batch {i // BATCH_SIZE + 1}: HTTP {r.status_code}[/red]")
        except requests.exceptions.RequestException as e:
            console.print(f"[red]  Upload error: {e}[/red]")

    return total_new


def run_scrapers():
    console.print("\n[bold cyan]─── Scraping Reddit (local IP — no block) ───[/bold cyan]")
    from data_collection import scrape_reddit, REDDIT_SUBREDDITS
    scrape_reddit(REDDIT_SUBREDDITS, limit=100, pages=10, workers=5)

    console.print("\n[bold cyan]─── Scraping YouTube ───[/bold cyan]")
    from youtube_scraper import scrape_youtube
    scrape_youtube()


def main():
    _load_env()
    parser = argparse.ArgumentParser(description="Local scrape + sync to Fly.io server")
    parser.add_argument("--upload-only", action="store_true", help="Skip scraping, just upload")
    parser.add_argument("--scrape-only", action="store_true", help="Scrape but don't upload")
    args = parser.parse_args()

    key       = _ingest_key()
    last_id   = int(_last_sync_ts())

    if not args.upload_only:
        run_scrapers()

    if args.scrape_only:
        console.print("[yellow]--scrape-only set, skipping upload.[/yellow]")
        return

    new_posts = get_new_local_posts(last_id)
    if not new_posts:
        console.print("[green]✓ Nothing new to upload.[/green]")
        return

    console.print(
        f"\n[bold cyan]─── Uploading {len(new_posts):,} posts → {SERVER_URL} ───[/bold cyan]"
    )
    total_new = upload_posts(new_posts, key)

    # Save the highest rowid we've uploaded
    if new_posts:
        _save_sync_ts(new_posts[-1]["_rowid"])

    console.print(
        f"\n[bold green]✓ Done — {total_new:,} new posts added to server.[/bold green]"
    )


if __name__ == "__main__":
    main()
