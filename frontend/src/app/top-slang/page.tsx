"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
} from "recharts";
import { fetchTopSlang, fetchLexicon } from "@/lib/api";
import type { LexiconEntry, SlangWord } from "@/types";
import WordModal from "./_components/WordModal";
import { fadeUp, staggerContainer } from "@/lib/motion";
import RevealText from "@/components/RevealText";
import MagneticButton from "@/components/MagneticButton";
import { useTheme } from "@/context/ThemeContext";

const BAR_COLORS = ["#60a5fa", "#a78bfa", "#22d3ee", "#f472b6", "#818cf8", "#34d399"];

type TopN = number | "all";

function TopNSelect({ value, onChange, options }: {
  value: TopN;
  onChange: (v: TopN) => void;
  options: TopN[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.indexOf(value)));
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = (v: TopN) => (v === "all" ? "All" : `Top ${v}`);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.indexOf(value)));
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, value, options]);

  const commit = (i: number) => {
    const v = options[i];
    if (v !== undefined) onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="input-glass px-3 py-2 text-sm text-white/75 flex items-center gap-2
                   min-w-[96px] justify-between hover:text-white transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label(value)}</span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-3 h-3 text-white/50"
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
            className="absolute right-0 top-full mt-1.5 min-w-full z-30
                       rounded-xl overflow-hidden
                       bg-[#0a1224]/95 backdrop-blur-xl
                       border border-white/[.08]
                       shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6),0_0_24px_-8px_rgba(96,165,250,0.25)]
                       py-1"
          >
            {options.map((v, i) => {
              const selected = v === value;
              const highlighted = i === active;
              return (
                <li key={String(v)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(i)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors
                      flex items-center justify-between
                      ${selected ? "text-blue-200" : "text-white/65"}
                      ${highlighted ? "bg-white/[.06]" : ""}
                      ${selected && !highlighted ? "bg-blue-500/[.12]" : ""}`}
                  >
                    <span>{label(v)}</span>
                    {selected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400
                                       shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                    )}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

const ALL_N_LIMIT = 1000;

export default function TopSlang() {
  const { theme, fontSize } = useTheme();
  const isLight = theme === "light";
  const TICK_SIZE: Record<string, number> = { small: 9, medium: 10, large: 11, xlarge: 12, xxlarge: 13, xxxlarge: 14 };
  const tickFs = TICK_SIZE[fontSize] ?? 10;
  const [words,    setWords]    = useState<SlangWord[]>([]);
  const [lexicon,  setLexicon]  = useState<Record<string, LexiconEntry>>({});
  const [n,        setN]        = useState<TopN>(15);
  const [period,   setPeriod]   = useState<"today" | "overall">("overall");
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [selected, setSelected] = useState<{ word: SlangWord; anchor: { x: number; y: number } | null } | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [coolMsg,  setCoolMsg]  = useState("");
  const reqId = useRef(0);
  const lastReqAt = useRef(0);
  const COOLDOWN_MS = 4000;

  const CHART_H = 280;

  // Chart pagination — 15 bars per page, fills full card width each page
  const CHART_PAGE = 15;
  const [chartPage, setChartPage]   = useState(0);
  const chartPages = Math.ceil(words.length / CHART_PAGE);
  const visibleBars = words.slice(chartPage * CHART_PAGE, (chartPage + 1) * CHART_PAGE);
  useEffect(() => { setChartPage(0); }, [words]);

  // Ranked list pagination (10 per page)
  const RANK_PAGE_SIZE = 10;
  const [rankPage, setRankPage] = useState(0);
  const rankTotalPages = Math.ceil(words.length / RANK_PAGE_SIZE);
  const pagedWords = words.slice(rankPage * RANK_PAGE_SIZE, (rankPage + 1) * RANK_PAGE_SIZE);
  useEffect(() => { setRankPage(0); }, [words]);

  const openWord = (word: SlangWord, e?: React.MouseEvent) => {
    const anchor = e ? { x: e.clientX, y: e.clientY } : null;
    setSelected({ word, anchor });
  };

  const draggedRef = useRef(false);

  const load = useCallback(async (count: TopN, p: "today" | "overall", force = false) => {
    const now = Date.now();
    if (!force && now - lastReqAt.current < COOLDOWN_MS) {
      setCoolMsg("Please wait a moment before refreshing again.");
      setTimeout(() => setCoolMsg(""), 3000);
      return;
    }
    lastReqAt.current = now;
    const id = ++reqId.current;
    setLoading(true);
    setCooldown(true);
    setError("");
    try {
      const [topWords, lex] = await Promise.all([
        fetchTopSlang(count === "all" ? ALL_N_LIMIT : count, p),
        fetchLexicon().catch(() => ({})),
      ]);
      if (id !== reqId.current) return;
      setWords(topWords);
      setLexicon(lex);
    } catch {
      if (id !== reqId.current) return;
      setError("Could not load top slang — the ML model may still be warming up. Try refreshing in a moment.");
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setTimeout(() => setCooldown(false), COOLDOWN_MS);
      }
    }
  }, []);

  useEffect(() => { load(n, period); }, [n, period, load]);




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

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 gap-3"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
            <RevealText
              text="Top Slang Words"
              as="span"
              split="char"
              stagger={0.035}
              className="text-shimmer"
            />
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.45 }}
            className="text-sm text-white/45 mt-0.5"
          >
            {period === "today"
              ? "Top Filipino slang from today's posts — click any word for details"
              : "Most-used Filipino slang from real online posts — click any word for details"}
          </motion.p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          {/* Today / Overall period toggle */}
          <div className={`flex rounded-lg overflow-hidden border border-white/[.08] bg-white/[.04] ${cooldown ? "opacity-50 pointer-events-none" : ""}`}>
            {(["today", "overall"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                disabled={cooldown}
                title={p === "today" ? "Slang from posts made today only" : "Slang from all posts ever collected"}
                className={`px-3 py-1.5 text-sm capitalize transition-colors
                  ${period === p
                    ? isLight
                      ? "bg-blue-500/10 text-blue-700 font-semibold"
                      : "bg-white/[.12] text-white font-medium"
                    : isLight
                      ? "text-slate-400 hover:text-slate-600"
                      : "text-white/45 hover:text-white/70"}`}
              >
                {p === "today" ? "Today" : "Overall"}
              </button>
            ))}
          </div>
          <TopNSelect value={n} onChange={(v) => { if (!cooldown) setN(v); }} options={[10, 15, 20, 30, "all"]} />
          <MagneticButton
            onClick={() => load(n, period, true)}
            disabled={loading || cooldown}
            className="btn-primary w-auto px-4 py-2 text-sm"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading…
              </span>
            ) : "Refresh"}
          </MagneticButton>
        </div>
      </motion.div>

      {coolMsg && (
        <motion.p
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="text-xs text-amber-400/80 mb-3 flex items-center gap-1.5"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-5h1.5v5zm0-6.5h-1.5V3.5h1.5V5z"/>
          </svg>
          {coolMsg}
        </motion.p>
      )}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="card border-red-500/25 p-4 mb-6 flex items-start gap-3"
        >
          <svg viewBox="0 0 20 20" fill="currentColor"
               className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zm.75 7a1 1 0 110-2 1 1 0 010 2z" clipRule="evenodd"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-300 font-medium mb-0.5">Failed to load</p>
            <p className="text-xs text-white/50 leading-relaxed">{error}</p>
          </div>
          <button
            onClick={() => load(n, period, true)}
            disabled={loading}
            className="flex-shrink-0 btn-primary w-auto px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {loading ? "Retrying…" : "Retry"}
          </button>
        </motion.div>
      )}

      {words.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.1)} initial="hidden" animate="show"
            className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8 items-stretch"
          >
            <motion.div variants={fadeUp} className="lg:col-span-2 card spotlight p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-white/35 uppercase tracking-wider">Usage frequency</p>
                <div className="flex items-center gap-2">
                  {chartPages > 1 && <span className="text-[10px] text-white/35">{chartPage + 1} / {chartPages}</span>}
                  <span className="text-[10px] text-white/40 bg-white/[.04] border border-white/[.07] rounded px-1.5 py-0.5 hidden sm:inline">
                    👆 Click a bar
                  </span>
                </div>
              </div>
              {/* flex-1 so chart grows to fill all remaining card height */}
              <div className="relative flex-1 min-h-0" style={{ minHeight: CHART_H }}>
                {chartPage > 0 && (
                  <button
                    onClick={() => setChartPage((p) => p - 1)}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-10
                               w-7 h-7 rounded-full flex items-center justify-center
                               bg-black/50 backdrop-blur text-white/70 hover:text-white
                               transition-colors shadow-lg"
                    aria-label="Previous page"
                  >
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7.5 2L4.5 6l3 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {chartPage < chartPages - 1 && (
                  <button
                    onClick={() => setChartPage((p) => p + 1)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-10
                               w-7 h-7 rounded-full flex items-center justify-center
                               bg-black/50 backdrop-blur text-white/70 hover:text-white
                               transition-colors shadow-lg"
                    aria-label="Next page"
                  >
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4.5 2L7.5 6l-3 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={visibleBars}
                    barCategoryGap="22%"
                    barGap={0}
                    margin={{
                      top: 4,
                      right: chartPage < chartPages - 1 ? 32 : 4,
                      bottom: 28,
                      left: chartPage > 0 ? 32 : 0,
                    }}
                  >
                    <defs>
                      {BAR_COLORS.map((c, i) => (
                        <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.35} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="word" tick={{ fontSize: tickFs }}
                           angle={-40} textAnchor="end" interval={0}
                           type="category" />
                    <YAxis tick={{ fontSize: tickFs }} width={28} />
                    <Tooltip
                      contentStyle={{
                        background: isLight ? "rgba(255,255,255,0.97)" : "rgba(7,14,28,0.92)",
                        backdropFilter: "blur(12px)",
                        border: isLight ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(96,165,250,0.25)",
                        borderRadius: 12,
                        boxShadow: isLight ? "0 4px 20px -6px rgba(15,23,42,0.15)" : "0 0 30px -8px rgba(96,165,250,0.4)",
                      }}
                      labelStyle={{ color: isLight ? "rgba(15,23,42,0.85)" : "#e2e8f0", fontWeight: 600, fontSize: tickFs + 1 }}
                      itemStyle={{ color: isLight ? "rgba(15,23,42,0.72)" : "#e2e8f0", fontSize: tickFs + 1 }}
                      cursor={{ fill: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,.04)" }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}
                         maxBarSize={48}
                         style={{ cursor: "pointer" }}
                         animationDuration={900}
                         onClick={(data) => {
                           const w = words.find((x) => x.word === data.word);
                           if (w) setSelected({ word: w, anchor: null });
                         }}>
                      {visibleBars.map((_, i) => (
                        <Cell key={i} fill={`url(#bar-grad-${i % BAR_COLORS.length})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="card spotlight p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-white/35 uppercase tracking-wider">Ranked list</p>
                {rankTotalPages > 1 && (
                  <span className="text-[10px] text-white/25">
                    {rankPage * RANK_PAGE_SIZE + 1}–{Math.min((rankPage + 1) * RANK_PAGE_SIZE, words.length)} of {words.length}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0" style={{ minHeight: 300 }}>
                <table className="w-full text-sm">
                  <tbody>
                    {pagedWords.map((w, i) => {
                      const globalIdx = rankPage * RANK_PAGE_SIZE + i;
                      return (
                        <tr
                          key={w.word}
                          onClick={(e) => openWord(w, e)}
                          className="border-b border-white/[.04] last:border-0 cursor-pointer
                                     hover:bg-white/[.06] hover:translate-x-0.5 rounded
                                     transition-[background-color,transform] duration-150 group"
                        >
                          <td className="py-2 text-xs text-white/25 w-7 font-mono">
                            {(globalIdx + 1).toString().padStart(2, "0")}
                          </td>
                          <td className="py-2 font-medium text-white/80 group-hover:text-blue-300 underline-offset-2 group-hover:underline transition-colors">
                            {w.word}
                          </td>
                          <td className="py-2 text-right text-xs text-white/35">
                            {w.count.toLocaleString()}
                          </td>
                          <td className="py-2 pl-2 text-white/20 group-hover:text-white/50 transition-colors">
                            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4.5 2L7.5 6l-3 4" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination controls */}
              {rankTotalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[.05]">
                  <button
                    onClick={() => setRankPage((p) => Math.max(0, p - 1))}
                    disabled={rankPage === 0}
                    className="flex items-center gap-1 text-xs text-white/45 hover:text-white/80
                               disabled:opacity-25 disabled:pointer-events-none transition-colors"
                  >
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7.5 2L4.5 6l3 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Prev
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: rankTotalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setRankPage(i)}
                        className={`w-5 h-5 rounded text-[10px] transition-colors
                          ${i === rankPage
                            ? "bg-blue-500/30 text-blue-300"
                            : "text-white/30 hover:text-white/60 hover:bg-white/[.06]"}`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setRankPage((p) => Math.min(rankTotalPages - 1, p + 1))}
                    disabled={rankPage === rankTotalPages - 1}
                    className="flex items-center gap-1 text-xs text-white/45 hover:text-white/80
                               disabled:opacity-25 disabled:pointer-events-none transition-colors"
                  >
                    Next
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4.5 2L7.5 6l-3 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>

          {/* Dictionary moved to its own /dictionary page (Merriam-Webster
              style). Top Slang now focuses purely on the trending chart +
              ranked list, with a clear pointer to the full dictionary. */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="card p-4 mb-4 flex items-center justify-between gap-3 flex-wrap"
          >
            <div>
              <p className="text-sm text-white/85 font-medium">
                Browse the full dictionary
              </p>
              <p className="text-xs text-white/45 mt-0.5">
                {Object.keys(lexicon).length} entries — alphabetical, with definitions, origins, and examples
              </p>
            </div>
            <Link
              href="/dictionary"
              className="btn-primary w-auto px-5 py-2 text-sm flex items-center gap-2"
            >
              Open dictionary →
            </Link>
          </motion.div>
        </>
      )}

      {!loading && !error && words.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="card p-10 text-center"
        >
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-base font-medium text-white/70 mb-1">No data yet</p>
          <p className="text-sm text-white/45 mb-5 max-w-sm mx-auto">
            {period === "today"
              ? "No posts were processed today. Try the Overall view or come back later."
              : "No slang words have been tracked yet. The scraper may still be warming up."}
          </p>
          <button
            onClick={() => load(n, period, true)}
            className="btn-primary w-auto px-5 py-2 text-sm"
          >
            Refresh
          </button>
        </motion.div>
      )}

      {loading && words.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <motion.span
            className="w-9 h-9 rounded-full"
            style={{
              background: "conic-gradient(from 0deg, transparent 0%, #60a5fa 60%, transparent 100%)",
              mask: "radial-gradient(circle, transparent 58%, #000 59%)",
              WebkitMask: "radial-gradient(circle, transparent 58%, #000 59%)",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-white/35 text-sm">Scanning posts…</p>
        </div>
      )}
    </div>
  );
}

