"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { FALLBACK_WORDS, WordEntry } from "./_components/words-data";
import { fetchLexicon } from "@/lib/api";
import MessageBubble from "./_components/MessageBubble";
import MagneticButton from "@/components/MagneticButton";

// Game components are heavy (animations, state) and only render when their
// tab is active. Dynamic imports keep them out of the initial Tutor bundle —
// users who only chat never download them.
const WordMatchGame = dynamic(() => import("./_components/WordMatchGame"),  { ssr: false });
const FlashcardGame = dynamic(() => import("./_components/FlashcardGame"),  { ssr: false });
const QuizGame      = dynamic(() => import("./_components/QuizGame"),      { ssr: false });

interface Message {
  role: "user" | "assistant";
  content: string;
  time: string;
  suggestions?: string[];
}

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getQuickReplies(content: string, words: WordEntry[]): string[] {
  if (/what does "[\w]+" mean/i.test(content)) return [];

  const mentioned = words.find((w) => {
    return new RegExp(`\\b${w.word}\\b`, "i").test(content);
  });

  if (mentioned) {
    return [
      `Origin of "${mentioned.word}"?`,
      `Use "${mentioned.word}" in a sentence`,
      "Quiz me!",
    ];
  }

  if (/list|all words/i.test(content)) {
    const r = words[Math.floor(Math.random() * words.length)];
    return r ? [`Tell me about "${r.word}"`, "Quiz me!"] : ["Quiz me!"];
  }

  return ["What does 'grabe' mean?", "Quiz me!", "Tell me about 'kilig'"];
}

const GREETING =
  'Kumusta! I\'m Kuya Slang — your Filipino slang tutor. 🤙\n\nAsk me about any slang word like "grabe" or "kilig", say "quiz me" to test yourself, or type "list all" to see every word I know.';

const INITIAL_SUGGESTIONS = [
  "What does 'grabe' mean?",
  "Quiz me!",
  "How do I use 'kilig' in a sentence?",
  "What's the origin of 'lodi'?",
  "List all words",
];

function makeInitialMessages(): Message[] {
  return [{ role: "assistant", content: GREETING, time: getTime(), suggestions: INITIAL_SUGGESTIONS }];
}

type Mode = "chat" | "flashcard" | "quiz" | "match";

// Persist tutor session across client-side navigations (user leaves and comes
// back without refreshing). On an actual browser refresh the JS module is
// re-evaluated, so _moduleAlive starts false and we wipe the session —
// matching ChatGPT's "refresh = new chat" behaviour.
const STORAGE_KEY   = "pinoyspeak_tutor_session";
const STORAGE_VERS  = 2;
const IDLE_RESET_MS = 60 * 60 * 1000; // 1 hour idle still resets

let _moduleAlive = false; // false on first JS eval (page load/refresh); true after first mount

const TABS: { id: Mode; label: string; icon: string }[] = [
  { id: "chat",      label: "Chat",       icon: "💬" },
  { id: "flashcard", label: "Flashcards", icon: "🃏" },
  { id: "quiz",      label: "Quiz",       icon: "🧠" },
  { id: "match",     label: "Match",      icon: "🎯" },
];

