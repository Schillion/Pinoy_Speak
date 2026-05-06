"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { analyzeText, fetchPosts, verifySlang } from "@/lib/api";
import { useProfanityFilter } from "@/context/ProfanityContext";
import { FORMATION_LABELS } from "@/lib/slang-data";
import type { AnalyzeResponse, WordResult } from "@/types";
import { fadeUp, staggerContainer, popIn } from "@/lib/motion";
import RevealText from "@/components/RevealText";
import TiltCard from "@/components/TiltCard";
import MagneticButton from "@/components/MagneticButton";
import ConcordanceView from "./_components/ConcordanceView";

type Tab = "translator" | "concordance";

const DEFAULT = "Sobrang solid ng vibes kagabi, sana all nakapunta!";
const MAX_CHARS = 500;

function trendLabel(z: number) {
  if (z > 4) return "Very Hot";
  if (z > 2) return "Trending";
  if (z > 0.5) return "Active";
  return "Stable";
}

function trendColor(z: number) {
  if (z > 4) return "text-orange-300 bg-orange-400/10 border-orange-400/30 shadow-[0_0_12px_-4px_rgba(251,146,60,0.5)]";
  if (z > 2) return "text-green-300 bg-green-400/10 border-green-400/30 shadow-[0_0_12px_-4px_rgba(74,222,128,0.5)]";
  if (z > 0.5) return "text-blue-300 bg-blue-400/10 border-blue-400/30";
  return "text-white/35 bg-white/[.04] border-white/[.09]";
}

