"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchPosts } from "@/lib/api";
import type { LexiconEntry, SlangWord } from "@/types";
import { modalBackdrop, modalContent, fadeUp, staggerContainer } from "@/lib/motion";

const ANCHOR_WIDTH  = 440;
const VIEWPORT_PAD  = 16;
const ANCHOR_MIN_VW = 900;  // below this, always center
const SIDE_GAP      = 24;   // distance between row and modal edge
const MODAL_HEIGHT  = 520;  // expected; content scrolls internally if taller

export type AnchorPoint = { x: number; y: number };

function computeAnchorStyle(anchor: AnchorPoint): React.CSSProperties | null {
  if (typeof window === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < ANCHOR_MIN_VW) return null;

  // Horizontal placement — prefer "to the right of the cursor" so the modal
  // sits BESIDE the clicked row rather than covering it. Fall back to the
  // left if there's no room on the right.
  const rightOf = anchor.x + SIDE_GAP;
  const leftOf  = anchor.x - SIDE_GAP - ANCHOR_WIDTH;
  let left: number;
  if (rightOf + ANCHOR_WIDTH + VIEWPORT_PAD <= vw) {
    left = rightOf;
  } else if (leftOf >= VIEWPORT_PAD) {
    left = leftOf;
  } else {
    // No room either side — clamp into viewport and let it overlap
    left = Math.max(VIEWPORT_PAD, vw - ANCHOR_WIDTH - VIEWPORT_PAD);
  }

  // Vertical — center the modal vertically on the click, then clamp into
  // viewport. Keeps the click row visible alongside the modal even when
  // clicking near the bottom of a long page.
  const idealTop = anchor.y - MODAL_HEIGHT / 2;
  const maxTop   = Math.max(VIEWPORT_PAD, vh - MODAL_HEIGHT - VIEWPORT_PAD);
  const top      = Math.max(VIEWPORT_PAD, Math.min(idealTop, maxTop));
  const maxHeight = Math.min(MODAL_HEIGHT, vh - top - VIEWPORT_PAD);

  return { position: "fixed", top, left, width: ANCHOR_WIDTH, maxHeight };
}

