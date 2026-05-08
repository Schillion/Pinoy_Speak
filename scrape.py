"""
Terminal 1: python3 scrape.py
Continuously scrapes Reddit and writes to data/.
Safe to run alongside train.py — all file writes are atomic.
"""
import os
import signal
import time
import tempfile
import json
from rich.console import Console

from data_collection import scrape_reddit, REDDIT_SUBREDDITS
from youtube_scraper import scrape_youtube

console = Console()

REDDIT_LIMIT         = 100
REDDIT_PAGES         = 10
REDDIT_WORKERS       = 5
SLEEP_BETWEEN_ROUNDS = 30


def _handle_sigint(_sig, _frame):
    console.print("\n[bold yellow]Ctrl+C received — stopped.[/bold yellow]")
    os._exit(0)


def count_posts(path: str) -> int:
    import sqlite3
    db_path = "data/corpus.db"
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM posts")
        total = cursor.fetchone()[0]
        conn.close()
        return total
    except Exception:
        return 0


def merge_all_sources() -> str | None:
    # With SQLite migration, we no longer need to merge json files
    # data_collection directly inserts into corpus.db
    # We keep the function signature to avoid breaking automate.py
    import os
    if os.path.exists("data/corpus.db"):
        return "data/corpus.db"
    return None


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _handle_sigint)
    console.print("[bold magenta]===== SCRAPER STARTED =====[/bold magenta]")
    console.print("[bold yellow]Press Ctrl+C to stop.[/bold yellow]\n")
    round_num = 0

    while True:
        round_num += 1
        console.print(f"\n[bold cyan]─── Scrape Round {round_num} ───[/bold cyan]")

        scrape_reddit(REDDIT_SUBREDDITS, limit=REDDIT_LIMIT,
                      pages=REDDIT_PAGES, workers=REDDIT_WORKERS)

        # YouTube every 6 rounds (~3 min) to avoid hammering it
        if round_num % 6 == 1:
            scrape_youtube()

        path = merge_all_sources()
        if path:
            total = count_posts(path)
            console.print(f"[blue]Corpus: {total} total posts → {path}[/blue]")

        console.print(f"[dim]Sleeping {SLEEP_BETWEEN_ROUNDS}s...[/dim]")
        time.sleep(SLEEP_BETWEEN_ROUNDS)
