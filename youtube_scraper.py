"""
YouTube comment scraper — no API key required.
Uses yt-dlp to pull top comments from recent videos on popular Filipino channels.
"""
import os
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from rich.console import Console

console = Console()

# Filipino channels with high slang density in comments
YOUTUBE_CHANNELS = [
    # Vloggers / creators (confirmed working)
    "https://www.youtube.com/@NianaGuerrero",
    "https://www.youtube.com/@RanzKyle",
    "https://www.youtube.com/@donnalyn",
    # News & reactions
    "https://www.youtube.com/@News5Everywhere",
    "https://www.youtube.com/@ABSCBNNews",
    "https://www.youtube.com/@GMAIntegratedNews",
    # Entertainment
    "https://www.youtube.com/@ASAPOFFICIAL",
    "https://www.youtube.com/@iWantTFCOfficial",
    # Gaming / commentary
    "https://www.youtube.com/@MarkusPH",
    "https://www.youtube.com/@KuyaFerdzOfficial",
    # Lifestyle / comedy
    "https://www.youtube.com/@llonamasinas",
    "https://www.youtube.com/@ivanaAlawi",
]

VIDEOS_PER_CHANNEL  = 5    # recent videos to check per channel
COMMENTS_PER_VIDEO  = 300  # top comments to pull per video


def _date_from_ts(ts) -> str:
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")


def _date_from_yt(yt_date: str | None) -> str:
    if yt_date and len(yt_date) == 8:
        return f"{yt_date[:4]}-{yt_date[4:6]}-{yt_date[6:8]}"
    return datetime.now().strftime("%Y-%m-%d")


def _get_recent_video_ids(channel_url: str, max_videos: int) -> list[str]:
    import yt_dlp
    ydl_opts = {
        "extract_flat": "in_playlist",
        "quiet":        True,
        "no_warnings":  True,
        "playlistend":  max_videos,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(channel_url + "/videos", download=False)
            if info and "entries" in info:
                return [e["id"] for e in (info["entries"] or []) if e and e.get("id")]
    except Exception as e:
        console.print(f"[red]YT channel {channel_url.split('@')[-1]}: {e}[/red]")
    return []


def _get_video_comments(video_id: str, max_comments: int) -> list[dict]:
    import yt_dlp
    posts: list[dict] = []
    ydl_opts = {
        "getcomments":  True,
        "quiet":        True,
        "no_warnings":  True,
        "skip_download": True,
        "extractor_args": {
            "youtube": {
                "max_comments":  [str(max_comments)],
                "comment_sort":  ["top"],
            }
        },
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=False
            )
            if not info:
                return posts
            video_date = _date_from_yt(info.get("upload_date"))
            for c in (info.get("comments") or []):
                text = (c.get("text") or "").strip().replace("\n", " ")
                if not text:
                    continue
                ts = c.get("timestamp")
                posts.append({
                    "text":   text,
                    "date":   _date_from_ts(ts) if ts else video_date,
                    "user":   c.get("author"),
                    "likes":  c.get("like_count", 0),
                    "source": "youtube",
                })
    except Exception as e:
        console.print(f"[red]YT comments {video_id}: {e}[/red]")
    return posts


def scrape_youtube(
    channels: list[str] | None = None,
    videos_per_channel: int = VIDEOS_PER_CHANNEL,
    comments_per_video: int = COMMENTS_PER_VIDEO,
    comment_workers: int = 2,
    output_file: str = "data/raw_youtube.json",
) -> list[dict]:
    from data_collection import _save_and_return
    if channels is None:
        channels = YOUTUBE_CHANNELS

    console.print(
        f"\n[bold cyan]YouTube — {len(channels)} channels, "
        f"{videos_per_channel} videos each, "
        f"{comments_per_video} comments/video[/bold cyan]"
    )

    all_posts: list[dict] = []
    for channel_url in channels:
        name = channel_url.split("@")[-1] if "@" in channel_url else channel_url
        video_ids = _get_recent_video_ids(channel_url, videos_per_channel)
        if not video_ids:
            console.print(f"[dim]  {name}: no videos[/dim]")
            continue

        channel_posts: list[dict] = []
        with ThreadPoolExecutor(max_workers=comment_workers) as pool:
            futures = {
                pool.submit(_get_video_comments, vid, comments_per_video): vid
                for vid in video_ids
            }
            for future in as_completed(futures):
                try:
                    channel_posts.extend(future.result())
                except Exception:
                    pass

        console.print(f"[dim]  {name}: {len(video_ids)} videos → {len(channel_posts)} comments[/dim]")
        all_posts.extend(channel_posts)

    return _save_and_return(all_posts, output_file, "YouTube")
