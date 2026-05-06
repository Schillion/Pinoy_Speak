"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchPosts, fetchDefine } from "@/lib/api";
import { FORMATION_LABELS } from "@/lib/slang-data";
import type { DefineResult } from "@/types";
import { fadeUp, staggerContainer, popIn } from "@/lib/motion";
import MagneticButton from "@/components/MagneticButton";

interface KwicLine {
  left: string[];
  match: string;
  right: string[];
  date: string | null;
  source: string;
  postIndex: number;
}

type SortMode = "none" | "left1" | "right1" | "date";

const CONTEXT_OPTIONS = [5, 8, 10, 15] as const;

const STOP = new Set([
  "ang","ng","sa","na","at","ay","si","ni","para","pero","kasi","lang","din",
  "rin","po","daw","raw","pala","naman","talaga","sana","yung","ung","dun",
  "the","and","for","that","this","with","from","have","not","but","are",
  "was","you","all","can","her","his","had","just","like","some","than",
  "then","what","when","will","your","they","been","were","more","also",
  "an","in","is","it","of","to","be","as","by","or","on","at","so","do",
]);

function stripPunct(t: string): string {
  return t.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
}

function buildKwic(
  posts: { text: string | null; date: string | null; source: string }[],
  keyword: string,
  contextSize: number,
): KwicLine[] {
  const lines: KwicLine[] = [];
  const kw = keyword.toLowerCase().trim();
  if (!kw) return lines;

  posts.forEach((post, postIndex) => {
    const tokens = (post.text ?? "").match(/\S+/g) ?? [];
    tokens.forEach((tok, i) => {
      if (stripPunct(tok).toLowerCase() === kw) {
        lines.push({
          left:      tokens.slice(Math.max(0, i - contextSize), i),
          match:     tok,
          right:     tokens.slice(i + 1, Math.min(tokens.length, i + 1 + contextSize)),
          date:      post.date ?? null,
          source:    post.source ?? "",
          postIndex,
        });
      }
    });
  });

  return lines;
}

