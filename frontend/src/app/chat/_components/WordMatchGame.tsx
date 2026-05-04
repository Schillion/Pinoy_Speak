"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { shuffle, WordEntry } from "./words-data";

const MATCH_BATCH = 6;

export default function WordMatchGame({ words }: { words: WordEntry[] }) {
  function makeBatch() {
    const picked = shuffle(words).slice(0, MATCH_BATCH);
    return {
      words: shuffle(picked.map((w) => w.word)),
      defs:  shuffle(picked.map((w) => ({ key: w.word, label: w.plain }))),
    };
  }

  const [batch, setBatch]     = useState(makeBatch);
  const [sel, setSel]         = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [shaking, setShaking] = useState<string | null>(null);
  const [score, setScore]     = useState(0);
  const [errors, setErrors]   = useState(0);
  const [rounds, setRounds]   = useState(0);

  function pickWord(word: string) {
    if (matched.has(word)) return;
    setSel(word === sel ? null : word);
  }

  function pickDef(key: string) {
    if (matched.has(key) || !sel) return;
    if (key === sel) {
      setMatched((m) => new Set([...m, key]));
      setScore((s) => s + 1);
      setSel(null);
    } else {
      setErrors((e) => e + 1);
      setShaking(key);
      setTimeout(() => setShaking(null), 500);
    }
  }

  function nextRound() {
    setBatch(makeBatch());
    setMatched(new Set());
    setSel(null);
    setRounds((r) => r + 1);
  }

  const allDone = matched.size === MATCH_BATCH;

  return (
    <div className="flex flex-col gap-4 py-2 max-w-md mx-auto">
      <div className="flex items-center justify-between text-xs text-white/35">
        <span>Tap a word, then tap its meaning</span>
        <span className="flex gap-3">
          <span className="text-green-300">✓ {score}</span>
          {errors > 0 && <span className="text-red-300">✗ {errors}</span>}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {allDone ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 20 }}
            className="flex flex-col items-center gap-5 py-12 text-center"
          >
            <motion.p
              animate={{ scale: [1, 1.2, 1], rotate: [0, -8, 8, 0] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="text-5xl"
            >🔥</motion.p>
            <p className="text-gradient-static font-semibold text-lg">Round {rounds + 1} complete!</p>
            <p className="text-white/45 text-sm">
              {errors === 0 ? "Petmalu! Perfect round, walang mali!" : `${errors} mistake${errors !== 1 ? "s" : ""}. Keri, keep going!`}
            </p>
            <button onClick={nextRound} className="btn-primary w-auto px-6 py-2.5 text-sm">
              Next round →
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <AnimatePresence>
              {sel && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-xs text-blue-300 text-center mb-3"
                >
                  Now pick the meaning for{" "}
                  <strong className="text-blue-200 not-italic">{sel}</strong>
                </motion.p>
              )}
            </AnimatePresence>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-white/25 uppercase tracking-widest text-center mb-0.5">Word</p>
                {batch.words.map((word) => {
                  const done   = matched.has(word);
                  const active = sel === word;
                  return (
                    <motion.button
                      key={word}
                      whileHover={!done && !active ? { y: -2 } : undefined}
                      whileTap={!done ? { scale: 0.96 } : undefined}
                      animate={active ? { scale: 1.04 } : { scale: 1 }}
                      onClick={() => pickWord(word)}
                      disabled={done}
                      className={`px-3 py-3 rounded-xl border text-sm font-semibold text-center transition-colors duration-150 ${
                        done
                          ? "border-green-400/25 bg-green-500/[.06] text-green-400/40 line-through"
                          : active
                          ? "border-blue-400/60 bg-gradient-to-br from-blue-500/20 to-purple-500/15 text-blue-100 shadow-[0_0_20px_-4px_rgba(96,165,250,0.7)]"
                          : "border-white/[.08] bg-white/[.02] text-white/70 hover:border-white/25 hover:text-white/90"
                      }`}
                    >
                      {word}
                    </motion.button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-white/25 uppercase tracking-widest text-center mb-0.5">Meaning</p>
                {batch.defs.map((d) => {
                  const done  = matched.has(d.key);
                  const shake = shaking === d.key;
                  return (
                    <motion.button
                      key={d.key}
                      animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                      transition={{ duration: 0.35 }}
                      whileHover={!done && sel ? { y: -2 } : undefined}
                      whileTap={!done && sel ? { scale: 0.96 } : undefined}
                      onClick={() => pickDef(d.key)}
                      disabled={done || !sel}
                      className={`px-3 py-3 rounded-xl border text-sm text-center transition-colors duration-150 ${
                        done
                          ? "border-green-400/25 bg-green-500/[.06] text-green-400/40 line-through"
                          : shake
                          ? "border-red-400/55 bg-red-500/15 text-red-200 shadow-[0_0_18px_-4px_rgba(248,113,113,0.65)]"
                          : sel
                          ? "border-white/[.10] bg-white/[.03] text-white/65 hover:border-blue-400/40 hover:bg-blue-500/[.08] hover:text-white/90"
                          : "border-white/[.05] bg-transparent text-white/30 cursor-default"
                      }`}
                    >
                      {d.label}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
