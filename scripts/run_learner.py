"""
Manually run one learning cycle: discover candidates + ask the LLM + persist.

Useful when you don't want to wait for the API server's 10-minute scrape /
200 KB-corpus-growth retrain triggers, or when the server isn't running with
LEARNER_ENABLED=1.

Usage:
  python scripts/run_learner.py                # discover + enrich (writes to disk)
  python scripts/run_learner.py --dry-run      # discover only — show candidates, no LLM
  python scripts/run_learner.py --top 50       # consider top 50 candidates instead of 30
  python scripts/run_learner.py --min-count 5  # lower the freq floor (default 10)

Requires a trained model at data/social_model.model and at least one of
GEMINI_API_KEY / GROQ_API_KEY / a local Ollama instance for live enrichment.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true",
                   help="Print candidates without calling the LLM or writing anything.")
    p.add_argument("--top",       type=int, default=30, help="How many candidates to consider (default 30).")
    p.add_argument("--max-new",   type=int, default=15, help="Max new entries to add this run (default 15).")
    p.add_argument("--min-count", type=int, default=None,
                   help="Override the minimum corpus count for a candidate (default 10).")
    args = p.parse_args()

    print("Loading detector + corpus…")
    from slang_detector import SlangDetector
    from slang_enricher import find_slang_candidates, enrich_candidates, audit_discovered
    from api.corpus_utils import scan_corpus
    import slang_enricher as se

    detector = SlangDetector()
    if not detector.model:
        print("ERROR: no model at data/social_model.model. Train first: python automate.py")
        return 1
    counts, total_posts = scan_corpus()
    print(f"Corpus: {total_posts:,} posts · {len(counts):,} unique tokens")

    # Optional override of the min-count gate inside find_slang_candidates.
    if args.min_count is not None:
        # Patch the threshold by monkey-patching the original sentinel.
        # The function inlines the literal `count < 10`, so we replace via a wrapper.
        original = find_slang_candidates
        def patched(detector, corpus_counts, top_n=args.top):  # noqa
            return [
                (w, exs) for w, exs in original(detector, corpus_counts, top_n=top_n * 5)
                if int(corpus_counts.get(w, 0)) >= args.min_count
            ][:top_n]
        find_slang_candidates_local = patched
    else:
        find_slang_candidates_local = find_slang_candidates

    print(f"Finding up to {args.top} candidates "
          f"(min count = {args.min_count if args.min_count is not None else 10})…")
    cands = find_slang_candidates_local(detector, counts, top_n=args.top)
    if not cands:
        print("No candidates found. Either the lexicon already covers them, or "
              "the corpus-stable check is rejecting them as standard words.")
        return 0

    print(f"\n{len(cands)} candidates:")
    for word, exs in cands:
        n = int(counts.get(word, 0))
        print(f"  {word:<18} freq={n:<4}  e.g. {(exs[0][:80] if exs else ''):<80}")

    if args.dry_run:
        print("\n--dry-run: stopping before LLM call.")
        return 0

    print(f"\nCalling LLM (Gemini -> Groq -> Ollama) on up to {args.max_new} of them…")
    added = enrich_candidates(cands, max_new=args.max_new, detector=detector)
    print(f"Added {added} new slang entries.")

    if added:
        from slang_enricher import load_discovered
        disc = load_discovered()
        new_only = list(disc.keys())[-added:]
        print("\nNew entries:")
        for w in new_only:
            meta = disc[w]
            plain = meta.get("plain") or "(no plain)"
            defn  = meta.get("definition", "")[:80]
            print(f"  {w:<18} → {plain:<20} | {defn}")

    print(f"\nRunning audit on the full discovered lexicon…")
    n_suspect = audit_discovered(detector)
    print(f"Audit complete. {n_suspect} entries currently flagged as suspect.")
    if n_suspect:
        print("Inspect with: python scripts/unflag_slang.py --suspects")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
