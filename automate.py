import os
import signal
import time
from rich.console import Console

from model_pipeline import PinoySpeakPipeline
from data_collection import scrape_reddit, scrape_seed_data, CORE_SUBREDDITS
from scrape import merge_all_sources, count_posts

console = Console()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REDDIT_LIMIT           = 100   # posts per page (Reddit max)
REDDIT_PAGES           = 10    # pages per sort — up to 1 000 posts per sort
REDDIT_WORKERS         = 5     # parallel threads (keep ≤5 to avoid rate-limiting)
RETRAIN_EVERY_N_POSTS  = 300   # incremental update threshold
SLEEP_BETWEEN_ROUNDS   = 30    # seconds between rounds


# ---------------------------------------------------------------------------
# Reliable Ctrl+C  (ThreadPoolExecutor blocks normal KeyboardInterrupt)
# ---------------------------------------------------------------------------

def _handle_sigint(_sig, _frame):
    console.print("\n[bold yellow]Ctrl+C received — stopping. Data and model saved.[/bold yellow]")
    os._exit(0)

signal.signal(signal.SIGINT, _handle_sigint)


# ---------------------------------------------------------------------------
# Main continuous loop
# ---------------------------------------------------------------------------

def run_continuous():
    console.print("[bold magenta]===== PINOY SPEAK — CONTINUOUS SCRAPER =====[/bold magenta]")
    console.print("[bold yellow]Press Ctrl+C at any time to stop.[/bold yellow]")
    console.print("[dim]Collecting posts from August 2025 onward.[/dim]\n")

    pipeline    = PinoySpeakPipeline()
    model_path  = "data/social_model.model"
    round_num   = 0
    posts_since_last_train = 0

    while True:
        round_num += 1
        console.print(f"\n[bold cyan]─── Round {round_num} ───[/bold cyan]")

        before = count_posts("data/corpus.db")

        # --- Scrape ---
        if round_num == 1:
            scrape_seed_data(workers=REDDIT_WORKERS)
        scrape_reddit(CORE_SUBREDDITS, limit=REDDIT_LIMIT,
                      pages=REDDIT_PAGES, workers=REDDIT_WORKERS)

        # --- Merge sources ---
        combined_path = merge_all_sources()
        if not combined_path:
            console.print("[red]No data files found. Skipping training.[/red]")
        else:
            after          = count_posts(combined_path)
            new_this_round = after - before
            posts_since_last_train += new_this_round

            console.print(
                f"[blue]Total corpus: {after:,} posts "
                f"(+{new_this_round} this round, "
                f"{posts_since_last_train} since last train)[/blue]"
            )

            if posts_since_last_train >= RETRAIN_EVERY_N_POSTS or round_num == 1:
                console.print("[bold green]Retraining model...[/bold green]")
                success = pipeline.train(data_path=combined_path, model_path=model_path)
                if success:
                    posts_since_last_train = 0
                    console.print("[bold green]Model updated.[/bold green]")
                else:
                    console.print("[red]Training failed — will retry next round.[/red]")

        console.print(f"[dim]Sleeping {SLEEP_BETWEEN_ROUNDS}s before next round...[/dim]")
        time.sleep(SLEEP_BETWEEN_ROUNDS)


if __name__ == "__main__":
    run_continuous()