export default function Translator() {
  const [tab, setTab] = useState<Tab>("translator");
  const [input,    setInput]    = useState(DEFAULT);
  const [result,   setResult]   = useState<AnalyzeResponse | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [examples, setExamples] = useState<Record<string, string[]>>({});
  const [verifying, setVerifying] = useState<Set<string>>(new Set());
  const { profanityFilter } = useProfanityFilter();
  const exReqId = useRef(0);
  const verifyReqId = useRef(0);
  // Track words we've already sent to the LLM during this analyze session.
  // The verify effect re-runs whenever `result` changes (after we upgrade a
  // confirmed slang), and without this set we'd waste an LLM call re-verifying
  // every previously-rejected word on each pass.
  const verifiedWords = useRef<Set<string>>(new Set());

  // Set initial tab from ?tab= query param (so /concordance redirect lands on it)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "concordance") setTab("concordance");
  }, []);

  useEffect(() => {
    if (!result) return;
    const id = ++exReqId.current;
    setExamples({});
    // Fetch examples for each unique slang word AND its canonical form —
    // canonical often has more posts to draw from than a rare variant spelling.
    const slangKeys = new Set<string>();
    for (const raw of result.tokens) {
      const w = raw.replace(/[.,!?'"]/g, "");
      const info = result.results[w];
      if (info?.classification !== "slang") continue;
      slangKeys.add(w);
      if (info.canonical) slangKeys.add(info.canonical);
    }
    Promise.all(
      [...slangKeys].map(async (word) => {
        try {
          const data = await fetchPosts(1, 8, word);
          const texts = (data.posts ?? [])
            .filter((p) => p.text?.toLowerCase().includes(word.toLowerCase()))
            .slice(0, 3)
            .map((p) => p.text ?? "");
          return [word, texts] as [string, string[]];
        } catch {
          return [word, []] as [string, string[]];
        }
      })
    ).then((pairs) => {
      if (id === exReqId.current) setExamples(Object.fromEntries(pairs));
    });
  }, [result]);

  async function handleAnalyze() {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError("");
    verifiedWords.current = new Set();   // reset for the new sentence
    try {
      setResult(await analyzeText(input, profanityFilter));
    } catch {
      setError("Service temporarily unavailable. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  // Online verification — for any token the corpus-based detector classified as
  // 'unknown' (or 'standard' for clearly non-English words), ask the LLM
  // whether it's actually Filipino slang. When the LLM confirms, the backend
  // also persists the entry to the discovered lexicon, so future runs catch
  // it instantly without an LLM call.
  useEffect(() => {
    if (!result) return;
    const id = ++verifyReqId.current;

    const STOP = new Set([
      "ang","ng","sa","na","at","ay","si","ni","para","pero","kasi","lang",
      "din","rin","po","daw","raw","pala","naman","talaga","sana","yung","ung",
      "the","and","for","that","this","with","from","but","not",
    ]);

    const candidates = new Set<string>();
    for (const raw of result.tokens) {
      const w = raw.replace(/[.,!?'"]/g, "").toLowerCase();
      if (!w || w.length < 3 || STOP.has(w)) continue;
      if (verifiedWords.current.has(w)) continue;   // already checked this session
      const info = result.results[w];
      if (!info || info.classification === "slang" || info.classification === "profane") continue;
      // Verify words the corpus didn't catch — both 'unknown' and 'standard'
      // (the latter covers semantic-shift slang the detector classified as
      // a normal dictionary word).
      candidates.add(w);
    }
    if (candidates.size === 0) return;

    // Mark them as verified-this-session before we await, so subsequent
    // re-renders (triggered by setResult below) don't re-fire the same calls.
    for (const w of candidates) verifiedWords.current.add(w);
    setVerifying(new Set(candidates));

    Promise.all(
      [...candidates].map(async (word) => {
        try { return [word, await verifySlang(word)] as const; }
        catch { return [word, { is_slang: false }] as const; }
      })
    ).then((pairs) => {
      if (id !== verifyReqId.current) return;
      setVerifying(new Set());

      // Apply confirmed slang upgrades to the existing result
      let mutated = false;
      const next: AnalyzeResponse = {
        tokens:  result.tokens,
        results: { ...result.results },
      };
      for (const [word, v] of pairs) {
        if (!v.is_slang || !v.definition) continue;
        const existing = next.results[word] ?? {
          classification:  "slang",
          reason:          "Verified by online lookup.",
          formation_type:  v.formation_type ?? "unknown",
          burstiness:      0,
          definition:      v.definition,
          plain_word:      v.plain ?? null,
          standard_approx: [],
          related:         [],
        } as WordResult;
        next.results[word] = {
          ...existing,
          classification: "slang",
          definition:     existing.definition || v.definition || "",
          plain_word:     existing.plain_word || v.plain || null,
          formation_type: existing.formation_type === "unknown"
            ? (v.formation_type ?? existing.formation_type)
            : existing.formation_type,
          reason:         existing.reason || "Verified online — added to dictionary.",
        };
        mutated = true;
      }
      if (mutated) setResult(next);
    });
  }, [result]);

  function badgeClass(cls: string) {
    if (cls === "slang")   return "badge-slang";
    if (cls === "profane") return "badge-censored";
    return "badge-regular";
  }

  return (
    <div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1 leading-tight">
          <RevealText
            text={tab === "translator" ? "Slang Translator" : "Concordance"}
            as="span"
            split="char"
            stagger={0.035}
            className="text-shimmer"
          />
        </h1>
      </motion.div>

      {/* Tabs — Translator | Concordance */}
      <div className="flex rounded-xl overflow-hidden border border-white/[.08] text-sm relative w-fit mt-3 mb-5">
        {([
          ["translator",  "Translator"],
          ["concordance", "Concordance"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-5 py-2 transition-colors ${
              tab === t ? "text-blue-200" : "text-white/50 hover:text-white/85"
            }`}
          >
            {tab === t && (
              <motion.span
                layoutId="translator-tab-pill"
                className="absolute inset-0 bg-gradient-to-r from-blue-500/25 to-purple-500/15 border border-blue-400/30"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative font-medium">{label}</span>
          </button>
        ))}
      </div>

      {tab === "concordance" ? (
        <ConcordanceView />
      ) : (
      <>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="text-sm text-white/55 mb-5"
      >
        Paste a Filipino sentence — we&apos;ll identify slang and explain what each word means.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="card spotlight p-4 mb-6"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          rows={4}
          maxLength={MAX_CHARS}
          className="w-full bg-transparent text-slate-200 text-sm leading-relaxed resize-none
                     focus:outline-none placeholder:text-white/20 mb-1"
          placeholder="Type a Filipino sentence…"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/25">{input.length} / {MAX_CHARS}</span>
          <MagneticButton
            onClick={handleAnalyze}
            disabled={loading || !input.trim()}
            className="btn-primary w-auto px-5 py-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing…
              </span>
            ) : "Analyze"}
          </MagneticButton>
        </div>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="text-red-400 text-xs mt-3 flex items-center gap-3 flex-wrap"
            >
              <span>{error}</span>
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="text-[11px] text-blue-300 hover:text-blue-200 transition-colors
                           border border-blue-400/30 rounded-md px-2 py-0.5
                           bg-blue-500/[.08] hover:bg-blue-500/[.15] disabled:opacity-40"
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key="result"
            variants={staggerContainer(0.12)}
            initial="hidden" animate="show" exit={{ opacity: 0 }}
            className="space-y-8"
          >
            {/* Step 1 */}
            <motion.section variants={fadeUp}>
              <SectionLabel num={1} title="Slang Detected" sub="Blue = slang · gray = regular" />
              {verifying.size > 0 && (
                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-[11px] text-blue-300/80 mb-2 flex items-center gap-2 flex-wrap"
                >
                  <span className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-300 rounded-full animate-spin shrink-0" />
                  <span>
                    Double-checking online (~5–15s): {[...verifying].slice(0, 4).join(", ")}
                    {verifying.size > 4 ? `, +${verifying.size - 4}…` : ""}
                  </span>
                </motion.p>
              )}
              {/* Plain divs for the token grid — was N motion.divs each
                  managing a popIn spring. With long sentences (50+ tokens)
                  framer-motion stuttered on low-end Android. CSS-only
                  hover transition matches the original feel. */}
              <div className="flex flex-wrap gap-1.5 anim-fade-in">
                {result.tokens.map((token, i) => {
                  const clean = token.replace(/[.,!?'"]/g, "");
                  const info  = result.results[clean];
                  const cls   = info?.classification ?? "unknown";
                  if (profanityFilter && cls === "profane") {
                    return (
                      <div key={i} className="badge-censored min-w-[44px]">
                        ****<br /><span className="text-[10px] opacity-60">hidden</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className={`${badgeClass(cls)} min-w-[44px] cursor-default
                                  transition-transform duration-200 hover:-translate-y-0.5 hover:scale-[1.04]`}
                      title={info?.canonical ? `Variant of ${info.canonical}` : undefined}
                    >
                      {clean || token}<br />
                      <span className="text-[10px] opacity-60">
                        {cls === "slang"
                          ? (info?.canonical ? `= ${info.canonical}` : "slang")
                          : cls === "standard" ? "regular" : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.section>

            {/* Step 2 */}
            {(() => {
              const hasSlang = result.tokens.some((t) => {
                const clean = t.replace(/[.,!?'"]/g, "");
                return result.results[clean]?.classification === "slang";
              });
              if (!hasSlang) return null;

              const translated = result.tokens.map((t) => {
                const clean = t.replace(/[.,!?'"]/g, "");
                const trailing = t.slice(clean.length);
                const info  = result.results[clean];
                if (info?.classification === "slang") {
                  let sub: string | null = null;
                  if (info.plain_word) {
                    sub = info.plain_word;
                  } else if (info.definition) {
                    const main = info.definition.split(" — ")[0];
                    const firstSegment = main.split(/[,/(]/)[0].trim();
                    if (firstSegment) sub = firstSegment;
                  }
                  // Fall back to the original word when we have no confident
                  // translation — never invent one from FastText neighbors.
                  return { word: t, sub: (sub ?? clean) + trailing, isSlang: sub != null };
                }
                return { word: t, sub: t, isSlang: false };
              });

              return (
                <motion.section variants={fadeUp}>
                  <SectionLabel num={2} title="Plain Translation" sub="Slang replaced with standard equivalents" />
                  <div className="card spotlight p-5 text-slate-200 text-sm leading-relaxed">
                    {translated.map((item, i) => (
                      <span key={i}>
                        {i > 0 && " "}
                        {item.isSlang
                          ? <span className="text-gradient-static font-semibold">{item.sub}</span>
                          : item.word}
                      </span>
                    ))}
                  </div>
                </motion.section>
              );
            })()}

            {/* Step 3 */}
            {(() => {
              // Dedupe slang entries by canonical form so char/chariz/chz all
              // collapse into a single "charot" card with the variants listed.
              const seen = new Set<string>();
              const slangWords: Array<{ display: string; variants: string[] }> = [];
              for (const raw of result.tokens) {
                const w = raw.replace(/[.,!?'"]/g, "");
                const info = result.results[w];
                if (info?.classification !== "slang") continue;
                const key = info.canonical ?? w;
                if (seen.has(key)) {
                  const existing = slangWords.find((s) => s.display === key);
                  if (existing && w !== key && !existing.variants.includes(w)) {
                    existing.variants.push(w);
                  }
                  continue;
                }
                seen.add(key);
                slangWords.push({
                  display: key,
                  variants: w !== key ? [w] : [],
                });
              }
              if (!slangWords.length) return null;

              return (
                <motion.section variants={fadeUp}>
                  <SectionLabel num={3} title="Word Breakdown" sub="What each slang word means" />
                  <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="show"
                              className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {slangWords.map(({ display, variants }) => {
                      // `display` is the canonical form. If the canonical
                      // itself wasn't in the sentence, fall back to the first
                      // variant's info (they all share the same definition).
                      const info: WordResult =
                        result.results[display] ?? result.results[variants[0]];
                      if (!info) return null;
                      return (
                        <motion.div key={display} variants={fadeUp}>
                         <TiltCard
                          intensity={4}
                          className="card p-4 h-full transition-colors duration-300
                                     hover:border-blue-400/30 hover:shadow-[0_0_40px_-10px_rgba(96,165,250,0.45)]"
                         >
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="font-bold text-gradient-static text-sm">{display}</span>
                            {variants.length > 0 && (
                              <span className="text-[10px] text-white/40 bg-white/[.04]
                                               border border-white/[.08] rounded-md px-1.5 py-0.5">
                                variants: {variants.join(", ")}
                              </span>
                            )}
                            <span className={`text-[10px] border rounded-md px-1.5 py-0.5 ${trendColor(info.burstiness)}`}>
                              {trendLabel(info.burstiness)}
                            </span>
                            {info.formation_type && info.formation_type !== "unknown" &&
                              FORMATION_LABELS[info.formation_type as keyof typeof FORMATION_LABELS] && (
                              <span className="text-[10px] text-violet-300 bg-violet-500/[.10]
                                               border border-violet-400/25 rounded-md px-1.5 py-0.5">
                                {FORMATION_LABELS[info.formation_type as keyof typeof FORMATION_LABELS]}
                              </span>
                            )}
                            {info.plain_word && (
                              <span className="text-[10px] text-white/35 ml-auto">→ {info.plain_word}</span>
                            )}
                          </div>
                          <p className="text-sm text-white/65 leading-relaxed mb-2">
                            {info.definition ?? (
                              info.standard_approx[0]
                                ? `Used similarly to: ${info.standard_approx.slice(0,3).join(", ")}`
                                : "Meaning still being tracked."
                            )}
                          </p>
                          {info.related.length > 0 && (
                            <p className="text-xs text-white/30">
                              Often with: {info.related.slice(0, 4).join(", ")}
                            </p>
                          )}
                          {(() => {
                            // Pull examples from whichever form we have posts for
                            // (canonical first, then the variants as they appeared).
                            const key = [display, ...variants].find((k) => examples[k]?.length);
                            if (!key) return null;
                            return (
                              <div className="mt-3 pt-3 border-t border-white/[.05]">
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">
                                  Used in Filipino posts
                                </p>
                                {examples[key].map((text, ei) => {
                                  const idx = text.toLowerCase().indexOf(key.toLowerCase());
                                  const s = Math.max(0, idx - 55);
                                  const e = Math.min(text.length, idx + key.length + 55);
                                  const snippet = (s > 0 ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
                                  return (
                                    <p key={ei} className="text-xs text-white/45 italic leading-relaxed mb-1.5 last:mb-0">
                                      &ldquo;{snippet}&rdquo;
                                    </p>
                                  );
                                })}
                              </div>
                            );
                          })()}
                         </TiltCard>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </motion.section>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
      </>
      )}
    </div>
  );
}

function SectionLabel({ num, title, sub }: { num: number; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <motion.span
        initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/25 to-purple-500/15
                   border border-blue-400/30 text-xs font-bold text-blue-200
                   flex items-center justify-center flex-shrink-0
                   shadow-[0_0_16px_-4px_rgba(96,165,250,0.6)]"
      >
        {num}
      </motion.span>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-[11px] text-white/35">{sub}</p>
      </div>
    </div>
  );
}