export default function ChatPage() {
  const [mode, setMode]         = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>(makeInitialMessages);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [words, setWords]       = useState<WordEntry[]>(FALLBACK_WORDS);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // On browser refresh _moduleAlive is false → wipe session and start fresh.
  // On client-side nav back to this page _moduleAlive is already true → restore.
  useEffect(() => {
    if (!_moduleAlive) {
      _moduleAlive = true;
      localStorage.removeItem(STORAGE_KEY);
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lastActive: number = Number(parsed?.lastActive ?? 0);
        const isFresh = lastActive > 0 && (Date.now() - lastActive) < IDLE_RESET_MS;
        if (parsed?.v === STORAGE_VERS && isFresh) {
          if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
            setMessages(parsed.messages);
          }
          if (parsed.mode === "chat" || parsed.mode === "flashcard" ||
              parsed.mode === "quiz" || parsed.mode === "match") {
            setMode(parsed.mode);
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch { /* corrupt storage — ignore */ }
    setHydrated(true);
  }, []);

  // Persist on every change once hydrated (avoid clobbering on first render).
  // We stamp every save with `lastActive` so the next mount can decide
  // whether to resume or start fresh.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: STORAGE_VERS, mode, messages, lastActive: Date.now() }),
      );
    } catch { /* quota exceeded — ignore */ }
  }, [hydrated, mode, messages]);

  useEffect(() => {
    fetchLexicon()
      .then((entries) => {
        const mapped = Object.entries(entries)
          .filter(([, e]) => e.definition && e.plain && e.example)
          .map(([word, e]) => ({
            word,
            pos: e.pos ?? "slang",
            plain: e.plain!,
            def: e.definition,
            example: e.example!,
          }));
        if (mapped.length > 0) setWords(mapped);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed, time: getTime() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json();
      const botContent: string = data.content;
      setMessages([
        ...history,
        { role: "assistant", content: botContent, time: getTime(), suggestions: getQuickReplies(botContent, words) },
      ]);
    } catch {
      setMessages([...history, {
        role: "assistant",
        content: "Ay, may problema sa koneksyon. Try again!",
        time: getTime(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [messages, loading]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  function clearChat() {
    setMessages(makeInitialMessages());
    setInput("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] md:h-[calc(100vh-4rem)]">

      <motion.div
        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 sm:pb-4 mb-3 sm:mb-4
                   gap-3 border-b border-white/[.06] flex-shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: [0, -10, 10, -5, 0], scale: 1.08 }}
            transition={{ duration: 0.6 }}
            className="aurora-border w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-lg sm:text-xl select-none
                       bg-gradient-to-br from-blue-500/30 to-purple-500/20
                       shadow-[0_0_28px_-4px_rgba(96,165,250,0.7)]"
          >
            🤙
          </motion.div>
          <div>
            <h1 className="font-semibold text-shimmer text-base leading-none">Kuya Slang</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <motion.span
                animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.9)]"
              />
              <p className="text-xs text-white/35">Online · Filipino slang tutor</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl overflow-hidden border border-white/[.08] text-xs relative">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                className={`relative px-3 py-2 transition-colors border-r border-white/[.07] last:border-0
                            flex items-center gap-1.5 ${
                  mode === t.id ? "text-blue-200" : "text-white/40 hover:text-white/70"
                }`}
              >
                {mode === t.id && (
                  <motion.span
                    layoutId="chat-tab-pill"
                    className="absolute inset-0 bg-gradient-to-r from-blue-500/25 to-purple-500/20"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">{t.icon}</span>
                <span className="relative hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {mode === "chat" && (
            <button
              onClick={clearChat}
              title="New conversation"
              className="text-xs text-white/30 hover:text-white/60 transition-colors px-2 py-1 rounded-lg
                         border border-transparent hover:border-white/[.08]"
            >
              New chat
            </button>
          )}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {mode === "flashcard" && (
          <motion.div key="fc" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex-1 overflow-y-auto">
            <FlashcardGame words={words} />
          </motion.div>
        )}
        {mode === "quiz" && (
          <motion.div key="qz" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex-1 overflow-y-auto">
            <QuizGame words={words} />
          </motion.div>
        )}
        {mode === "match" && (
          <motion.div key="mt" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex-1 overflow-y-auto">
            <WordMatchGame words={words} />
          </motion.div>
        )}

        {mode === "chat" && (
          <motion.div key="ch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto space-y-5 pr-1">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                >
                  {m.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-1 select-none
                                    bg-gradient-to-br from-blue-500/25 to-purple-500/15
                                    border border-blue-400/25 shadow-[0_0_14px_-4px_rgba(96,165,250,0.5)]">
                      🤙
                    </div>
                  )}
                  <div className={`flex flex-col gap-1.5 max-w-[72%] ${m.role === "user" ? "items-end" : "items-start"}`}>
                    <div className={`rounded-2xl px-4 py-3 text-sm backdrop-blur-sm ${
                      m.role === "user"
                        ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-tr-sm shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)]"
                        : "bg-white/[.05] border border-white/[.08] text-white/80 rounded-tl-sm"
                    }`}>
                      <MessageBubble content={m.content} />
                    </div>

                    {m.role === "assistant" && i === messages.length - 1 && m.suggestions && m.suggestions.length > 0 && !loading && (
                      <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
                        className="flex flex-wrap gap-1.5 mt-0.5"
                      >
                        {m.suggestions.map((s, si) => (
                          <motion.button
                            key={s}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25 + si * 0.05 }}
                            whileHover={{ y: -2, scale: 1.03 }}
                            onClick={() => send(s)}
                            className="text-xs bg-white/[.04] border border-white/[.10] rounded-full
                                       px-3 py-1.5 text-white/50 hover:text-blue-200 hover:border-blue-400/40
                                       hover:bg-blue-500/[.08] transition-colors"
                          >
                            {s}
                          </motion.button>
                        ))}
                      </motion.div>
                    )}

                    <span className="text-[10px] text-white/25 px-1">{m.time}</span>
                  </div>
                </motion.div>
              ))}

              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 select-none
                                  bg-gradient-to-br from-blue-500/25 to-purple-500/15
                                  border border-blue-400/25">
                    🤙
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="bg-white/[.05] border border-white/[.08] rounded-2xl rounded-tl-sm
                                    px-4 py-3.5 flex items-center gap-1.5 backdrop-blur-sm">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="w-2 h-2 bg-blue-400/60 rounded-full"
                          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-white/25 px-1">Kuya Slang is typing…</span>
                  </div>
                </motion.div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex-shrink-0 pt-4 border-t border-white/[.06] mt-4">
              <div className="flex gap-3 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={autoResize}
                  onKeyDown={handleKey}
                  placeholder="Ask about a slang word, say 'quiz me', or 'list all'…"
                  rows={1}
                  className="input-glass flex-1 px-4 py-3 text-sm resize-none leading-relaxed"
                  style={{ minHeight: 48 }}
                />
                <MagneticButton
                  onClick={() => send(input)}
                  disabled={loading || !input.trim()}
                  strength={0.25}
                  className="bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500
                             disabled:opacity-35 disabled:hover:from-blue-500 disabled:hover:to-indigo-600
                             text-white rounded-xl px-5 h-12 text-sm font-medium
                             transition-colors flex-shrink-0 flex items-center gap-2
                             shadow-[0_0_24px_-4px_rgba(99,102,241,0.75)]
                             hover:shadow-[0_0_34px_-2px_rgba(99,102,241,0.9)]"
                >
                  Send
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 21L23 12 2 3v7l15 2-15 2v7z" />
                  </svg>
                </MagneticButton>
              </div>
              <p className="text-[10px] text-white/20 mt-2 text-center">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
