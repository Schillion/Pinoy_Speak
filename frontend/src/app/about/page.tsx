"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { fadeUp, staggerContainer } from "@/lib/motion";
import PinoyLogo from "@/components/PinoyLogo";

const FEATURES = [
  {
    icon: "🔍",
    title: "Slang Translator",
    desc: "Paste any Filipino sentence and PinoySpeak highlights every slang word, shows its definition, origin, word type, and real examples from actual posts. Normal words are labeled so you can see exactly what's slang and what isn't.",
  },
  {
    icon: "🔥",
    title: "Trending Word Tracker",
    desc: "The app scrapes Filipino social media posts and tracks how quickly each word gains popularity over time. Words that suddenly spike in usage are surfaced as trending — real language change, not a hand-picked list.",
  },
  {
    icon: "📖",
    title: "Slang Dictionary",
    desc: "Browse the full word list with definitions, simple explanations, part of speech, word type (reversed spelling, jejemon, borrowed, etc.), and real usage examples pulled from actual posts.",
  },
  {
    icon: "🔬",
    title: "Word in Context",
    desc: "Search any slang word and see every post it appears in, lined up so the words before and after are easy to compare. Great for understanding how a word is actually used day-to-day.",
  },
  {
    icon: "🤖",
    title: "Kuya Slang AI Tutor",
    desc: "A Taglish chatbot that knows Filipino slang. Ask it about any word, take a quiz, or just chat in Taglish. When it encounters a new word it hasn't seen before, it looks it up and adds it to the dictionary automatically.",
  },
  {
    icon: "🎯",
    title: "Flashcard Game",
    desc: "Practice your slang with a deck of flashcards. Flip to reveal the definition and example, mark cards as known or for review, and track your progress through all the words we track.",
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
            A Filipino slang tracker and learning tool
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
            <span className="text-white/85 font-medium">Slang detection</span> — AI word models
            learn how Filipino words are normally used together. Words that suddenly appear much more
            often get flagged as trending. A Filipino word checker makes sure normal Tagalog words
            don&apos;t get mistaken for slang.
          </p>
          <p>
            <span className="text-white/85 font-medium">Auto-learning</span> — When you ask the
            chatbot about a word it hasn&apos;t seen before, it checks if it&apos;s really slang and
            adds it to the live dictionary automatically. The chatbot&apos;s knowledge updates right away.
          </p>
          <p>
            <span className="text-white/85 font-medium">Tech stack</span> — Next.js 14 (Vercel) ·
            FastAPI (Fly.io) · AI word models · Groq / Gemini / Ollama AI
          </p>
        </div>
      </motion.div>

      {/* Data & Privacy */}
      <motion.div variants={fadeUp} className="card p-6 mb-6">
        <p className="text-[11px] text-white/35 uppercase tracking-widest mb-3">Data &amp; Privacy</p>
        <div className="space-y-2.5 text-sm text-white/65 leading-relaxed">
          <p>
            <span className="text-white/85 font-medium">What we collect</span> — Only the text of
            publicly visible posts from Filipino Reddit communities. No usernames, profile data,
            private messages, or any other personal information is stored.
          </p>
          <p>
            <span className="text-white/85 font-medium">How it&apos;s used</span> — Post text is
            used exclusively for linguistic analysis: detecting slang words, tracking usage frequency
            over time, and generating example sentences. It is never sold, shared with third parties,
            or used for advertising.
          </p>
          <p>
            <span className="text-white/85 font-medium">No tracking</span> — This site has no user
            accounts, requires no login, and sets no tracking or analytics cookies. Your visits are
            not logged or associated with any identity.
          </p>
          <p>
            <span className="text-white/85 font-medium">Reddit&apos;s terms</span> — Data is collected
            in compliance with Reddit&apos;s publicly available API and content policy. All source
            communities are public subreddits accessible to any visitor without an account.
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
