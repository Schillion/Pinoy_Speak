"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
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
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [words,    setWords]    = useState<SlangWord[]>([]);
  const [lexicon,  setLexicon]  = useState<Record<string, LexiconEntry>>({});
  const [n,        setN]        = useState<TopN>(15);
  const [period,   setPeriod]   = useState<"today" | "overall">("overall");
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [selected, setSelected] = useState<{ word: SlangWord; anchor: { x: number; y: number } | null } | null>(null);
  const reqId = useRef(0);

  const openWord = (word: SlangWord, e?: React.MouseEvent) => {
    const anchor = e ? { x: e.clientX, y: e.clientY } : null;
    setSelected({ word, anchor });
  };

  const draggedRef = useRef(false);

  const load = useCallback(async (count: TopN, p: "today" | "overall") => {
    const id = ++reqId.current;
    setLoading(true);
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
      if (id === reqId.current) setLoading(false);
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
          <div className="flex rounded-lg overflow-hidden border border-white/[.08] bg-white/[.04]">
            {(["today", "overall"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm capitalize transition-colors
                  ${period === p
                    ? "bg-white/[.12] text-white font-medium"
                    : "text-white/45 hover:text-white/70"}`}
              >
                {p === "today" ? "Today" : "Overall"}
              </button>
            ))}
          </div>
          <TopNSelect value={n} onChange={setN} options={[10, 15, 20, 30, "all"]} />
          <MagneticButton
            onClick={() => load(n, period)}
            disabled={loading}
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

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {words.length > 0 && (
        <>
          <motion.div
            variants={staggerContainer(0.1)} initial="hidden" animate="show"
            className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8 items-stretch"
          >
            <motion.div variants={fadeUp} className="lg:col-span-2 card spotlight p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-white/35 uppercase tracking-wider">Usage frequency</p>
                <span className="text-[10px] text-white/25 hidden sm:inline">Click a bar for details</span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                <BarChart
                  data={words}
                  barCategoryGap="22%"
                  barGap={0}
                  margin={{ top: 4, right: 4, bottom: 28, left: 0 }}
                >
                  <defs>
                    {BAR_COLORS.map((c, i) => (
                      <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={c} stopOpacity={0.35} />
                      </linearGradient>
                    ))}
                  </defs>
                  <XAxis dataKey="word" tick={{ fontSize: 10 }}
                         angle={-40} textAnchor="end" interval="preserveStartEnd"
                         minTickGap={8}
                         type="category" />
                  <YAxis tick={{ fontSize: 10 }} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: isLight ? "rgba(255,255,255,0.97)" : "rgba(7,14,28,0.92)",
                      backdropFilter: "blur(12px)",
                      border: isLight ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(96,165,250,0.25)",
                      borderRadius: 12,
                      boxShadow: isLight ? "0 4px 20px -6px rgba(15,23,42,0.15)" : "0 0 30px -8px rgba(96,165,250,0.4)",
                    }}
                    labelStyle={{ color: isLight ? "rgba(15,23,42,0.85)" : "#e2e8f0", fontWeight: 600 }}
                    itemStyle={{ color: isLight ? "rgba(15,23,42,0.72)" : "#e2e8f0" }}
                    cursor={{ fill: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,.04)" }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}
                       maxBarSize={32}
                       style={{ cursor: "pointer" }}
                       animationDuration={900}
                       onClick={(data) => {
                         const w = words.find((x) => x.word === data.word);
                         if (w) setSelected({ word: w, anchor: null });
                       }}>
                    {words.map((_, i) => (
                      <Cell key={i} fill={`url(#bar-grad-${i % BAR_COLORS.length})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="card spotlight p-4 flex flex-col">
              <p className="text-xs text-white/35 uppercase tracking-wider mb-3">Ranked list</p>
              <div className="overflow-y-auto flex-1 min-h-0" style={{ minHeight: 300 }}>
                <table className="w-full text-sm">
                  <tbody>
                    {words.map((w, i) => (
                      <tr
                        key={w.word}
                        onClick={(e) => openWord(w, e)}
                        className="border-b border-white/[.04] last:border-0 cursor-pointer
                                   hover:bg-white/[.04] hover:translate-x-0.5
                                   transition-[background-color,transform] duration-150 group"
                      >
                        <td className="py-2 text-xs text-white/25 w-7 font-mono">
                          {(i + 1).toString().padStart(2, "0")}
                        </td>
                        <td className="py-2 font-medium text-white/80 group-hover:text-gradient-static transition-colors">
                          {w.word}
                        </td>
                        <td className="py-2 text-right text-xs text-white/35">
                          {w.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

