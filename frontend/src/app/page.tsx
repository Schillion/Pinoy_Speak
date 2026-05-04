"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Sector, Brush, CartesianGrid,
} from "recharts";
import MetricCard from "@/components/MetricCard";
import TiltCard from "@/components/TiltCard";
import RevealText from "@/components/RevealText";
import { fetchCorpusStats, fetchTopSlang, fetchWordTrends, fetchLanguageMix } from "@/lib/api";
import type { CorpusStats, SlangWord } from "@/types";
import SlangModal from "./_components/SlangModal";
import { fadeUp, fadeUpSoft, staggerContainer } from "@/lib/motion";

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
  { label: "7D",  days: 7 },
  { label: "30D", days: 30 },
  { label: "3M",  days: 90 },
  { label: "6M",  days: 180 },
  { label: "1Y",  days: 365 },
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

export default function Home() {
  const [stats, setStats]         = useState<CorpusStats | null>(null);
  const [topWords, setTopWords]   = useState<SlangWord[]>([]);
  const [range, setRange]         = useState(30);
  const [topN, setTopN]           = useState(5);
  const [modalWord, setModalWord] = useState<string | null>(null);
  const closeModal = useCallback(() => setModalWord(null), []);
  const topNReqId = useRef(0);

  // Wheel-zoom + drag-to-pan state for the area chart
  const [zoomDom, setZoomDom] = useState<[string, string] | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  // Active drag — pixel-anchored. Using data coordinates fails because the
  // chart's visible domain shifts mid-drag (when we call setZoomDom), which
  // means the same screen pixel maps to a different `activeLabel` after each
  // re-render and the pan accumulates wildly.
  const panRef = useRef<{ startX: number; startSI: number; startEI: number; rangeLen: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCorpusStats().then(setStats).catch(() => null);
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
    fetchTopSlang(topN)
      .then((words) => { if (id === topNReqId.current) setTopWords(words); })
      .catch(() => null);
  }, [topN]);

  // Reset zoom when the underlying range or word count changes
  useEffect(() => {
    setZoomDom(null);
    panRef.current = null;
    setPanning(false);
  }, [range, topN]);

  // Real per-day trends fetched from the backend's word_freq_map. Falls
  // back to a flat-line shape only when the backend says no corpus is loaded.
  type TrendRow = { day: string; [word: string]: string | number };
  const [trendData, setTrendData] = useState<TrendRow[]>([]);
  const [trendsAvailable, setTrendsAvailable] = useState(true);
  const trendsReqId = useRef(0);

  useEffect(() => {
    if (topWords.length === 0) { setTrendData([]); return; }
    const id = ++trendsReqId.current;
    const wordList = topWords.map((w) => w.word);
    fetchWordTrends(wordList, range)
      .then((res) => {
        if (id !== trendsReqId.current) return;
        setTrendsAvailable(res.available);
        if (!res.days.length) { setTrendData([]); return; }
        const points: TrendRow[] = res.days.map((day, i) => {
          const row: TrendRow = { day };
          for (const w of wordList) {
            row[w] = res.series[w]?.[i] ?? 0;
          }
          return row;
        });
        setTrendData(points);
      })
      .catch(() => {
        if (id !== trendsReqId.current) return;
        setTrendsAvailable(false);
        setTrendData([]);
      });
  }, [topWords, range]);

  const COLORS = WORD_COLORS;
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

      {/* What this project is for */}
      <motion.div variants={fadeUp} className="mb-12">
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
              <span><span className="text-white font-medium">Which standard words are gaining new meanings?</span> — uses semantic embeddings to detect when an everyday word starts hanging out with unusual neighbors.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-cyan-300 mt-0.5 flex-shrink-0">③</span>
              <span><span className="text-white font-medium">How is each slang word actually used?</span> — pulls real example sentences, grammatical patterns, and the words it commonly appears with.</span>
            </li>
          </ul>
          <p className="text-xs text-white/45 italic leading-relaxed border-t border-white/[.06] pt-3">
            Built as an undergraduate project at the University of the Philippines Los
            Baños — combining FastText embeddings, calamanCy NLP, and free LLM APIs to
            keep a living, self-updating dictionary of how Filipinos really speak online.
          </p>
        </div>
      </motion.div>

      {/* How it works */}
      <motion.p variants={fadeUp} className="text-xs text-white/35 uppercase tracking-wider mb-3">
        How it works
      </motion.p>
      <motion.div
        variants={staggerContainer(0.1)}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12"
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

      {/* Stats */}
      <motion.p variants={fadeUp} className="text-xs text-white/35 uppercase tracking-wider mb-3">
        Current pulse
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
                sub="From real posts"
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
                sub="In our lexicon"
                accent="blue"
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <MetricCard
                label="Posts collected"
                value={stats?.total_posts ?? 0}
                sub="From Filipino subreddits"
                accent="cyan"
              />
            </motion.div>
          </>
        )}
      </motion.div>

      {modalWord && <SlangModal word={modalWord} onClose={closeModal} />}

      {/* Charts */}
      <motion.div variants={staggerContainer(0.1)} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div variants={fadeUp} className="lg:col-span-2 card spotlight p-5">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <div>
              <p className="text-xs text-amber-300/80 uppercase tracking-wider font-semibold">
                Word popularity over time
              </p>
              <p className="hidden sm:block text-[11px] text-white/35 mt-0.5">
                Each line tracks one slang word
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* word count stepper */}
              <div className="flex items-center gap-0.5 bg-white/[.04] rounded-lg px-2 py-0.5 border border-white/[.08] backdrop-blur-sm">
                <span className="text-white/35 text-xs mr-1">Top</span>
                <button
                  onClick={() => setTopN((n) => Math.max(1, n - 1))}
                  aria-label="Decrease word count"
                  className="w-8 h-8 flex items-center justify-center rounded text-white/55 hover:text-blue-300 hover:bg-white/[.04] active:bg-white/[.08] text-base font-bold transition-colors"
                >−</button>
                <input
                  type="number" min={1} max={20} value={topN}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1 && v <= 20) setTopN(v); }}
                  aria-label="Number of top words"
                  className="w-7 bg-transparent text-center text-sm text-white/85 focus:outline-none
                             [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => setTopN((n) => Math.min(20, n + 1))}
                  aria-label="Increase word count"
                  className="w-8 h-8 flex items-center justify-center rounded text-white/55 hover:text-blue-300 hover:bg-white/[.04] active:bg-white/[.08] text-base font-bold transition-colors"
                >+</button>
                <span className="text-white/35 text-xs ml-1">words</span>
              </div>
              {/* range buttons */}
              <div className="flex gap-1 relative">
                {RANGES.map((r) => (
                  <button
                    key={r.label}
                    onClick={() => setRange(r.days)}
                    className={`relative px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                      ${range === r.days ? "text-white" : "text-white/40 hover:text-white/70"}`}
                  >
                    {range === r.days && (
                      <motion.span
                        layoutId="home-range-pill"
                        className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500/30 to-purple-500/30 border border-blue-400/30"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Word legend — explicit color → word mapping so readers don't
              confuse this with the categorical Language Mix donut beside it. */}
          {topWords.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 mb-3 overflow-x-auto">
              {topWords.map((w, i) => (
                <div key={w.word} className="flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ background: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-xs text-white/70 font-medium tracking-tight">
                    {w.word}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {trendsAvailable ? (
                <p className="hidden sm:block text-[11px] text-white/35">
                  Per-day occurrences in the corpus · {zoomDom ? "drag to pan · " : ""}scroll to zoom
                </p>
              ) : (
                <>
                  <span className="text-[10px] uppercase tracking-widest font-semibold
                                   text-amber-300/90 bg-amber-500/[.10] border border-amber-400/30
                                   px-1.5 py-0.5 rounded">
                    No data
                  </span>
                  <p className="text-[11px] text-white/35">
                    Backend hasn&apos;t built a frequency map yet — start uvicorn and refresh
                  </p>
                </>
              )}
            </div>
            {zoomDom && (
              <motion.button
                initial={{ opacity: 0, x: 4 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setZoomDom(null)}
                className="text-[11px] text-blue-300 hover:text-blue-200 transition-colors
                           border border-blue-400/30 rounded-md px-2 py-0.5
                           bg-blue-500/[.08] hover:bg-blue-500/[.15]"
              >
                Reset zoom
              </motion.button>
            )}
          </div>
          <div ref={chartWrapRef} style={{ overscrollBehavior: "contain", touchAction: "pan-y" }}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart
              data={trendData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
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

                // Convert pixel delta → data-index delta. We approximate the
                // chart's plot-area width as the wrapper div's width minus axis
                // padding (recharts doesn't expose plot width directly).
                const wrapWidth = chartWrapRef.current?.clientWidth ?? 600;
                const plotWidth = Math.max(100, wrapWidth - 34);   // YAxis ≈ 30px + margins
                const pixelDelta = x - p.startX;
                const indexDelta = Math.round(-(pixelDelta / plotWidth) * p.rangeLen);
                if (indexDelta === 0) return;

                const fullEnd = trendData.length - 1;
                let newSI = p.startSI + indexDelta;
                let newEI = p.startEI + indexDelta;
                if (newSI < 0)        { newEI -= newSI;            newSI = 0; }
                if (newEI > fullEnd)  { newSI -= (newEI - fullEnd); newEI = fullEnd; }
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
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                     tickFormatter={tickFormatter} interval={tickInterval}
                     axisLine={false} tickLine={false}
                     type="category" />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} width={24} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "rgba(7,14,28,0.9)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(96,165,250,0.2)",
                  borderRadius: 12,
                  boxShadow: "0 0 30px -8px rgba(96,165,250,0.35)",
                }}
                labelStyle={{ color: "#e2e8f0", fontWeight: 500 }}
                itemStyle={{ color: "#e2e8f0" }}
              />
              <Brush
                dataKey="day"
                height={22}
                stroke="rgba(96,165,250,0.35)"
                fill="rgba(7,14,28,0.4)"
                travellerWidth={8}
                tickFormatter={tickFormatter}
                startIndex={zoomDom ? zoomIndices()[0] : 0}
                endIndex={zoomDom ? zoomIndices()[1] : Math.max(0, trendData.length - 1)}
                onChange={(e: any) => {
                  if (!e || typeof e.startIndex !== 'number' || typeof e.endIndex !== 'number') return;
                  if (e.startIndex === 0 && e.endIndex >= trendData.length - 1) {
                    setZoomDom(null);
                  } else {
                    setZoomDom([trendData[e.startIndex].day, trendData[e.endIndex].day]);
                  }
                }}
              />
              {topWords.map((w, i) => (
                <Area key={w.word} type="monotone" dataKey={w.word}
                      stroke={COLORS[i % COLORS.length]}
                      fill={`url(#grad-${i % COLORS.length})`}
                      strokeWidth={2.5}
                      activeDot={{ r: 4, strokeWidth: 0, fill: COLORS[i % COLORS.length] }}
                      animationDuration={1200}
                      animationEasing="ease-out" />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <p className="hidden sm:block text-[10px] text-white/30 text-center mt-1 italic">
            Drag the strip above ↑ to navigate the time range
          </p>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="card spotlight p-5">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <p className="text-xs text-white/35 uppercase tracking-wider">Language mix</p>
            {!langMixAvailable && (
              <span className="text-[10px] uppercase tracking-widest font-semibold
                               text-amber-300/90 bg-amber-500/[.10] border border-amber-400/30
                               px-1.5 py-0.5 rounded">
                Loading…
              </span>
            )}
          </div>
          <LanguageMix data={langMix} colors={PIE_COLORS} />
          <p className="text-[11px] text-white/30 text-center mt-2">
            {langMixAvailable
              ? "Per-post classification from the live corpus"
              : "Showing placeholder while the corpus is classified…"}
          </p>
        </motion.div>
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total  = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const active = activeIndex != null ? data[activeIndex] : null;
  const activeColor = activeIndex != null ? colors[activeIndex % colors.length] : "#ffffff";
  const activePct = active ? (active.value / total) * 100 : 100;

  const renderActiveShape = (props: {
    cx?: number; cy?: number;
    innerRadius?: number; outerRadius?: number;
    startAngle?: number; endAngle?: number;
    fill?: string;
  }) => {
    const { cx, cy, innerRadius, outerRadius = 0, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={outerRadius + 8}
          outerRadius={outerRadius + 10}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          opacity={0.35}
        />
      </g>
    );
  };

  return (
    <div>
      <div className="relative" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={56}
            outerRadius={80}
            paddingAngle={1}
            startAngle={90}
            endAngle={-270}
            stroke="rgba(7,14,28,0.9)"
            strokeWidth={2}
            activeIndex={activeIndex ?? -1}
            activeShape={renderActiveShape}
            onMouseEnter={(_, i) => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
            animationDuration={900}
            animationBegin={150}
            animationEasing="ease-out"
            isAnimationActive
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label — fades between idle (total) and hovered slice */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          key={active?.name ?? "total"}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <div
            className="text-2xl font-bold tabular-nums text-white"
            style={active ? { color: activeColor } : undefined}
          >
            {activePct.toFixed(0)}%
          </div>
          <div className="text-[10px] uppercase tracking-widest text-white/45 mt-0.5">
            {active ? active.name : "Total"}
          </div>
        </motion.div>
      </div>
      </div>

      {/* Legend — one row per item so percentages align to a single rail */}
      <div className="mt-3 space-y-1">
        {data.map((d, i) => {
          const pct = (d.value / total) * 100;
          const isActive = activeIndex === i;
          return (
            <button
              key={d.name}
              type="button"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md
                          text-xs transition-colors
                          ${isActive ? "bg-white/[.05]" : "hover:bg-white/[.03]"}`}
            >
              <motion.span
                animate={{ scale: isActive ? 1.25 : 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  background: colors[i % colors.length],
                  boxShadow: isActive
                    ? `0 0 12px ${colors[i % colors.length]}`
                    : "none",
                }}
              />
              <span className={`w-16 flex-shrink-0 text-left
                                ${isActive ? "text-white/85" : "text-white/55"}`}>
                {d.name}
              </span>
              {/* Proportional bar gives a secondary visual encoding so small
                  shares read clearly even before hover. */}
              <div className="flex-1 h-1 rounded-full bg-white/[.05] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.2 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{
                    background: colors[i % colors.length],
                    opacity: isActive ? 1 : 0.55,
                    boxShadow: isActive ? `0 0 10px ${colors[i % colors.length]}` : "none",
                  }}
                />
              </div>
              <span className={`tabular-nums text-right w-9 flex-shrink-0
                                ${isActive ? "text-white/80" : "text-white/40"}`}>
                {pct.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
