"""
Remove entries from the auto-discovered slang lexicon.

Usage:
  python scripts/unflag_slang.py WORD [WORD ...]   Remove one or more entries
  python scripts/unflag_slang.py --audit           Re-audit every discovered entry
  python scripts/unflag_slang.py --suspects        Print suspects flagged by the audit
  python scripts/unflag_slang.py --list            Print every discovered entry

Changes take effect on the next API server start (or model hot-reload tick).
Only entries in data/discovered_slang.json are touched; the hand-curated
data/slang_seeds.json is never modified.
"""
from __future__ import annotations

import orjson
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISCOVERED = ROOT / "data" / "discovered_slang.json"
SUSPECTS   = ROOT / "data" / "suspect_slang.json"


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return orjson.loads(path.read_bytes())
    except Exception as e:
        print(f"error: could not read {path}: {e}", file=sys.stderr)
        sys.exit(2)


def _save(path: Path, data: dict) -> None:
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(orjson.dumps(data, option=orjson.OPT_INDENT_2))


def cmd_list() -> None:
    data = _load(DISCOVERED)
    if not data:
        print("discovered_slang.json is empty or missing.")
        return
    for word in sorted(data):
        meta = data[word]
        print(f"  {word:<20} {meta.get('plain') or meta.get('definition','')[:60]}")
    print(f"\n{len(data)} entries.")


def cmd_suspects() -> None:
    data = _load(SUSPECTS)
    if not data:
        print("No suspects flagged. data/suspect_slang.json is empty or missing.")
        return
    for word in sorted(data):
        meta = data[word]
        print(f"  {word:<20} {meta.get('reason','')}")
    print(f"\n{len(data)} suspects. To remove: "
          f"python scripts/unflag_slang.py {' '.join(sorted(data))}")


def cmd_remove(words: list[str]) -> None:
    discovered = _load(DISCOVERED)
    suspects   = _load(SUSPECTS)
    removed, missing = [], []

    for word in words:
        w = word.lower().strip()
        hit = False
        if w in discovered:
            discovered.pop(w)
            hit = True
        if w in suspects:
            suspects.pop(w)
            hit = True
        (removed if hit else missing).append(w)

    if removed:
        _save(DISCOVERED, discovered)
        _save(SUSPECTS, suspects)
        print(f"removed: {', '.join(removed)}")
    if missing:
        print(f"not found in either file: {', '.join(missing)}")
    if removed:
        print("Restart uvicorn (or wait for the next learner tick) for the change to take effect.")


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    if argv[0] == "--list":
        cmd_list()
        return 0
    if argv[0] == "--suspects":
        cmd_suspects()
        return 0
    if argv[0] == "--audit":
        cmd_audit()
        return 0
    cmd_remove(argv)
    return 0


def cmd_audit() -> None:
    sys.path.insert(0, str(ROOT))
    from slang_detector import SlangDetector
    from slang_enricher import audit_discovered
    print("Loading detector (this takes a few seconds)…")
    detector = SlangDetector()
    if not detector.model or detector.word_freq_map.empty:
        print("Cannot audit: model or corpus not loaded. Run training first.")
        return
    count = audit_discovered(detector)
    print(f"\nAudit complete. {count} entries currently flagged as suspect.")
    if count:
        print("Run `python scripts/unflag_slang.py --suspects` to inspect them.")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
