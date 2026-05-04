"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { shuffle, WordEntry } from "./words-data";

export default function FlashcardGame({ words }: { words: WordEntry[] }) {
  const [remaining, setRemaining] = useState(() => shuffle(words));
  const [learned, setLearned]     = useState<WordEntry[]>([]);
  const [flipped, setFlipped]     = useState(false);
  const [leaving, setLeaving]     = useState<"right" | "left" | null>(null);

  const card = remaining[0];

  function animateOut(dir: "right" | "left", cb: () => void) {
    setLeaving(dir);
    setTimeout(() => { cb(); setLeaving(null); setFlipped(false); }, 320);
  }

  function markKnown() {
    animateOut("right", () => {
      setLearned((k) => [...k, card]);
      setRemaining((r) => r.slice(1));
    });
  }

  function markReview() {
    animateOut("left", () => {
      setRemaining((r) => [...r.slice(1), card]);
    });
  }

  function restart() {
    setRemaining(shuffle(words));
    setLearned([]);
    setFlipped(false);
  }

  if (!card) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        className="flex flex-col items-center gap-6 py-12 text-center"
      >
        <motion.p
          animate={{ scale: [1, 1.15, 1], rotate: [0, -5, 5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="text-5xl"
        >🎉</motion.p>
        <p className="text-2xl font-bold text-gradient-static">Deck complete!</p>
        <p className="text-white/45 text-sm">You learned all {words.length} words. Petmalu!</p>
        <button onClick={restart} className="btn-primary w-auto px-6 py-2.5 text-sm">Start over</button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Progress */}
      <div className="flex items-center gap-3 text-xs w-full max-w-md">
        <span className="text-green-300 w-16 text-right">{learned.length} learned</span>
        <div className="flex-1 h-1.5 bg-white/[.06] rounded-full overflow-hidden border border-white/[.04]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500"
            initial={false}
            animate={{ width: `${(learned.length / words.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            style={{ boxShadow: "0 0 12px -2px rgba(74,222,128,0.7)" }}
          />
        </div>
        <span className="text-white/35 w-12">{remaining.length} left</span>
      </div>

      {/* Card */}
      <div
        onClick={() => !flipped && setFlipped(true)}
        className="w-full max-w-md select-none"
        style={{ perspective: 1200, cursor: flipped ? "default" : "pointer" }}
      >
        <motion.div
          className="relative"
          animate={{
            x: leaving === "right" ? 120 : leaving === "left" ? -120 : 0,
            opacity: leaving ? 0 : 1,
            rotateY: flipped ? 180 : 0,
            rotateZ: leaving === "right" ? 8 : leaving === "left" ? -8 : 0,
          }}
          transition={{ duration: 0.3 }}
          style={{ transformStyle: "preserve-3d", minHeight: 280 }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 rounded-3xl flex flex-col items-center justify-center gap-3 p-8
                       bg-gradient-to-br from-[#0b1628] to-[#070d1a]
                       border border-white/[.08]
                       shadow-[0_0_40px_-10px_rgba(96,165,250,0.3)]"
            style={{ backfaceVisibility: "hidden" }}
          >
            <p className="text-5xl font-bold text-gradient-static tracking-tight">{card.word}</p>
            <p className="text-sm text-white/35 italic">{card.pos}</p>
            <p className="text-xs text-white/25 mt-4">tap to reveal definition</p>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-3xl flex flex-col justify-center gap-4 p-8
                       bg-gradient-to-br from-[#0c1630] to-[#070d1a]
                       border border-blue-400/25
                       shadow-[0_0_50px_-10px_rgba(96,165,250,0.5)]"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-bold text-gradient-static">{card.word}</span>
              <span className="text-xs text-blue-200 bg-blue-500/15 border border-blue-400/30
                               px-2 py-0.5 rounded-md">{card.plain}</span>
            </div>
            <p className="text-sm text-white/75 leading-relaxed">{card.def}</p>
            <p className="text-xs text-white/40 italic leading-relaxed border-l-2 border-blue-400/30 pl-3">
              {card.example}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Actions */}
      <AnimatePresence mode="wait">
        {flipped ? (
          <motion.div
            key="flipped-actions"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3"
          >
            <motion.button
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              onClick={markReview}
              className="px-5 py-2.5 rounded-xl border border-red-400/30 text-sm text-red-300
                         hover:bg-red-500/10 hover:border-red-400/50 transition-colors"
            >
              ← Review again
            </motion.button>
            <motion.button
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              onClick={markKnown}
              className="px-5 py-2.5 rounded-xl border border-green-400/35 text-sm text-green-300
                         hover:bg-green-500/10 hover:border-green-400/55 transition-colors
                         shadow-[0_0_16px_-6px_rgba(74,222,128,0.5)]"
            >
              Got it! →
            </motion.button>
          </motion.div>
        ) : (
          <motion.button
            key="reveal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
            onClick={() => setFlipped(true)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500/25 to-purple-500/20
                       border border-blue-400/30 text-sm text-blue-200
                       hover:from-blue-500/35 hover:to-purple-500/30 transition-colors
                       shadow-[0_0_16px_-6px_rgba(96,165,250,0.6)]"
          >
            Reveal definition
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
