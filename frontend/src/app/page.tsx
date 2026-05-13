"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Sector, CartesianGrid,
} from "recharts";
import MetricCard from "@/components/MetricCard";
import TiltCard from "@/components/TiltCard";
import RevealText from "@/components/RevealText";
import { fetchCorpusStats, fetchTopSlang, fetchWordTrends, fetchLanguageMix } from "@/lib/api";
import type { CorpusStats, SlangWord } from "@/types";
import SlangModal from "./_components/SlangModal";
import { fadeUp, fadeUpSoft, staggerContainer } from "@/lib/motion";
import { useTheme } from "@/context/ThemeContext";

// Fallback shape used while the real /language-mix call is loading or if
// the backend is offline. Real values overwrite this.
const MOCK_LANG = [
  { name: "Taglish", value: 40 },
  { name: "Tagalog", value: 30 },
  { name: "English", value: 20 },
  { name: "Slang",   value: 10 },
];
// Pie (Language Mix) — cool blues/purples, distinct from the word chart palette
const PIE_COLORS = ["#60a5fa", "#a78bfa", "#22d3ee", "#f472b6"];

// Word popularity area chart — warm/contrasting palette so users don't confuse
// the two charts side-by-side
const WORD_COLORS = ["#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const RANGES = [
  { label: "7d",  fullLabel: "7 days",   days: 7 },
  { label: "30d", fullLabel: "30 days",  days: 30 },
  { label: "3mo", fullLabel: "3 months", days: 90 },
  { label: "6mo", fullLabel: "6 months", days: 180 },
  { label: "1yr", fullLabel: "1 year",   days: 365 },
];

const STEPS = [
  {
    step: "01",
    title: "Dictionary Check",
    body:  "We check if the word exists in Filipino and English dictionaries.",
    note:  '"Lamesa" is a real word. "Forda" is not — likely slang.',
    accent: "from-blue-500/20 to-cyan-500/10",
  },
  {
    step: "02",
    title: "Trend Detection",
    body:  "We track how often a word appears over time. Sudden spikes signal trending slang.",
    note:  'If "omsim" goes from rare to everywhere overnight — slang trend.',
    accent: "from-purple-500/20 to-blue-500/10",
  },
  {
    step: "03",
    title: "Meaning Shift",
    body:  "Some dictionary words take on new meaning in Filipino online speech.",
    note:  '"Solid" means firm. Online it means "I support you" — a shift.',
    accent: "from-pink-500/20 to-purple-500/10",
  },
];

const ALL_SUBREDDITS = [
  "Philippines","CasualPH","truePhilippines","AskPH",
  "studentsph","peyups","Tomasino","ADMU","dlsu","RateUPProfs",
  "phinvest","phcareers","buhaydigital","phmoneysaving",
  "filipinofood","PHitness","beautytalkph",
  "phgaming","PHGamers","mobilelegendsPINAS","PinoyAnime",
  "OPM","indiemusicph",
  "PHmemes","pinoymemes","pinoypasttensed",
  "ChikaPH","TiktokPH",
  "adultingph","PanganaySupportGroup","BPOinPH",
  "phclassifieds","Cebu","Manila",
  "PinoyProgrammer","InternetPH",
  "OffMyChestPH","MentalHealthPH","PHsports",
];

const TICK_SIZE: Record<string, number> = { small: 9, medium: 10, large: 11, xlarge: 12, xxlarge: 13, xxxlarge: 14 };

