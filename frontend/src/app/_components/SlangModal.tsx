"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchDefine } from "@/lib/api";
import { FORMATION_LABELS } from "@/lib/slang-data";
import type { DefineResult } from "@/types";
import { modalBackdrop, modalContent, staggerContainer, fadeUp } from "@/lib/motion";

export default function SlangModal({ word, onClose }: { word: string; onClose: () => void }) {
  const [result, setResult]   = useState<DefineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchDefine(word)
      .then((data) => setResult(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [word]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCorpusDerived = result?.source === "corpus";

  return (
    <AnimatePresence>
      <motion.div
        variants={modalBackdrop}
        initial="hidden" animate="show" exit="exit"
        className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6"
        onClick={onClose}
      >
        <motion.div
          variants={modalContent}
          initial="hidden" animate="show" exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="relative flex flex-col w-full max-w-md max-h-[85vh] overflow-hidden rounded-3xl
                     bg-gradient-to-br from-[#0a1424] to-[#070d1a]
                     border border-white/[.08]
                     shadow-[0_0_80px_-20px_rgba(96,165,250,0.4)]"
        >
          {/* Top gradient accent */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 pointer-events-none"
               style={{ background: "radial-gradient(circle, rgba(96,165,250,0.35), transparent 70%)", filter: "blur(30px)" }} />

          <div className="relative flex-1 overflow-y-auto min-h-0">
            {/* Header */}
            <div className="flex items-start justify-between p-6 pb-4 border-b border-white/[.06]">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <motion.h2
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gradient-static tracking-tight"
                  >
                    {word}
                  </motion.h2>
                  {result?.plain && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.2 }}
                      className="text-xs text-blue-200 bg-blue-500/15 border border-blue-400/30
                                 px-2 py-0.5 rounded-md shadow-[0_0_12px_-4px_rgba(96,165,250,0.6)]"
                    >
                      {result.plain}
                    </motion.span>
                  )}
                  {isCorpusDerived && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.25 }}
                      className="text-[10px] text-green-300 bg-green-500/10 border border-green-400/25
                                 px-2 py-0.5 rounded-md"
                    >
                      learned from posts
                    </motion.span>
                  )}
                </div>
                {result?.pos && <p className="text-xs text-white/35 italic mt-1">{result.pos}</p>}
              </div>
              <button
                onClick={onClose}
                className="text-white/30 hover:text-white/80 hover:rotate-90 transition-all duration-300
                           text-2xl leading-none ml-4 mt-0.5"
                aria-label="Close"
              >×</button>
            </div>

            {/* Body */}
            <motion.div
              variants={staggerContainer(0.06, 0.05)}
              initial="hidden" animate="show"
              className="p-6 space-y-5 min-h-[180px]"
            >
              {loading && (
                <div className="space-y-3">
                  <div className="shimmer h-3 rounded w-3/4" />
                  <div className="shimmer h-3 rounded w-full" />
                  <div className="shimmer h-3 rounded w-5/6" />
                  <p className="text-[10px] text-white/30 text-center pt-2">
                    Analysing corpus…
                  </p>
                </div>
              )}

              {!loading && error && (
                <p className="text-sm text-white/40 italic">
                  No data found for &ldquo;{word}&rdquo;. Try asking Kuya Slang in the chat!
                </p>
              )}

              {!loading && result && (
                <>
                  {result.def && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Definition</p>
                      <p className="text-sm text-white/80 leading-relaxed">{result.def}</p>
                    </motion.div>
                  )}

                  {!result.def && result.description && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Description</p>
                      <p className="text-sm text-white/80 leading-relaxed">{result.description}</p>
                    </motion.div>
                  )}

                  {result.context_words && result.context_words.length > 0 && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
                        Associated with · learned from posts
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.context_words.map((cw, i) => (
                          <motion.span
                            key={cw}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.02 }}
                            className="text-xs text-white/55 bg-white/[.04] border border-white/[.09]
                                       px-2 py-0.5 rounded-full hover:border-white/20 hover:text-white/80
                                       transition-colors"
                          >
                            {cw}
                          </motion.span>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {result.examples && result.examples.length > 0 && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
                        Real usage from posts
                      </p>
                      <div className="space-y-2">
                        {result.examples.slice(0, 3).map((ex, i) => (
                          <motion.p
                            key={i}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.15 + i * 0.08 }}
                            className="text-xs text-white/45 italic leading-relaxed
                                       border-l-2 border-blue-400/30 pl-3"
                          >
                            {ex}
                          </motion.p>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {result.example && (!result.examples || result.examples.length === 0) && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Example</p>
                      <p className="text-xs text-white/45 italic leading-relaxed border-l-2 border-blue-400/30 pl-3">
                        {result.example}
                      </p>
                    </motion.div>
                  )}

                  {result.neighbors && result.neighbors.length > 0 && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
                        Semantically related · from word embeddings
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.neighbors.map((n, i) => (
                          <motion.span
                            key={n}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.03 }}
                            className="text-xs text-purple-200 bg-purple-500/[.10] border border-purple-400/25
                                       px-2 py-0.5 rounded-full"
                          >
                            {n}
                          </motion.span>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {result.origin && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Origin</p>
                      <p className="text-xs text-white/45 leading-relaxed">{result.origin}</p>
                    </motion.div>
                  )}

                  {result.formation_type &&
                    FORMATION_LABELS[result.formation_type as keyof typeof FORMATION_LABELS] && (
                    <motion.div variants={fadeUp}>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Word formation</p>
                      <p className="text-xs text-white/45">
                        {FORMATION_LABELS[result.formation_type as keyof typeof FORMATION_LABELS]}
                      </p>
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>

            <div className="px-6 pb-5">
              <button
                onClick={onClose}
                className="btn-ghost w-full py-2.5 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
