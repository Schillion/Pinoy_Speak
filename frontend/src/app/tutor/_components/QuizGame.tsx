"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { shuffle, WordEntry } from "./words-data";
import { getQuizProgress, saveQuizResult } from "@/lib/progress";

export default function QuizGame({ words }: { words: WordEntry[] }) {
  const [deck]              = useState(() => shuffle(words));
  const [qIdx, setQIdx]     = useState(0);
  const [score, setScore]   = useState({ right: 0, wrong: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone]     = useState(false);
  const [saved, setSaved]   = useState(false);
  const nextBtnRef          = useRef<HTMLButtonElement>(null);

  const { bestPct, attempts } = getQuizProgress();

  useEffect(() => {
    if (picked) {
      setTimeout(() => nextBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 280);
    }
  }, [picked]);

  const current = deck[qIdx];

  const options = useMemo(() => {
    const wrong = shuffle(words.filter((w) => w.word !== current.word)).slice(0, 3);
    return shuffle([current, ...wrong]);
  }, [qIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(word: string) {
    if (picked) return;
    setPicked(word);
    if (word === current.word) setScore((s) => ({ ...s, right: s.right + 1 }));
    else setScore((s) => ({ ...s, wrong: s.wrong + 1 }));
  }

  function next() {
    if (qIdx + 1 >= deck.length) {
      setDone(true);
      return;
    }
    setPicked(null);
    setQIdx((i) => i + 1);
  }

  function restart() {
    setQIdx(0);
    setScore({ right: 0, wrong: 0 });
    setPicked(null);
    setDone(false);
    setSaved(false);
  }

  const total = score.right + score.wrong;
  const pct   = total > 0 ? Math.round((score.right / total) * 100) : 0;

  // Save result once when the done screen first mounts
  useEffect(() => {
    if (done && !saved) {
      saveQuizResult(pct);
      setSaved(true);
    }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const newBest = done && pct > bestPct && attempts > 0;

  if (done) {
    const { bestPct: storedBest, attempts: storedAttempts } = getQuizProgress();
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        className="flex flex-col items-center gap-6 py-8 text-center"
      >
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.1 }}
          className="relative"
        >
          <div className="absolute inset-0 blur-3xl"
               style={{ background: "radial-gradient(circle, rgba(96,165,250,0.55), transparent 70%)" }} />
          <div className="relative text-6xl font-bold text-gradient-static tracking-tight">{pct}%</div>
        </motion.div>

        <p className="text-white/55 text-sm">
          {score.right} correct · {score.wrong} wrong out of {deck.length} words
        </p>
        <p className="text-white/40 text-xs italic">
          {pct >= 80 ? "Petmalu! You're basically fluent. 🔥" : pct >= 50 ? "Solid! Keep practicing. 💪" : "Keri lang, practice more! 😄"}
        </p>

        {/* Personal stats */}
        <div className="flex gap-5 text-xs">
          <div className="text-center">
            <p className="text-white/25 uppercase tracking-wider mb-0.5">Personal best</p>
            <p className={`font-bold text-lg ${newBest ? "text-amber-300" : "text-white/60"}`}>
              {storedBest}%
              {newBest && <span className="ml-1 text-xs">🏆 new!</span>}
            </p>
          </div>
          <div className="w-px bg-white/[.06]" />
          <div className="text-center">
            <p className="text-white/25 uppercase tracking-wider mb-0.5">Attempts</p>
            <p className="font-bold text-lg text-white/60">{storedAttempts}</p>
          </div>
        </div>

        <button onClick={restart} className="btn-primary w-auto px-6 py-2.5 text-sm">Play again</button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-4 max-w-md mx-auto">
      <div className="flex items-center justify-between text-xs text-white/35">
        <span>Question {qIdx + 1} of {deck.length}</span>
        <span className="flex items-center gap-3">
          <span className="text-green-300">✓ {score.right}</span>
          <span className="text-red-300">✗ {score.wrong}</span>
          {bestPct > 0 && (
            <span className="text-white/25">best {bestPct}%</span>
          )}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/[.05] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
          initial={false}
          animate={{ width: `${((qIdx) / deck.length) * 100}%` }}
          transition={{ duration: 0.4 }}
          style={{ boxShadow: "0 0 10px -2px rgba(96,165,250,0.8)" }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={qIdx}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.25 }}
          className="relative overflow-hidden rounded-3xl p-7 text-center
                     bg-gradient-to-br from-[#0b1628] to-[#070d1a]
                     border border-white/[.08]
                     shadow-[0_0_40px_-10px_rgba(96,165,250,0.3)]"
        >
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
          <p className="text-xs text-white/30 uppercase tracking-widest mb-3">What does this mean?</p>
          <p className="text-4xl font-bold text-gradient-static tracking-tight">{current.word}</p>
          <p className="text-xs text-white/30 italic mt-1">{current.pos}</p>
        </motion.div>
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-2.5">
        {options.map((opt) => {
          const isCorrect = opt.word === current.word;
          const isPicked  = opt.word === picked;
          const revealed  = picked !== null;

          let cls = "w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all duration-200 ";
          if (!revealed) {
            cls += "border-white/[.08] bg-white/[.02] text-white/65 hover:bg-white/[.06] hover:text-white/90 hover:border-blue-400/30 cursor-pointer backdrop-blur-sm";
          } else if (isCorrect) {
            cls += "border-green-400/45 bg-green-500/10 text-green-200 shadow-[0_0_20px_-6px_rgba(74,222,128,0.6)]";
          } else if (isPicked) {
            cls += "border-red-400/45 bg-red-500/10 text-red-200 shadow-[0_0_20px_-6px_rgba(248,113,113,0.6)]";
          } else {
            cls += "border-white/[.04] bg-transparent text-white/25 cursor-default";
          }

          return (
            <motion.button
              key={opt.word}
              whileHover={!revealed ? { x: 4 } : undefined}
              whileTap={!revealed ? { scale: 0.98 } : undefined}
              onClick={() => choose(opt.word)}
              className={cls}
              disabled={!!picked}
            >
              <span className="font-medium">{opt.plain}</span>
              {revealed && isCorrect && <span className="ml-2 text-green-300 text-xs">✓ correct</span>}
              {revealed && isPicked && !isCorrect && <span className="ml-2 text-red-300 text-xs">✗</span>}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {picked && (
          <motion.p
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="text-xs text-white/40 italic pl-3 border-l-2 border-blue-400/30 leading-relaxed"
          >
            {current.example}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {picked && (
          <motion.button
            ref={nextBtnRef}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onClick={next}
            className="btn-primary w-full py-2.5 text-sm"
          >
            {qIdx + 1 >= deck.length ? "See results" : "Next →"}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