export default function Home() {
  const { theme, fontSize } = useTheme();
  const isLight = theme === "light";
  const tickFs = TICK_SIZE[fontSize] ?? 10;
  const [stats, setStats]         = useState<CorpusStats | null>(null);
  const [showSubInfo, setShowSubInfo] = useState(false);
  const [topWords, setTopWords]   = useState<SlangWord[]>([]);
  const [range, setRange]         = useState(30);
  const [modalWord, setModalWord] = useState<string | null>(null);
  const closeModal = useCallback(() => setModalWord(null), []);
  const topNReqId = useRef(0);
  const TREND_WORDS = 50;

  // Wheel-zoom + drag-to-pan state for the area chart
  const [zoomDom, setZoomDom] = useState<[string, string] | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [hiddenWords, setHiddenWords] = useState(new Set<string>());
  const [focusedWord, setFocusedWord] = useState<string | null>(null);
  const toggleWord = useCallback((word: string) => {
    setHiddenWords((prev) => {
      const next = new Set(prev);
      next.has(word) ? next.delete(word) : next.add(word);
      return next;
    });
  }, []);
  const lastSeriesRef = useRef<Record<string, number[]>>({});
  const lastWordsRef  = useRef<string[]>([]);
  function computeDefaultHidden(words: string[], series: Record<string, number[]>, visN = 10): Set<string> {
    const sorted = [...words].sort(
      (a, b) => (series[b] ?? []).reduce((s, v) => s + v, 0) - (series[a] ?? []).reduce((s, v) => s + v, 0)
    );
    const top = new Set(sorted.slice(0, visN));
    return new Set(words.filter(w => !top.has(w)));
  }
  // Active drag — pixel-anchored. Using data coordinates fails because the
  // chart's visible domain shifts mid-drag (when we call setZoomDom), which
  // means the same screen pixel maps to a different `activeLabel` after each
  // re-render and the pan accumulates wildly.
  const panRef = useRef<{ startX: number; startSI: number; startEI: number; rangeLen: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCorpusStats().then(setStats).catch(() => null);
    const interval = setInterval(
      () => fetchCorpusStats().then(setStats).catch(() => null),
      120_000,
    );
    return () => clearInterval(interval);
  }, []);

  // Real per-corpus language mix — replaces the hardcoded MOCK_LANG.
  // Cached server-side for 30 min so this is cheap on every page load.
  const [langMix, setLangMix] = useState<{ name: string; value: number }[]>(MOCK_LANG);
  const [langMixAvailable, setLangMixAvailable] = useState(false);
  useEffect(() => {
    fetchLanguageMix()
      .then((res) => {
        if (res.available && res.data.length > 0) {
          setLangMix(res.data.map(({ name, value }) => ({ name, value })));
          setLangMixAvailable(true);
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const id = ++topNReqId.current;
    fetchTopSlang(15)
      .then((words) => { if (id === topNReqId.current) setTopWords(words); })
      .catch(() => null);
  }, []);

  // Reset zoom when range changes; hidden-word filter resets to default in the data fetch
  useEffect(() => {
    setZoomDom(null);
    panRef.current = null;
    setPanning(false);
    setFocusedWord(null);
    setHiddenWords(computeDefaultHidden(lastWordsRef.current, lastSeriesRef.current));
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real per-day trends — top-N words are chosen within the selected window,
  // so the chart reflects what was actually popular during that period.
  type TrendRow = { day: string; [word: string]: string | number };
  const [trendData, setTrendData]       = useState<TrendRow[]>([]);
  const [chartWords, setChartWords]     = useState<string[]>([]);
  const [trendsAvailable, setTrendsAvailable] = useState(true);
  const [trendsLoading, setTrendsLoading]     = useState(true);
  const trendsReqId = useRef(0);

  useEffect(() => {
    const id = ++trendsReqId.current;
    setTrendsLoading(true);
    fetchWordTrends(TREND_WORDS, range)
      .then((res) => {
        if (id !== trendsReqId.current) return;
        setTrendsAvailable(res.available);
        const wordList = res.words ?? [];
        lastSeriesRef.current = res.series;
        lastWordsRef.current  = wordList;
        setChartWords(wordList);
        setHiddenWords(computeDefaultHidden(wordList, res.series));
        if (!res.days.length) { setTrendData([]); return; }
        const points: TrendRow[] = res.days.map((day, i) => {
          const row: TrendRow = { day };
          for (const w of wordList) {
            row[w] = res.series[w]?.[i] ?? 0;
          }
          return row;
        });
        setTrendData(points);
        setTrendsLoading(false);
      })
      .catch(() => {
        if (id !== trendsReqId.current) return;
        setTrendsAvailable(false);
        setTrendData([]);
        setTrendsLoading(false);
      });
  }, [range]);

  const COLORS = WORD_COLORS;
  const colorMap = useMemo(
    () => Object.fromEntries(chartWords.map((w, i) => [w, COLORS[i % COLORS.length]])),
    [chartWords], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tickFormatter = (val: string) => range > 90 ? val.slice(0, 7) : val.slice(5);
  const tickInterval  = Math.max(0, Math.floor(range / 6) - 1);

  // Snapshot the latest values into refs so the wheel handler can read them
  // without re-binding the listener every time a mouse move changes `hoverDay`.
  // (Re-binding many times per second creates gaps where wheel events get
  // dropped — that's why scroll-to-zoom appeared to "not work".)
  const trendDataRef = useRef(trendData);
  const zoomDomRef   = useRef(zoomDom);
  const hoverDayRef  = useRef(hoverDay);
  useEffect(() => { trendDataRef.current = trendData; }, [trendData]);
  useEffect(() => { zoomDomRef.current   = zoomDom;   }, [zoomDom]);
  useEffect(() => { hoverDayRef.current  = hoverDay;  }, [hoverDay]);

  const zoomIndices = useCallback((): [number, number] => {
    const data = trendDataRef.current;
    const dom  = zoomDomRef.current;
    if (data.length === 0) return [0, 0];
    if (!dom) return [0, data.length - 1];
    const s = data.findIndex((d) => d.day === dom[0]);
    const e = data.findIndex((d) => d.day === dom[1]);
    return [s < 0 ? 0 : s, e < 0 ? data.length - 1 : e];
  }, []);

  // Wheel-to-zoom — bound ONCE per chart-element lifetime.
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const data = trendDataRef.current;
      if (data.length === 0) return;
      e.preventDefault();
      const fullEnd = data.length - 1;
      const [sIdx, eIdx] = zoomIndices();
      const rangeLen = eIdx - sIdx + 1;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;     // scroll up = zoom in
      const newRange = Math.max(3, Math.min(data.length, Math.round(rangeLen * factor)));
      if (newRange >= data.length) { setZoomDom(null); return; }
      if (newRange === rangeLen) return;

      const hover = hoverDayRef.current;
      const anchorIdx = hover ? data.findIndex((d) => d.day === hover) : Math.round((sIdx + eIdx) / 2);
      const anchor = anchorIdx >= 0 ? anchorIdx : Math.round((sIdx + eIdx) / 2);

      const frac = rangeLen > 1 ? (anchor - sIdx) / (rangeLen - 1) : 0.5;
      let newStart = Math.round(anchor - frac * (newRange - 1));
      let newEnd   = newStart + newRange - 1;
      if (newStart < 0)        { newEnd -= newStart; newStart = 0; }
      if (newEnd   > fullEnd)  { newStart -= (newEnd - fullEnd); newEnd = fullEnd; }
      newStart = Math.max(0, newStart);
      newEnd   = Math.min(fullEnd, newEnd);

      setZoomDom([data[newStart].day, data[newEnd].day]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomIndices]);

  // End drag globally — fires even when the user releases outside the chart
  useEffect(() => {
    if (!panning) return;
    const onUp = () => { panRef.current = null; setPanning(false); };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [panning]);

  return (
    <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="show">
      {/* Hero */}
      <motion.div variants={fadeUpSoft} className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 leading-tight">
          <RevealText
            text="Overview"
            as="span"
            split="char"
            stagger={0.045}
            className="text-shimmer"
          />
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-base text-white/55 max-w-2xl leading-relaxed"
        >
          Pinoy Speak tracks Filipino slang across social media — detecting new words,
          usage trends, and meaning shifts in real time.
        </motion.p>
      </motion.div>

      {/* Stats */}
      <motion.p variants={fadeUp} className="text-xs text-white/35 uppercase tracking-wider mb-3">
        Live stats
      </motion.p>
      <motion.div variants={staggerContainer(0.08)} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats === null ? (
          // Skeleton — matches metric-card dimensions so the layout doesn't
          // jump when real numbers come in
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="rounded-2xl border border-white/[.07] bg-gradient-to-br
                           from-white/[.04] to-white/[.01] p-5 h-[112px] flex flex-col justify-between"
              >
                <div className="shimmer h-3 w-24 rounded" />
                <div className="shimmer h-7 w-16 rounded" />
                <div className="shimmer h-3 w-20 rounded" />
              </motion.div>
            ))}
          </>
        ) : (
          <>
            <motion.div variants={fadeUp}>
              <MetricCard
                label="Top word right now"
                value={stats?.top_slang ?? "—"}
                sub="All-time across all posts"
                accent="purple"
                onClick={
                  stats?.top_slang && stats.top_slang !== "—"
                    ? () => setModalWord(stats.top_slang)
                    : undefined
                }
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <MetricCard
                label="Slang words tracked"
                value={stats?.slang_count ?? 0}
                sub="In our dictionary"
                accent="blue"
              />
            </motion.div>
            <motion.div variants={fadeUp} className="relative">
              <MetricCard
                label="Posts collected"
                value={stats?.total_posts ?? 0}
                sub={`${ALL_SUBREDDITS.length} subreddits`}
                accent="cyan"
              />
              <button
                onClick={() => setShowSubInfo((v) => !v)}
                className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center
                           text-[10px] font-bold text-white/40 hover:text-white/80 border border-white/20
                           hover:border-white/50 transition-colors"
                aria-label="Show all subreddits"
              >
                i
              </button>
              {showSubInfo && (
                <div className="absolute top-10 right-0 z-50 w-72 rounded-xl p-3
                                bg-[#0a1224]/95 backdrop-blur-xl border border-white/[.08]
                                shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">All scraped subreddits</p>
                  <div className="flex flex-wrap gap-1">
                    {ALL_SUBREDDITS.map((s) => (
                      <span key={s} className="text-[10px] bg-white/[.06] rounded px-1.5 py-0.5 text-white/60">
                        r/{s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </motion.div>

      {modalWord && <SlangModal word={modalWord} onClose={closeModal} />}

      {/* Data disclaimer */}
      <motion.div
        variants={fadeUp}
        className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                   bg-white/[.03] border border-white/[.06] mb-1"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-white/30" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-5h1.5v5zm0-6.5h-1.5V3.5h1.5V5z"/>
        </svg>
        <p className="text-[11px] text-white/35 leading-relaxed">
          Data is currently sourced from Reddit posts only. Results may not fully represent all Filipino slang in use — coverage will improve as more sources are added.
        </p>
      </motion.div>

      {/* Charts */}
      <motion.div variants={staggerContainer(0.1)} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div variants={fadeUp} className="lg:col-span-2 card spotlight p-5 flex flex-col">
          {/* Header: title + segmented range control */}
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <p className="text-xs text-amber-300/80 uppercase tracking-wider font-semibold">
                Word popularity over time
              </p>
              <p className="text-[11px] text-white/35 mt-0.5">
                Hover a word pill to highlight · click to show/hide · scroll chart to zoom
              </p>
            </div>
            {/* Segmented range control */}
            <div className="flex items-center bg-white/[.04] border border-white/[.07] rounded-xl p-0.5 flex-shrink-0">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRange(r.days)}
                  className={`relative px-2 sm:px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-all
                    ${range === r.days ? "text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  {range === r.days && (
                    <motion.span
                      layoutId="home-range-pill"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500/30 to-purple-500/30 border border-blue-400/30"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative sm:hidden">{r.label}</span>
                  <span className="relative hidden sm:inline">{r.fullLabel}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Word pills legend */}
          {chartWords.length > 0 && (() => {
            const visible = chartWords.filter(w => !hiddenWords.has(w));
            const sorted  = [...chartWords].sort((a, b) => {
              const ah = hiddenWords.has(a), bh = hiddenWords.has(b);
              return ah !== bh ? (ah ? 1 : -1) : 0;
            });
            return (
              <div className="mb-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <p className="text-[10px] text-white/30">
                    Showing <span className="text-white/55 font-medium">{visible.length}</span> of{" "}
                    <span className="text-white/55 font-medium">{chartWords.length}</span> words
                  </p>
                  {/* Top 10 / All segmented toggle */}
                  <div className="flex items-center bg-white/[.03] border border-white/[.06] rounded-lg p-0.5">
                    <button
                      onClick={() => setHiddenWords(computeDefaultHidden(lastWordsRef.current, lastSeriesRef.current))}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all
                        ${hiddenWords.size > 0 ? "text-white/80 bg-white/[.08]" : "text-white/35 hover:text-white/55"}`}
                    >
                      Top 10
                    </button>
                    <button
                      onClick={() => setHiddenWords(new Set())}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all
                        ${hiddenWords.size === 0 ? "text-white/80 bg-white/[.08]" : "text-white/35 hover:text-white/55"}`}
                    >
                      All ({chartWords.length})
                    </button>
                  </div>
                </div>
                <div
                  className="flex flex-wrap gap-1.5 max-h-[92px] overflow-y-auto pr-1 pb-0.5"
                  onMouseLeave={() => setFocusedWord(null)}
                >
                  {sorted.map((word) => {
                    const isHidden  = hiddenWords.has(word);
                    const isFocused = focusedWord === word;
                    const color     = colorMap[word];
                    return (
                      <button
                        key={word}
                        onClick={() => toggleWord(word)}
                        onMouseEnter={() => !isHidden && setFocusedWord(word)}
                        onMouseLeave={() => setFocusedWord(null)}
                        title={isHidden ? `Show "${word}"` : `Hide "${word}"`}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                                    border transition-all duration-150 select-none cursor-pointer
                                    ${isHidden
                                      ? "border-white/[.06] bg-transparent text-white/25 line-through"
                                      : "hover:scale-[1.04] active:scale-95"}`}
                        style={!isHidden ? {
                          borderColor: `${color}55`,
                          backgroundColor: `${color}18`,
                          color: isFocused ? "#fff" : "rgba(255,255,255,0.75)",
                          boxShadow: isFocused ? `0 0 0 2px ${color}55, 0 0 14px -4px ${color}66` : undefined,
                        } : undefined}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: isHidden ? "rgba(255,255,255,0.15)" : color }}
                        />
                        {word}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Zoom hint + Reset Zoom */}
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap min-h-[24px]">
            {!trendsAvailable ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest font-semibold
                                 text-amber-300/90 bg-amber-500/[.10] border border-amber-400/30
                                 px-1.5 py-0.5 rounded">
                  No data
                </span>
                <p className="text-[11px] text-white/35">Word trend data is still loading — refresh in a moment</p>
              </div>
            ) : (
              <p className="text-[11px] text-white/35 flex items-center gap-1.5">
                <svg viewBox="0 0 14 14" className="w-3 h-3 flex-shrink-0 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5.5" cy="5.5" r="4"/><line x1="9" y1="9" x2="13" y2="13"/>
                  <line x1="5.5" y1="3.5" x2="5.5" y2="7.5"/><line x1="3.5" y1="5.5" x2="7.5" y2="5.5"/>
                </svg>
                <span className="hidden sm:inline">Scroll on chart to zoom{zoomDom ? " · drag to pan" : ""}</span>
                <span className="sm:hidden">Pinch or scroll to zoom</span>
              </p>
            )}
            {zoomDom && (
              <motion.button
                initial={{ opacity: 0, x: 4 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setZoomDom(null)}
                className="text-[11px] font-medium text-blue-300 hover:text-blue-200 transition-colors
                           border border-blue-400/40 rounded-md px-2.5 py-1
                           bg-blue-500/[.12] hover:bg-blue-500/[.20] flex items-center gap-1"
              >
                <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 6a5 5 0 105-5H4M4 1L2 3l2 2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Reset zoom
              </motion.button>
            )}
          </div>

          {/* Chart */}
          <div ref={chartWrapRef} className="flex-1 min-h-0 relative" style={{ overscrollBehavior: "contain", touchAction: "pan-y", minHeight: 280 }}>
            {trendsLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-xl bg-[#0a1224]/40 backdrop-blur-[2px]">
                <div className="w-7 h-7 rounded-full border-2 border-white/10 border-t-blue-400 animate-spin" />
                <p className="text-[11px] text-white/35">Loading trend data…</p>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={zoomDom ? trendData.slice(zoomIndices()[0], zoomIndices()[1] + 1) : trendData}
                margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                onMouseDown={(e) => {
                  if (!e || trendData.length === 0) return;
                  const x = (e as { chartX?: number }).chartX;
                  if (typeof x !== "number") return;
                  const [sIdx, eIdx] = zoomIndices();
                  panRef.current = {
                    startX:  x,
                    startSI: sIdx,
                    startEI: eIdx,
                    rangeLen: eIdx - sIdx + 1,
                  };
                  setPanning(true);
                }}
                onMouseMove={(e) => {
                  if (!e) return;
                  if (e.activeLabel) setHoverDay(String(e.activeLabel));
                  const p = panRef.current;
                  if (!p) return;
                  const x = (e as { chartX?: number }).chartX;
                  if (typeof x !== "number") return;
                  const wrapWidth = chartWrapRef.current?.clientWidth ?? 600;
                  const plotWidth = Math.max(100, wrapWidth - 34);
                  const pixelDelta = x - p.startX;
                  const indexDelta = Math.round(-(pixelDelta / plotWidth) * p.rangeLen);
                  if (indexDelta === 0) return;
                  const fullEnd = trendData.length - 1;
                  let newSI = p.startSI + indexDelta;
                  let newEI = p.startEI + indexDelta;
                  if (newSI < 0)       { newEI -= newSI; newSI = 0; }
                  if (newEI > fullEnd) { newSI -= (newEI - fullEnd); newEI = fullEnd; }
                  newSI = Math.max(0, newSI);
                  newEI = Math.min(fullEnd, newEI);
                  if (newEI - newSI + 1 >= trendData.length) {
                    setZoomDom(null);
                  } else {
                    setZoomDom([trendData[newSI].day, trendData[newEI].day]);
                  }
                }}
                onMouseLeave={() => { setHoverDay(null); }}
                style={{
                  cursor: panning ? "grabbing" : (zoomDom ? "grab" : "crosshair"),
                  userSelect: "none",
                }}
              >
                <defs>
                  {COLORS.map((c, i) => (
                    <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={0.20} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.01} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: tickFs, fill: "rgba(255,255,255,0.35)" }}
                  tickFormatter={tickFormatter}
                  interval={tickInterval}
                  axisLine={false}
                  tickLine={false}
                  type="category"
                />
                <YAxis
                  tick={{ fontSize: tickFs, fill: isLight ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.35)" }}
                  width={30}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const items = (payload as Array<{ name: string; value: number; color: string }>)
                      .filter((p) => p.value > 0)
                      .sort((a, b) => b.value - a.value);
                    if (items.length === 0) return null;
                    const dayTotal = items.reduce((s, p) => s + p.value, 0);
                    return (
                      <div style={{
                        background: isLight ? "rgba(255,255,255,0.97)" : "rgba(7,14,28,0.96)",
                        backdropFilter: "blur(12px)",
                        border: isLight ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(96,165,250,0.2)",
                        borderRadius: 12,
                        padding: "10px 14px",
                        boxShadow: isLight ? "0 4px 20px -6px rgba(15,23,42,0.15)" : "0 0 30px -8px rgba(96,165,250,0.35)",
                        minWidth: 155,
                        maxWidth: 220,
                      }}>
                        <p style={{ color: isLight ? "rgba(15,23,42,0.55)" : "rgba(226,232,240,0.4)", fontSize: tickFs + 1, marginBottom: 6 }}>{String(label)}</p>
                        {items.map(({ name, value, color }) => {
                          const pct = dayTotal > 0 ? Math.round((value / dayTotal) * 100) : 0;
                          return (
                            <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ display: "inline-block", width: 20, height: 3, borderRadius: 99, background: color, flexShrink: 0 }} />
                              <span style={{ color: isLight ? "rgba(15,23,42,0.85)" : "rgba(226,232,240,0.85)", fontSize: tickFs + 2, flex: 1 }}>{name}</span>
                              <span style={{ color: isLight ? "rgba(15,23,42,0.55)" : "rgba(226,232,240,0.55)", fontSize: tickFs + 2, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                              {items.length > 1 && <span style={{ color: "rgba(255,255,255,0.22)", fontSize: tickFs - 1, minWidth: 28, textAlign: "right" }}>{pct}%</span>}
                            </div>
                          );
                        })}
                        {items.length > 1 && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "rgba(255,255,255,0.28)", fontSize: tickFs }}>Total</span>
                            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: tickFs + 1, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{dayTotal}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {chartWords.map((word, i) => {
                  if (hiddenWords.has(word)) return null;
                  const color       = colorMap[word];
                  const isFocused   = focusedWord === word;
                  const isDefocused = focusedWord !== null && !isFocused;
                  return (
                    <Area
                      key={word}
                      type="monotone"
                      dataKey={word}
                      stroke={color}
                      fill={`url(#grad-${i % COLORS.length})`}
                      strokeWidth={isFocused ? 3 : isDefocused ? 1 : 2}
                      strokeOpacity={isDefocused ? 0.12 : 1}
                      fillOpacity={isDefocused ? 0 : 1}
                      activeDot={{ r: isFocused ? 5 : 3, strokeWidth: 0, fill: color }}
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="card spotlight p-5">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <p className="text-xs text-white/35 uppercase tracking-wider">Language mix</p>
          </div>
          <div className="relative">
            {!langMixAvailable && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-xl bg-[#0a1224]/40 backdrop-blur-[2px]">
                <div className="w-7 h-7 rounded-full border-2 border-white/10 border-t-purple-400 animate-spin" />
                <p className="text-[11px] text-white/35">Loading…</p>
              </div>
            )}
            <LanguageMix data={langMix} colors={PIE_COLORS} />
          </div>
        </motion.div>
      </motion.div>

      {/* What this project is for */}
      <motion.div variants={fadeUp} className="mt-12 mb-12">
        <p className="text-xs text-blue-300/80 uppercase tracking-wider mb-3 font-semibold">
          Why this exists
        </p>
        <div className="card p-6 max-w-4xl">
          <p className="text-[15px] text-white/75 leading-relaxed mb-3">
            Filipino slang evolves <span className="text-gradient-static font-semibold">faster than any dictionary
            can keep up with.</span> Words like <span className="text-blue-200">petmalu</span>,
            {" "}<span className="text-blue-200">lodi</span>, <span className="text-blue-200">charot</span>,
            and <span className="text-blue-200">sana all</span> appear, mutate, and shift meaning
            in months — not decades.
          </p>
          <p className="text-[15px] text-white/65 leading-relaxed mb-4">
            Pinoy Speak is a research tool that watches real Filipino social
            media in real time and answers three questions:
          </p>
          <ul className="space-y-2 text-sm text-white/70 mb-3">
            <li className="flex items-start gap-2.5">
              <span className="text-blue-300 mt-0.5 flex-shrink-0">①</span>
              <span><span className="text-white font-medium">What new slang is trending?</span> — tracks word frequency over time and flags sudden spikes.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-purple-300 mt-0.5 flex-shrink-0">②</span>
              <span><span className="text-white font-medium">Which standard words are gaining new meanings?</span> — uses AI to detect when an everyday word starts appearing alongside unusual neighbors.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-cyan-300 mt-0.5 flex-shrink-0">③</span>
              <span><span className="text-white font-medium">How is each slang word actually used?</span> — pulls real example sentences, grammatical patterns, and the words it commonly appears with.</span>
            </li>
          </ul>
          <p className="text-xs text-white/45 italic leading-relaxed border-t border-white/[.06] pt-3">
            Built as an undergraduate project at the University of the Philippines Los
            Baños — combining AI word models, a Filipino language checker, and free AI APIs to
            keep a living, self-updating dictionary of how Filipinos really speak online.
          </p>
          <p className="text-xs text-white/35 mt-2">
            <span className="font-medium text-white/55">Data sources:</span>{" "}
            Posts are scraped from {ALL_SUBREDDITS.length} Filipino communities on Reddit (r/Philippines, r/CasualPH, r/OPM, r/PHmemes, and more).
            New slang words are also discovered from Reddit threads, Wikipedia, and LLM brainstorming.
          </p>
          <div className="mt-3 pt-3 border-t border-white/[.06] flex items-start gap-2">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-white/25" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-5h1.5v5zm0-6.5h-1.5V3.5h1.5V5z"/>
            </svg>
            <p className="text-xs text-white/35 leading-relaxed">
              <span className="font-medium text-white/50">Privacy notice:</span>{" "}
              Only publicly visible Reddit posts are collected — no private messages, no account details, and no personal identifiers are stored.
              Post text is used solely for linguistic research. This site has no user accounts, no login, and sets no tracking cookies.
            </p>
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <motion.p variants={fadeUp} className="text-xs text-white/35 uppercase tracking-wider mb-3">
        How it works
      </motion.p>
      <motion.div
        variants={staggerContainer(0.1)}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
      >
        {STEPS.map((c) => (
          <motion.div key={c.step} variants={fadeUp}>
            <TiltCard
              intensity={5}
              className="group card overflow-hidden h-full transition-colors duration-300
                         hover:border-blue-400/30 hover:shadow-[0_0_40px_-10px_rgba(96,165,250,0.45)]"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.accent} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
              <div className="relative p-5">
                <p className="text-xs text-gradient-static font-mono mb-2">{c.step}</p>
                <p className="font-semibold text-white text-base mb-2">{c.title}</p>
                <p className="text-sm text-white/60 leading-relaxed mb-3">{c.body}</p>
                <p className="text-sm text-white/35 italic leading-relaxed">{c.note}</p>
              </div>
            </TiltCard>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function LanguageMix({
  data, colors,
}: {
  data: { name: string; value: number }[];
  colors: string[];
}) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total      = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const active     = activeIndex != null ? data[activeIndex] : null;
  const activeColor = activeIndex != null ? colors[activeIndex % colors.length] : "#ffffff";
  const activePct  = active ? (active.value / total) * 100 : 100;

  const renderActiveShape = (props: {
    cx?: number; cy?: number;
    innerRadius?: number; outerRadius?: number;
    startAngle?: number; endAngle?: number;
    fill?: string;
  }) => {
    const { cx, cy, innerRadius, outerRadius = 0, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius}
          outerRadius={outerRadius + 7} startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 10} outerRadius={outerRadius + 13}
          startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.3} />
      </g>
    );
  };

  return (
    <div>
      <div className="relative" style={{ height: 220 }}>
        {/* Ambient glow behind the ring */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-52 h-52 rounded-full opacity-15 blur-2xl"
               style={{ background: `conic-gradient(${colors.map((c, i) => `${c} ${i * (100/colors.length)}%`).join(", ")})` }} />
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={60}
              outerRadius={88}
              paddingAngle={3}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              activeIndex={activeIndex ?? -1}
              activeShape={renderActiveShape}
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              animationDuration={1100}
              animationBegin={200}
              animationEasing="ease-out"
              isAnimationActive
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]}
                      style={{ filter: activeIndex === i ? `drop-shadow(0 0 6px ${colors[i % colors.length]})` : undefined }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={active?.name ?? "total"}
              initial={{ opacity: 0, scale: 0.82, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.82, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="text-center"
            >
              <div className="text-3xl font-bold tabular-nums leading-none"
                   style={{ color: active ? activeColor : (isLight ? "#0f172a" : "#ffffff"),
                            textShadow: active ? `0 0 20px ${activeColor}88` : "none" }}>
                {activePct.toFixed(0)}%
              </div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">
                {active ? active.name : "Total"}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Language Breakdown label */}
      <div className="text-center mt-3 mb-2">
        <p className="text-xs font-semibold text-white/55 uppercase tracking-wider">Language Breakdown</p>
        <p className="text-[11px] text-white/30 mt-0.5">of all collected posts</p>
      </div>

      {/* Legend */}
      <div className="mt-2 space-y-1.5">
        {data.map((d, i) => {
          const pct     = (d.value / total) * 100;
          const isActive = activeIndex === i;
          const color   = colors[i % colors.length];
          return (
            <motion.button
              key={d.name}
              type="button"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              whileHover={{ x: 2 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg
                          text-xs transition-all duration-200
                          ${isActive ? "bg-white/[.06]" : "hover:bg-white/[.03]"}`}
              style={isActive ? { boxShadow: `inset 0 0 0 1px ${color}30` } : undefined}
            >
              <motion.span
                animate={{ scale: isActive ? 1.35 : 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  background: color,
                  boxShadow: isActive
                    ? `0 0 8px ${color}, 0 0 16px ${color}55`
                    : `0 0 4px ${color}44`,
                }}
              />
              <span className={`w-16 flex-shrink-0 text-left font-medium
                                ${isActive ? "text-white/90" : "text-white/55"}`}>
                {d.name}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-white/[.06] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 1.1, delay: 0.3 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${color}, ${color}88)`,
                    opacity: isActive ? 1 : 0.6,
                    boxShadow: isActive ? `0 0 8px ${color}` : "none",
                  }}
                />
              </div>
              <span className={`tabular-nums text-right w-9 flex-shrink-0 text-[11px] font-medium
                                ${isActive ? "text-white/85" : "text-white/40"}`}>
                {pct.toFixed(0)}%
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
