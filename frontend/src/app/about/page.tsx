"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { fadeUp, staggerContainer } from "@/lib/motion";
import PinoyLogo from "@/components/PinoyLogo";

const FEATURES = [
  {
    icon: "🔍",
    title: "Slang Translator",
    desc: "Paste any Filipino sentence and PinoySpeak highlights every slang word, shows its definition, origin, formation type, and real corpus examples. Non-slang words are labeled as regular so you can see exactly what's what.",
  },
  {
    icon: "🔥",
    title: "Trending Word Tracker",
    desc: "The backend scrapes Filipino social media posts and measures each word's burstiness (Z-score) over time. Words that spike in usage are surfaced as trending — you're seeing real shift in real language, not a curated list.",
  },
  {
    icon: "📖",
    title: "Slang Dictionary",
    desc: "Browse the full lexicon with definitions, plain-English glosses, part of speech, formation type (binaliktad, jejemon, borrowed, etc.), and usage examples pulled from actual posts.",
  },
  {
    icon: "🔬",
    title: "Concordance",
    desc: "See every word in context — search for any slang term and get a KWIC (keyword-in-context) view of how it's actually used across the corpus, with timestamps and source info.",
  },
  {
    icon: "🤖",
    title: "Kuya Slang AI Tutor",
    desc: "A Taglish chatbot powered by Groq (Llama 3.3 70B) → Gemini 2.0 Flash → Ollama fallback chain. Ask it about any word, take a quiz, or just chat. It learns new slang from conversations automatically.",
  },
  {
    icon: "🎯",
    title: "Flashcard Game",
    desc: "Drill your slang vocabulary with a deck of flashcards. Flip to reveal the definition and example, mark cards as known or for review, and track your progress through the full lexicon.",
  },
];

export default function AboutPage() {
  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="max-w-3xl mx-auto px-4 py-10"
    >
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center gap-4 mb-10">
        <div className="aurora-border w-14 h-14 rounded-2xl overflow-hidden
                        bg-gradient-to-br from-blue-500 to-purple-600
                        shadow-[0_0_32px_-6px_rgba(99,102,241,0.7)]
                        select-none flex-shrink-0">
          <PinoyLogo />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-shimmer leading-tight">Pinoy Speak</h1>
          <p className="text-sm text-white/50 mt-0.5">
            A Filipino slang intelligence platform built for curious minds
          </p>
        </div>
      </motion.div>

      {/* What it is */}
      <motion.div variants={fadeUp} className="card p-6 mb-6">
        <p className="text-[11px] text-white/35 uppercase tracking-widest mb-3">What is this?</p>
        <p className="text-sm text-white/75 leading-relaxed">
          Pinoy Speak is a real-time Filipino slang tracker and learning platform. It continuously
          scrapes Filipino social media, runs machine learning models to detect new words and
          meaning shifts, and makes all of that data accessible through a clean interface.
          Whether you're a linguist, a student, or just curious — you can see Filipino internet
          language evolving live.
        </p>
      </motion.div>

      {/* How it works */}
      <motion.p variants={fadeUp} className="text-[11px] text-white/35 uppercase tracking-widest mb-3">
        How it works
      </motion.p>
      <motion.div variants={staggerContainer(0.05)} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {FEATURES.map((f) => (
          <motion.div key={f.title} variants={fadeUp} className="card p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-lg w-8 h-8 flex items-center justify-center rounded-lg
                               bg-white/[0.06] flex-shrink-0 leading-none">
                {f.icon}
              </span>
              <p className="font-semibold text-white/90 text-sm">{f.title}</p>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">{f.desc}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Under the hood */}
      <motion.div variants={fadeUp} className="card p-6 mb-6">
        <p className="text-[11px] text-white/35 uppercase tracking-widest mb-3">Under the hood</p>
        <div className="space-y-2 text-sm text-white/65 leading-relaxed">
          <p>
            <span className="text-white/85 font-medium">Slang detection</span> — Word2Vec embeddings
            trained on the corpus measure semantic shift. A burstiness Z-score flags trending words.
            calamaNLP + a Tagalog wordlist filter out standard Filipino before anything reaches the lexicon.
          </p>
          <p>
            <span className="text-white/85 font-medium">Auto-learning</span> — When you ask the chatbot
            about an unknown word, it calls the backend which verifies via LLM and saves confirmed
            entries to the live dictionary. The RAG vector store updates instantly.
          </p>
          <p>
            <span className="text-white/85 font-medium">Stack</span> — Next.js 14 (Vercel) ·
            FastAPI (Fly.io) · Word2Vec via Gensim · sentence-transformers RAG ·
            calamaNLP · Groq / Gemini / Ollama LLM chain
          </p>
        </div>
      </motion.div>

      {/* Creator */}
      <motion.div variants={fadeUp} className="card p-6">
        <p className="text-[11px] text-white/35 uppercase tracking-widest mb-4">About the creator</p>
        <div className="space-y-3 text-sm">
          {[
            ["Built by",    "Carl Timothy E. Clemente"],
            ["From",        "Montalban, Rizal"],
            ["University",  "University of the Philippines Los Baños (UPLB)"],
            ["Course",      "BS Computer Science"],
            ["Status",      "Senior Student"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-3">
              <span className="text-[10px] text-white/35 uppercase tracking-widest w-24 flex-shrink-0">
                {label}
              </span>
              <span className="text-white/85 font-medium">{value}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 pt-4 border-t border-white/[.06] text-[11px] text-white/35 italic">
          Salamat sa pagsuporta — keep speaking Pinoy! 🤙
        </p>
      </motion.div>

      {/* Back link */}
      <motion.div variants={fadeUp} className="mt-8 flex justify-center">
        <Link
          href="/"
          className="text-sm text-blue-300 hover:text-blue-200 transition-colors
                     border border-blue-400/30 rounded-lg px-4 py-2
                     bg-blue-500/[.08] hover:bg-blue-500/[.15]"
        >
          ← Back to dashboard
        </Link>
      </motion.div>
    </motion.div>
  );
}
