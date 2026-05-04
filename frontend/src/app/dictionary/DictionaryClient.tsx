"use client";

import { useEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchLexicon, sweepCorpus, importOnlineSlang } from "@/lib/api";
import type { LexiconEntry, SlangWord } from "@/types";
import RevealText from "@/components/RevealText";
import { fadeUp } from "@/lib/motion";
import WordModal from "../top-slang/_components/WordModal";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

interface Entry extends LexiconEntry {
  word: string;
}

export default function DictionaryClient({ initialLexicon }: { initialLexicon: Record<string, LexiconEntry> }) {
  const [lexicon, setLexicon] = useState<Record<string, LexiconEntry>>(initialLexicon);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState("");
  const [selected, setSelected] = useState<{ word: SlangWord; anchor: { x: number; y: number } | null } | null>(null);
  const [sweeping,  setSweeping]  = useState(false);
  const [importing, setImporting] = useState(false);
  const [growMsg,   setGrowMsg]   = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const growMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (growMsgTimer.current) clearTimeout(growMsgTimer.current);
  }, []);

  const reloadLexicon = useCallback(() => {
    fetchLexicon().then(setLexicon).catch(() => null);
  }, []);

  // Pull fresh slang from corpus stats
  const runSweep = useCallback(async () => {
    if (sweeping) return;
    setSweeping(true);
    setGrowMsg("Scanning corpus and asking LLM to confirm — this takes about a minute…");
    try {
      const res = await sweepCorpus(20);
      if (res.error) {
        setGrowMsg(`Sweep failed: ${res.detail ?? res.error}`);
      } else {
        const added = res.added ?? 0;
        const cands = res.candidates ?? 0;
        if (added > 0) {
          setGrowMsg(`Found ${added} new slang word${added === 1 ? "" : "s"} · lexicon now ${res.lexicon_size}`);
          reloadLexicon();
        } else if (cands === 0) {
          setGrowMsg("No corpus candidates — all frequent words are already known or standard dictionary words");
        } else {
          setGrowMsg(`Scanned ${cands} candidate${cands === 1 ? "" : "s"}, LLM rejected them all as non-slang`);
        }
      }
    } catch (e) {
      setGrowMsg(`Sweep failed: ${e}`);
    } finally {
      setSweeping(false);
      if (growMsgTimer.current) clearTimeout(growMsgTimer.current);
      growMsgTimer.current = setTimeout(() => setGrowMsg(null), 8000);
    }
  }, [sweeping, reloadLexicon]);

  // Pull fresh slang from public web sources (Reddit + LLM brainstorm)
  const runImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    setGrowMsg("Fetching Reddit threads + asking LLMs for slang lists — this takes 1–2 minutes…");
    try {
      const res = await importOnlineSlang({ maxNew: 30 });
      if (res.error) {
        setGrowMsg(`Import failed: ${res.detail ?? res.error}`);
      } else {
        const added     = res.added ?? 0;
        const cands     = res.candidates_found ?? 0;
        const fresh     = res.fresh ?? 0;
        const verified  = res.verified ?? 0;
        const sources   = res.sources ?? [];
        const threads   = sources.filter((s) => s.kind === "url"           && s.ok).length;
        const searches  = sources.filter((s) => s.kind === "reddit-search" && s.ok).length;
        const llms      = sources.filter((s) => s.kind === "llm"           && s.ok).length;
        const sourceTxt = `${threads} thread${threads === 1 ? "" : "s"} · ${searches} searches · ${llms} LLM${llms === 1 ? "" : "s"}`;

        if (added > 0) {
          setGrowMsg(
            `Imported ${added} new word${added === 1 ? "" : "s"} from ${sourceTxt}: ${(res.added_words ?? []).slice(0, 6).join(", ")}${(res.added_words?.length ?? 0) > 6 ? "…" : ""}`,
          );
          reloadLexicon();
        } else {
          const reasons: string[] = [];
          if (cands === 0)         reasons.push("no candidates from sources");
          else if (fresh === 0)    reasons.push(`all ${cands} candidates already in lexicon`);
          else if (verified === 0) reasons.push(`${fresh} fresh candidates but no LLM responses (check API key)`);
          else                     reasons.push(`LLM rejected all ${verified} candidate${verified === 1 ? "" : "s"} as non-slang`);
          setGrowMsg(`No new slang added · ${reasons.join(", ")} · ${sourceTxt}`);
        }
      }
    } catch (e) {
      setGrowMsg(`Import failed: ${e}`);
    } finally {
      setImporting(false);
      if (growMsgTimer.current) clearTimeout(growMsgTimer.current);
      growMsgTimer.current = setTimeout(() => setGrowMsg(null), 12000);
    }
  }, [importing, reloadLexicon]);

  function openWord(entry: Entry, e: React.MouseEvent) {
    setSelected({
      word: {
        word: entry.word,
        count: 0,                      // dictionary view doesn't have corpus counts
        definition: entry.definition,
        plain_word: entry.plain ?? null,
      },
      anchor: { x: e.clientX, y: e.clientY },
    });
  }

  useEffect(() => {
    fetchLexicon()
      .then((entries) => setLexicon(entries))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const deferredSearch = useDeferredValue(search);
  const q = deferredSearch.trim().toLowerCase();

  // Group entries by their first letter, then sort each group A-Z
  const grouped = useMemo(() => {
    const all: Entry[] = Object.entries(lexicon)
      .map(([word, meta]) => ({ word, ...meta }))
      .filter((e) => {
        if (!q) return true;
        return (
          e.word.toLowerCase().includes(q) ||
          (e.definition ?? "").toLowerCase().includes(q) ||
          (e.plain ?? "").toLowerCase().includes(q) ||
          (e.origin ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.word.localeCompare(b.word));

    const groups: Record<string, Entry[]> = {};
    for (const e of all) {
      const letter = e.word[0]?.toLowerCase() ?? "#";
      const key = /[a-z]/.test(letter) ? letter : "#";
      (groups[key] ??= []).push(e);
    }
    return groups;
  }, [lexicon, q]);

  const totalShown = useMemo(
    () => Object.values(grouped).reduce((s, arr) => s + arr.length, 0),
    [grouped],
  );

  const scrollTo = (letter: string) => {
    sectionRefs.current[letter]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <AnimatePresence>
        {selected && (
          <WordModal
            word={selected.word}
            anchor={selected.anchor}
            meta={lexicon[selected.word.word]}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-1 leading-tight">
            <RevealText
              text="Filipino Slang Dictionary"
              as="span"
              split="char"
              stagger={0.025}
              className="text-shimmer"
            />
          </h1>
          <p className="text-sm md:text-base text-white/55 max-w-2xl leading-relaxed">
            Every slang word the system has learned — alphabetical, with definitions,
            origins, and example sentences. Click a letter to jump.
          </p>
        </div>

        {/* Grow-the-dictionary actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runImport}
            disabled={importing || sweeping}
            title="Pull candidate slang from public Reddit threads + LLM brainstorm and verify each"
            className="btn-ghost w-auto px-3 md:px-4 py-2 text-xs md:text-sm flex items-center gap-1.5 md:gap-2 disabled:opacity-50"
          >
            {importing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-purple-300 rounded-full animate-spin" />
                <span className="hidden sm:inline">Importing…</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a14 14 0 0 1 0 18" />
                  <path d="M12 3a14 14 0 0 0 0 18" />
                </svg>
                <span className="hidden sm:inline">Import from web</span>
                <span className="sm:hidden">Import</span>
              </>
            )}
          </button>
          <button
            onClick={runSweep}
            disabled={sweeping || importing}
            title="Re-scan the corpus and ask the LLM to confirm any missed slang"
            className="btn-ghost w-auto px-3 md:px-4 py-2 text-xs md:text-sm flex items-center gap-1.5 md:gap-2 disabled:opacity-50"
          >
            {sweeping ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-blue-300 rounded-full animate-spin" />
                <span className="hidden sm:inline">Scanning corpus…</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                  <path d="M11 8v6M8 11h6" />
                </svg>
                <span className="hidden sm:inline">Find missed slang</span>
                <span className="sm:hidden">Find</span>
              </>
            )}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {growMsg && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs mb-4 px-3 py-2 rounded-lg border border-blue-400/30
                       bg-blue-500/[.08] text-blue-200"
          >
            {growMsg}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Search bar */}
      <motion.div variants={fadeUp} initial="hidden" animate="show"
                  className="card p-3 mb-5 sticky top-2 z-10 backdrop-blur-xl">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35"
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a word, definition, or origin…"
              className="input-glass w-full pl-10 pr-4 py-2.5 text-base"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35
                           hover:text-white/70 transition-colors text-xl leading-none"
              >×</button>
            )}
          </div>
          <p className="text-xs text-white/45 whitespace-nowrap">
            <span className="text-gradient-static font-semibold text-sm">{totalShown}</span>
            {" "}of {Object.keys(lexicon).length} entries
            {q && <span className="ml-1 italic">match &ldquo;{search}&rdquo;</span>}
          </p>
        </div>

        {/* A–Z jump strip — horizontally scrollable on mobile so 26 letters
            stay in a single row instead of wrapping to 4 messy lines */}
        <div className="mt-3 pt-3 border-t border-white/[.05] -mx-1 px-1">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin pb-1">
            {ALPHABET.map((letter) => {
              const has = (grouped[letter]?.length ?? 0) > 0;
              return (
                <button
                  key={letter}
                  onClick={() => has && scrollTo(letter)}
                  disabled={!has}
                  className={`flex-shrink-0 w-8 h-8 rounded-md text-sm font-semibold uppercase
                              transition-colors ${has
                                ? "text-blue-200 hover:bg-blue-500/[.18] hover:text-blue-100 active:bg-blue-500/[.25]"
                                : "text-white/15 cursor-not-allowed"}`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[0,1,2,3].map((i) => (
            <div key={i} className="card p-5">
              <div className="shimmer h-6 w-32 rounded mb-3" />
              <div className="shimmer h-3 w-3/4 rounded mb-2" />
              <div className="shimmer h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : totalShown === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-3xl mb-2">📖</p>
          <p className="text-sm text-white/55">
            No entries match &ldquo;<span className="text-white/85">{search}</span>&rdquo;
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {ALPHABET.map((letter) => {
            const entries = grouped[letter];
            if (!entries || entries.length === 0) return null;
            return (
              <section
                key={letter}
                ref={(el) => { sectionRefs.current[letter] = el; }}
                className="scroll-mt-24"
              >
                <h2 className="text-4xl sm:text-5xl font-bold text-shimmer mb-3 select-none uppercase tracking-tight">
                  {letter}
                </h2>
                <div className="space-y-3">
                  {entries.map((e) => (
                    <DictionaryEntry
                      key={e.word}
                      entry={e}
                      query={q}
                      onClick={(ev) => openWord(e, ev)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Single entry — Merriam-Webster style ─────────────────────────────── */

function DictionaryEntry({
  entry, query, onClick,
}: {
  entry: Entry;
  query: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <article
      onClick={onClick}
      className="card p-4 sm:p-5 md:p-6 hover:border-blue-400/35 transition-colors cursor-pointer
                 hover:shadow-[0_0_30px_-10px_rgba(96,165,250,0.35)]
                 active:scale-[.997] active:translate-y-px"
    >
      {/* Headword line: word + pronunciation hint + part of speech */}
      <header className="flex items-baseline flex-wrap gap-x-2.5 sm:gap-x-3 gap-y-1 mb-2.5 sm:mb-3">
        <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-gradient-static tracking-tight">
          <Highlight text={entry.word} q={query} />
        </h3>
        {entry.pos && (
          <span className="text-sm italic text-white/55">{entry.pos}</span>
        )}
        {entry.formation_type && entry.formation_type !== "unknown" && (
          <span className="text-[11px] text-blue-300 bg-blue-500/[.12] border border-blue-400/30
                           px-2 py-0.5 rounded-md uppercase tracking-widest">
            {formatType(entry.formation_type)}
          </span>
        )}
        {entry.is_ambiguous && (
          <span className="text-[11px] text-purple-300 bg-purple-500/[.12] border border-purple-400/30
                           px-2 py-0.5 rounded-md uppercase tracking-widest">
            semantic shift
          </span>
        )}
      </header>

      {/* Plain English chip */}
      {entry.plain && (
        <p className="text-sm mb-3 text-white/60">
          <span className="text-[11px] text-white/35 uppercase tracking-widest mr-2">Plain English</span>
          <span className="bg-blue-500/[.12] border border-blue-400/30 text-blue-100
                           px-2 py-0.5 rounded-md text-[13px] font-medium">
            <Highlight text={entry.plain} q={query} />
          </span>
        </p>
      )}

      {/* Numbered definition */}
      <div className="flex gap-3 mb-3">
        <span className="text-blue-300 font-bold text-lg leading-tight">1</span>
        <p className="text-base text-white/80 leading-relaxed flex-1">
          <Highlight text={entry.definition || "Definition still being learned."} q={query} />
        </p>
      </div>

      {/* Example */}
      {entry.example && (
        <div className="border-l-2 border-blue-400/40 pl-3 mb-3">
          <p className="text-[10px] text-white/35 uppercase tracking-widest mb-1">Example</p>
          <p className="text-sm text-white/65 italic leading-relaxed">
            &ldquo;{entry.example}&rdquo;
          </p>
        </div>
      )}

      {/* Origin */}
      {entry.origin && (
        <p className="text-sm text-white/50 leading-relaxed">
          <span className="text-[10px] text-white/35 uppercase tracking-widest mr-2">Origin</span>
          <Highlight text={entry.origin} q={query} />
        </p>
      )}
    </article>
  );
}

const FORMATION_LABELS: Record<string, string> = {
  binaliktad:        "syllable reversal",
  contraction:       "contraction",
  phonetic:          "phonetic respelling",
  affixation:        "affixation",
  clipping:          "clipping",
  blending:          "blending",
  coinage:           "coinage",
  native:            "native coinage",
  semantic_shift:    "semantic shift",
  borrowing:         "borrowing",
  jejemon:           "jejemon",
  number_syllable:   "number-syllable",
  multi_word:        "multi-word phrase",
};

function formatType(type: string): string {
  return FORMATION_LABELS[type] ?? type;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-300/30 text-current rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