export default function WordModal({
  word,
  meta,
  anchor,
  onClose,
}: {
  word: SlangWord;
  meta: LexiconEntry | undefined;
  anchor?: AnchorPoint | null;
  onClose: () => void;
}) {
  const anchorStyle = useMemo(
    () => (anchor ? computeAnchorStyle(anchor) : null),
    [anchor]
  );
  const isAnchored = !!anchorStyle;
  const [examples, setExamples]   = useState<string[]>([]);
  const [loadingEx, setLoadingEx] = useState(true);

  useEffect(() => {
    setLoadingEx(true);
    fetchPosts(1, 12, word.word)
      .then((data) => {
        const texts = data.posts
          .filter((p) => p.text?.toLowerCase().includes(word.word.toLowerCase()))
          .slice(0, 4)
          .map((p) => p.text ?? "");
        setExamples(texts.filter(Boolean));
      })
      .catch(() => {})
      .finally(() => setLoadingEx(false));
  }, [word.word]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function snippet(text: string) {
    const idx = text.toLowerCase().indexOf(word.word.toLowerCase());
    if (idx === -1) return text.slice(0, 130);
    const s = Math.max(0, idx - 65);
    const e = Math.min(text.length, idx + word.word.length + 65);
    return (s > 0 ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
  }

  return (
    <AnimatePresence>
      <motion.div
        variants={modalBackdrop}
        initial="hidden" animate="show" exit="exit"
        className={`fixed inset-0 z-50 ${
          isAnchored
            ? "bg-black/40 backdrop-blur-[2px]"
            : "bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6"
        }`}
        onClick={onClose}
      >
        <motion.div
          variants={modalContent}
          initial="hidden" animate="show" exit="exit"
          onClick={(e) => e.stopPropagation()}
          style={anchorStyle ?? undefined}
          className={`relative flex flex-col
                     bg-gradient-to-br from-[#0a1424] to-[#070d1a]
                     border border-white/[.08]
                     shadow-[0_0_80px_-20px_rgba(167,139,250,0.4)]
                     ${isAnchored
                        ? "rounded-3xl overflow-hidden"
                        : "w-full max-w-lg max-h-[92vh] sm:max-h-[88vh] rounded-t-3xl sm:rounded-3xl overflow-hidden"}`}
        >
          {/* Mobile drag indicator — gives the sheet a clear "swipe down to close" affordance */}
          {!isAnchored && (
            <div className="sm:hidden flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
          )}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-400/60 to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 pointer-events-none"
               style={{ background: "radial-gradient(circle, rgba(167,139,250,0.4), transparent 70%)", filter: "blur(32px)" }} />

          <div className="relative flex-1 overflow-y-auto min-h-0">
            <div className="flex items-start justify-between px-5 sm:px-7 pt-5 sm:pt-7 pb-4 sm:pb-5 border-b border-white/[.06]">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
                  <motion.h2
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                    className="text-3xl sm:text-4xl font-bold text-gradient-static tracking-tight"
                  >
                    {word.word}
                  </motion.h2>
                  {meta?.pos && (
                    <span className="text-sm text-white/35 italic">{meta.pos}</span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] text-purple-300 uppercase tracking-widest font-medium">
                    Filipino slang
                  </span>
                  <span className="text-white/15">·</span>
                  <span className="text-[11px] text-white/30">
                    {word.count.toLocaleString()} mentions in corpus
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/30 hover:text-white/80 hover:rotate-90 transition-all duration-300
                           text-2xl leading-none ml-4 mt-1 flex-shrink-0"
                aria-label="Close"
              >×</button>
            </div>

            <motion.div
              variants={staggerContainer(0.08, 0.05)}
              initial="hidden" animate="show"
              className="px-5 sm:px-7 py-5 sm:py-6 space-y-5 sm:space-y-6"
            >
              <motion.section variants={fadeUp}>
                <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Definition</p>
                <p className="text-white/80 leading-relaxed text-[15px]">
                  {word.definition ?? "Meaning still being tracked from Filipino online posts."}
                </p>
                {(word.plain_word ?? meta?.plain) && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-white/25">Plain English</span>
                    <span className="text-xs bg-blue-500/15 border border-blue-400/30
                                     text-blue-200 px-2 py-0.5 rounded-md font-medium
                                     shadow-[0_0_12px_-4px_rgba(96,165,250,0.6)]">
                      {word.plain_word ?? meta?.plain}
                    </span>
                  </div>
                )}
              </motion.section>

              {meta?.origin && (
                <motion.section variants={fadeUp}>
                  <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Origin</p>
                  <p className="text-sm text-white/45 leading-relaxed">{meta.origin}</p>
                </motion.section>
              )}

              <hr className="border-white/[.05]" />

              <motion.section variants={fadeUp}>
                <p className="text-[10px] text-white/25 uppercase tracking-widest mb-3">
                  {examples.length > 0
                    ? "In the wild — real Filipino posts"
                    : meta?.example
                    ? "Example sentence"
                    : "Examples"}
                </p>
                {loadingEx ? (
                  <div className="space-y-2.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="shimmer h-4 rounded w-full" style={{ width: `${95 - i * 15}%` }} />
                    ))}
                  </div>
                ) : examples.length > 0 ? (
                  <div className="space-y-3">
                    {examples.map((text, i) => (
                      <motion.p
                        key={i}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.08 }}
                        className="text-sm text-white/55 italic leading-relaxed
                                   pl-3 border-l-2 border-purple-400/30"
                      >
                        &ldquo;{snippet(text)}&rdquo;
                      </motion.p>
                    ))}
                  </div>
                ) : meta?.example ? (
                  // Fall back to the curated seed example when the live corpus
                  // hasn't picked up this word yet (common for newly added or
                  // niche slang). At least the user sees one reference sentence.
                  <div className="space-y-2">
                    <p className="text-sm text-white/65 italic leading-relaxed
                                   pl-3 border-l-2 border-blue-400/40">
                      &ldquo;{meta.example}&rdquo;
                    </p>
                    <p className="text-[11px] text-white/30 italic">
                      Hand-curated example — corpus posts will appear here once
                      &ldquo;{word.word}&rdquo; shows up in scraped data.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-white/30 italic leading-relaxed">
                    Still being collected — this word hasn&apos;t shown up in the
                    scraped corpus yet. Run <span className="text-white/55">automate.py</span>
                    {" "}or wait for new posts.
                  </p>
                )}
              </motion.section>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