function topCollocates(
  lines: KwicLine[],
  side: "left" | "right",
  n = 8,
): [string, number][] {
  const freq: Record<string, number> = {};
  for (const line of lines) {
    const toks = side === "left" ? line.left.slice(-3) : line.right.slice(0, 3);
    for (const t of toks) {
      const w = stripPunct(t).toLowerCase();
      if (w.length > 1 && !STOP.has(w)) freq[w] = (freq[w] ?? 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export default function ConcordanceView() {
  const [input,       setInput]       = useState("");
  const [keyword,     setKeyword]     = useState("");
  const [posts,       setPosts]       = useState<{ text: string | null; date: string | null; source: string }[]>([]);
  const [wordInfo,    setWordInfo]    = useState<DefineResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [contextSize, setContextSize] = useState<number>(8);
  const [sortMode,    setSortMode]    = useState<SortMode>("none");

  const handleSearch = useCallback(async () => {
    const kw = input.trim().toLowerCase();
    if (!kw || loading) return;

    setLoading(true);
    setError("");
    setKeyword(kw);
    setPosts([]);
    setWordInfo(null);

    try {
      const [postsData, defineData] = await Promise.all([
        fetchPosts(1, 500, kw),
        fetchDefine(kw).catch(() => null),
      ]);
      setPosts(postsData.posts ?? []);
      if (defineData) setWordInfo(defineData);
    } catch {
      setError("Could not load corpus. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const kwicLines = useMemo(
    () => buildKwic(posts, keyword, contextSize),
    [posts, keyword, contextSize],
  );

  const sorted = useMemo(() => {
    if (sortMode === "left1") {
      return [...kwicLines].sort((a, b) => {
        const wa = stripPunct(a.left[a.left.length - 1] ?? "").toLowerCase();
        const wb = stripPunct(b.left[b.left.length - 1] ?? "").toLowerCase();
        return wa.localeCompare(wb);
      });
    }
    if (sortMode === "right1") {
      return [...kwicLines].sort((a, b) => {
        const wa = stripPunct(a.right[0] ?? "").toLowerCase();
        const wb = stripPunct(b.right[0] ?? "").toLowerCase();
        return wa.localeCompare(wb);
      });
    }
    if (sortMode === "date") {
      return [...kwicLines].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? ""),
      );
    }
    return kwicLines;
  }, [kwicLines, sortMode]);

  const uniquePosts = useMemo(
    () => new Set(kwicLines.map((l) => l.postIndex)).size,
    [kwicLines],
  );

  const totalWords = useMemo(
    () => posts.reduce((s, p) => s + ((p.text ?? "").split(/\s+/).length), 0),
    [posts],
  );

  const freqPer1k =
    totalWords > 0 ? ((kwicLines.length / totalWords) * 1000).toFixed(2) : "—";

  const leftCollocates  = useMemo(() => topCollocates(kwicLines, "left"),  [kwicLines]);
  const rightCollocates = useMemo(() => topCollocates(kwicLines, "right"), [kwicLines]);

  const hasResults = sorted.length > 0;

  const formationLabel = wordInfo?.formation_type
    ? FORMATION_LABELS[wordInfo.formation_type as keyof typeof FORMATION_LABELS]
    : null;

  return (
    <div>
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="text-sm text-white/55 mb-5"
      >
        Type a Filipino slang word — see real sentences from social media
        showing how people actually use it. Each row is one occurrence, with the
        words before and after the keyword lined up so patterns are easy to spot.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="card spotlight p-4 mb-5 flex flex-wrap gap-3 items-end"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] text-white/40 uppercase tracking-widest block mb-1.5">
            Keyword
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. grabe, lodi, solid…"
            className="input-glass w-full px-4 py-2.5 text-sm"
          />
        </div>

        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-widest block mb-1.5">
            Words to show around it
          </label>
          <div className="flex gap-1 relative">
            {CONTEXT_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setContextSize(n)}
                title={`Show ${n} words on each side of the keyword`}
                className={`relative px-3 py-2.5 rounded-lg text-xs transition-colors
                            ${contextSize === n ? "text-blue-200" : "text-white/45 hover:text-white/75"}`}
              >
                {contextSize === n && (
                  <motion.span
                    layoutId="concord-ctx-pill"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500/25 to-purple-500/20 border border-blue-400/40"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">±{n}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-widest block mb-1.5">
            Order results by
          </label>
          <div className="flex gap-1 relative">
            {(
              [
                ["none",   "Found order", "Original order in the corpus"],
                ["left1",  "Word before", "Group rows by the word that comes BEFORE the keyword"],
                ["right1", "Word after",  "Group rows by the word that comes AFTER the keyword"],
                ["date",   "Date",        "Oldest → newest"],
              ] as [SortMode, string, string][]
            ).map(([s, label, tip]) => (
              <button
                key={s}
                onClick={() => setSortMode(s)}
                title={tip}
                className={`relative px-3 py-2.5 rounded-lg text-xs transition-colors
                            ${sortMode === s ? "text-blue-200" : "text-white/45 hover:text-white/75"}`}
              >
                {sortMode === s && (
                  <motion.span
                    layoutId="concord-sort-pill"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500/25 to-purple-500/20 border border-blue-400/40"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <MagneticButton
          onClick={handleSearch}
          disabled={loading || !input.trim()}
          className="btn-primary w-auto px-6 py-2.5 text-sm"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Loading…
            </span>
          ) : "Search"}
        </MagneticButton>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="text-amber-300/80 text-sm mb-4 border border-amber-400/30 rounded-xl
                       px-4 py-3 bg-gradient-to-r from-amber-500/[.08] to-orange-500/[.04]"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {keyword && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5"
        >
          {hasResults ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span>
                <span className="text-gradient-static font-bold text-sm">{kwicLines.length}</span>{" "}
                occurrences
              </span>
              <span className="text-white/15">·</span>
              <span>
                <span className="text-white font-semibold">{uniquePosts}</span>{" "}
                unique posts
              </span>
              <span className="text-white/15">·</span>
              <span>
                <span className="text-white font-semibold">{freqPer1k}</span>{" "}
                per 1,000 words in corpus
              </span>
            </div>
          ) : (
            <p className="text-sm text-white/40">
              No occurrences of &ldquo;{keyword}&rdquo; found in the corpus.
            </p>
          )}

          {formationLabel && (
            <span className="text-[11px] text-blue-200 bg-blue-500/[.12] border
                             border-blue-400/30 px-2 py-0.5 rounded-md">
              {formationLabel}
            </span>
          )}
          {wordInfo?.plain && (
            <span className="text-[11px] text-white/40 italic">
              ≈ {wordInfo.plain}
            </span>
          )}
        </motion.div>
      )}

      {hasResults && (leftCollocates.length > 0 || rightCollocates.length > 0) && (
        <motion.div
          variants={staggerContainer(0.1)} initial="hidden" animate="show"
          className="grid grid-cols-2 gap-4 mb-5"
        >
          {[
            { label: "Words commonly before", items: leftCollocates, color: "violet" },
            { label: "Words commonly after",  items: rightCollocates, color: "blue" },
          ].map(({ label, items, color }) => (
            <motion.div key={label} variants={fadeUp} className="card spotlight p-4">
              <p className="text-[11px] text-white/35 uppercase tracking-widest mb-3">
                {label}
              </p>
              <motion.div variants={staggerContainer(0.02)} initial="hidden" animate="show"
                          className="flex flex-wrap gap-1.5">
                {items.map(([word, count]) => (
                  <motion.span
                    key={word}
                    variants={popIn}
                    whileHover={{ scale: 1.08 }}
                    className={`text-xs px-2 py-0.5 rounded-full border cursor-default
                                ${color === "violet"
                                  ? "text-violet-200 bg-violet-500/[.10] border-violet-400/30"
                                  : "text-blue-200 bg-blue-500/[.10] border-blue-400/30"}`}
                  >
                    {word}
                    <span className="ml-1 text-white/30">×{count}</span>
                  </motion.span>
                ))}
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {hasResults && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card overflow-x-auto"
        >
          <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "37%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "37%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead className="border-b border-white/[.07] sticky top-0 bg-[#080f1c]/90 backdrop-blur">
                <tr className="text-[11px] text-white/35 uppercase tracking-widest">
                  <th className="px-3 py-3 text-left">#</th>
                  <th className="px-3 py-3 text-right">Words before</th>
                  <th className="px-3 py-3 text-center">Word</th>
                  <th className="px-3 py-3 text-left">Words after</th>
                  <th className="px-3 py-3 text-right">When · where</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((line, i) => (
                  <motion.tr
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.008, 0.6), duration: 0.3 }}
                    className="border-b border-white/[.03] hover:bg-white/[.03] transition-colors"
                  >
                    <td className="px-3 py-2 text-white/25 text-[12px] font-mono text-right">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2 text-white/45 text-xs font-mono whitespace-nowrap overflow-hidden"
                        style={{ textAlign: "right" }}>
                      <span style={{ display: "block", overflow: "hidden", textAlign: "right" }}>
                        {line.left.join(" ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <span className="inline-block text-blue-100 font-bold bg-gradient-to-br from-blue-500/25 to-indigo-500/15
                                       border border-blue-400/35 px-2 py-0.5 rounded-md text-xs tracking-wide
                                       shadow-[0_0_12px_-4px_rgba(96,165,250,0.6)]">
                        {line.match}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/45 text-xs font-mono whitespace-nowrap overflow-hidden">
                      {line.right.join(" ")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[11px] text-white/30 font-mono whitespace-nowrap">
                          {line.date ?? "—"}
                        </span>
                        <span className="text-[10px] text-blue-300 bg-blue-500/[.08]
                                         border border-blue-400/20 px-1.5 py-0.5 rounded-full
                                         whitespace-nowrap">
                          {line.source}
                        </span>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>

          {sorted.length >= 500 && (
            <p className="text-[11px] text-white/30 text-center py-2.5 border-t border-white/[.04]">
              Showing first 500 matching posts — narrow the keyword for a smaller set.
            </p>
          )}
        </motion.div>
      )}

      {!keyword && !loading && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 220, damping: 22 }}
          className="card p-7"
        >
          <div className="text-center mb-6">
            <motion.p
              className="text-4xl mb-3 select-none"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              🔍
            </motion.p>
            <p className="text-base text-white font-semibold mb-1">
              See a word in real Filipino sentences
            </p>
            <p className="text-sm text-white/55 max-w-md mx-auto leading-relaxed">
              Pick any slang word below — you&apos;ll get a list of real posts
              that use it, lined up so the words around it are easy to compare.
            </p>
          </div>

          {/* Example illustration — what the result will look like */}
          <div className="mx-auto max-w-md bg-white/[.03] border border-white/[.06] rounded-xl px-4 py-3 mb-5 font-mono text-[11px]">
            <p className="text-white/35 text-[10px] uppercase tracking-widest mb-2">
              Example result for &ldquo;grabe&rdquo;
            </p>
            <div className="space-y-1">
              <p className="text-white/70">
                <span className="text-white/40">… ang init mag-school</span>{" "}
                <span className="bg-blue-500/25 border border-blue-400/35 text-blue-100 rounded px-1.5">grabe</span>{" "}
                <span className="text-white/40">talaga …</span>
              </p>
              <p className="text-white/70">
                <span className="text-white/40">… kakapagod, sobrang</span>{" "}
                <span className="bg-blue-500/25 border border-blue-400/35 text-blue-100 rounded px-1.5">grabe</span>{" "}
                <span className="text-white/40">no?</span>
              </p>
              <p className="text-white/70">
                <span className="text-white/40">… nakakatuwa lang,</span>{" "}
                <span className="bg-blue-500/25 border border-blue-400/35 text-blue-100 rounded px-1.5">grabe</span>{" "}
                <span className="text-white/40">ang saya …</span>
              </p>
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-white/55 mb-2">Try one of these:</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {["grabe", "lodi", "solid", "kilig", "naks", "petmalu", "charot", "tara"].map((w) => (
                <button
                  key={w}
                  className="text-xs px-3 py-1.5 rounded-lg
                             bg-blue-500/[.08] border border-blue-400/30 text-blue-200
                             hover:bg-blue-500/[.18] transition-colors"
                  onClick={() => setInput(w)}
                >
                  {w}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-white/35 mt-3">
              Click a word, then press <kbd className="px-1.5 py-0.5 rounded
              bg-white/[.06] border border-white/[.10] text-[10px]">Search</kbd>
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
