import { NextRequest, NextResponse } from "next/server";
import type { LexiconEntry } from "@/types";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

// ── Lexicon cache (5-minute TTL) ──────────────────────────────────────────────
let _lexiconCache: Record<string, LexiconEntry> = {};
let _lexiconCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getLexicon(): Promise<Record<string, LexiconEntry>> {
  if (Date.now() - _lexiconCacheAt < CACHE_TTL && Object.keys(_lexiconCache).length > 0) {
    return _lexiconCache;
  }
  try {
    const res = await fetch(`${PY}/lexicon`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      _lexiconCache = data.entries ?? {};
      _lexiconCacheAt = Date.now();
    }
  } catch {
    // backend offline — use whatever is cached
  }
  return _lexiconCache;
}

function buildSystemPrompt(lexicon: Record<string, LexiconEntry>): string {
  const words = Object.entries(lexicon);
  const wordList = words
    .map(([w, e]) =>
      `- **${w}**${e.pos ? ` (${e.pos})` : ""}: ${e.definition}${e.plain ? ` Plain English: "${e.plain}".` : ""}${e.origin ? ` Origin: ${e.origin}` : ""}${e.example ? ` Example: ${e.example}` : ""}`
    )
    .join("\n");

  return `You are Kuya Slang, a friendly and fun Filipino slang tutor chatbot on the Pinoy Speak app. Your personality is warm, encouraging, and uses a mix of Filipino and English (Taglish) naturally.

You help users learn Filipino internet slang. You currently know exactly ${words.length} slang words. Here is the dictionary:

${wordList}

Guidelines:
- Be conversational and natural, not robotic
- Use light Taglish expressions like "Ay grabe!", "Charot!", "Keri lang!" to feel authentic
- When explaining a word, give: the definition, a natural example sentence, its origin, and plain English equivalent
- If a user asks about a Filipino slang word that is NOT in the dictionary above, do your best to explain it from your own knowledge (definition, example, origin, plain English). Never refuse just because it's not in the list — the dictionary auto-learns new entries from your replies.
- IMPORTANT: when asked to "list all" / "what words do you know" / "give me all" / similar requests, do NOT dump a long list. Instead, mention the total count, give 2-3 random examples, and direct them to the **Dictionary** page (book icon in the sidebar) which has the full alphabetical browse with definitions and origins.
- When asked to quiz the user, give ONE word at a time and wait for their answer
- Grade quiz answers generously — accept synonyms and partial answers
- Keep responses concise and friendly
- You can answer questions about yourself, the Pinoy Speak app, Filipino culture, or general knowledge naturally — you have a mind of your own, not just a slang dictionary
- Pinoy Speak was created by Carl Timothy Clemente, a computer science student from UPLB (University of the Philippines Los Baños), as a project to document and explore Filipino internet slang. Answer any "who made you / who created you / who is your creator" questions with this naturally`;
}

// ── Groq — free tier, 14 400 req/day, Llama 3.3 70B ─────────────────────────
async function callGroq(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("No GROQ_API_KEY");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      ],
      max_tokens: 512,
      temperature: 0.8,
    }),
  });

  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content ?? "Ay, wala akong masabi ngayon. Try again!";
}

// ── Gemini — free tier, 500 req/day ──────────────────────────────────────────
async function callGemini(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No GEMINI_API_KEY");

  const contents = messages
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }))
    .filter((_, i, arr) => {
      const firstUser = arr.findIndex((m) => m.role === "user");
      return firstUser === -1 || i >= firstUser;
    });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 512, temperature: 0.8 },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "Ay, wala akong masabi ngayon. Try again!";
}

// ── Rule-based fallback ───────────────────────────────────────────────────────
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildFallbackResponse(
  userText: string,
  history: { role: string; content: string }[],
  lexicon: Record<string, LexiconEntry>,
): string {
  const lower = userText.toLowerCase();
  const allWords = Object.keys(lexicon);

  const lastBot = [...history].reverse().find((m) => m.role === "assistant");
  const quizMatch = lastBot?.content.match(/What does "(\w+)" mean/i);
  if (quizMatch) {
    const qWord = quizMatch[1].toLowerCase();
    const entry = lexicon[qWord];
    if (entry) {
      const keyWords = entry.definition.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const hit = userText.toLowerCase().split(/\W+/).some((w) => keyWords.includes(w))
        || (entry.plain ? lower.includes(entry.plain.toLowerCase()) : false);
      if (hit) {
        return `Tama! ✅ "${qWord}" means: ${entry.definition}\n\n${entry.example ? `Example: ${entry.example}\n\n` : ""}Want another one? Say "quiz me"!`;
      } else {
        return `Hindi pa! ❌ "${qWord}" actually means: ${entry.definition}\n\n${entry.example ? `Example: ${entry.example}\n\n` : ""}Try another? Say "quiz me"!`;
      }
    }
  }

  if (/quiz|test me|pasubok|exam/i.test(lower)) {
    const pick = pickRandom(allWords);
    return `Quiz time! 🤔\n\nWhat does "${pick}" mean in Filipino internet slang?`;
  }

  if (/list|lahat|all words|what do you know/i.test(lower)) {
    const a = pickRandom(allWords);
    const b = pickRandom(allWords);
    const c = pickRandom(allWords);
    return (
      `I know **${allWords.length}** Filipino slang words right now! 📚\n\n` +
      `For the full alphabetical list with definitions, examples, and origins, ` +
      `open the **Dictionary** page (book icon in the sidebar). It's the proper ` +
      `place to browse — Merriam-Webster style.\n\n` +
      `Quick samples: **${a}**, **${b}**, **${c}** — ask me about any of them here!`
    );
  }

  const hit = allWords.find((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
  if (hit) {
    const e = lexicon[hit];
    return `**${hit}**${e.pos ? ` (${e.pos})` : ""}\n\n${e.definition}\n\n${e.example ? `Example: ${e.example}\n\n` : ""}${e.origin ? `Origin: ${e.origin}\n\n` : ""}${e.plain ? `Plain English: "${e.plain}"` : ""}`;
  }

  if (/^(hi|hello|hey|kumusta|kamusta|musta|sup|yo\b)/i.test(lower.trim())) {
    return `Kumusta! I'm Kuya Slang — your Filipino slang tutor! 🤙\n\nI know ${allWords.length} slang words. Ask me about one like "grabe" or "kilig", or say "quiz me" to test yourself!`;
  }

  if (/how are you|kamusta ka|musta ka|how's it going|how you doing/i.test(lower)) {
    return `Ayos lang, salamat! 😄 More importantly — ready ka na ba matuto ng Filipino slang?\n\nAsk me about any word like "lodi", "petmalu", or "sana all", or say "quiz me" to test yourself!`;
  }

  if (/thank|salamat|thanks/i.test(lower)) {
    return `Walang anuman! 🤙 Ask me about more slang anytime — or say "quiz me" to test yourself!`;
  }

  if (/what.*name|sino ka|who are you|what are you/i.test(lower)) {
    return `Ako si Kuya Slang — your Filipino slang tutor on PinoySpeak! 🤙\n\nI know ${allWords.length} words. Ask me about one, or say "quiz me" to play!`;
  }

  const samples = [pickRandom(allWords), pickRandom(allWords), pickRandom(allWords)];
  return `Hindi ko gets, pero keri lang! 😄 Try asking about a specific slang word like "solid", "bet", or "kilig" — or say "quiz me" to play a quick game!\n\nI know: ${samples.join(", ")}, and ${allWords.length - 3} more.`;
}

// ── Log user message to training corpus (fire-and-forget) ────────────────────
function logToCorpus(text: string): void {
  if (!text || text.trim().length < 10) return;
  fetch(`${PY}/log-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.trim() }),
  }).catch(() => {});
}

// ── Auto-learn: extract any newly-defined slang from the bot's reply and
// persist it to the backend lexicon (fire-and-forget) ────────────────────────
const EXTRACT_SYSTEM = `You analyze a Filipino slang tutor's reply and decide whether the reply defines a slang word that should be added to a Filipino slang dictionary.

Return ONLY a single-line JSON object — no markdown, no commentary. Schema:
{ "add": boolean, "word": string, "definition": string, "plain": string, "pos": string, "origin": string, "example": string }

Set "add": false if the reply does not define a slang word, if it's only quizzing/redirecting, or if the word is plain English/standard Tagalog. Set "add": true ONLY when the reply clearly defines ONE Filipino slang term. The "word" must be a single lowercase token (no spaces). Keep "definition" under 25 words.`;

async function extractNewSlang(
  userMsg: string,
  botReply: string,
): Promise<null | {
  word: string; definition: string; plain?: string;
  pos?: string; origin?: string; example?: string;
}> {
  const prompt = `User asked: ${userMsg}\n\nTutor replied: ${botReply}\n\nReturn the JSON now.`;

  let raw = "";
  try {
    if (process.env.GROQ_API_KEY) {
      raw = await callGroq(
        [{ role: "user", content: prompt }],
        EXTRACT_SYSTEM,
      );
    } else if (process.env.GEMINI_API_KEY) {
      raw = await callGemini(
        [{ role: "user", content: prompt }],
        EXTRACT_SYSTEM,
      );
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (!obj.add || !obj.word) return null;
    const word = String(obj.word).toLowerCase().trim();
    if (!word || /\s/.test(word) || word.length < 2 || word.length > 40) return null;
    return {
      word,
      definition: String(obj.definition ?? "").trim(),
      plain:      obj.plain   ? String(obj.plain).trim()   : undefined,
      pos:        obj.pos     ? String(obj.pos).trim()     : undefined,
      origin:     obj.origin  ? String(obj.origin).trim()  : undefined,
      example:    obj.example ? String(obj.example).trim() : undefined,
    };
  } catch {
    return null;
  }
}

async function autoLearn(
  userMsg: string,
  botReply: string,
  lexicon: Record<string, LexiconEntry>,
): Promise<void> {
  const found = await extractNewSlang(userMsg, botReply);
  if (!found) return;
  if (lexicon[found.word]) return;             // already known
  if (!found.definition || found.definition.length < 4) return;

  try {
    await fetch(`${PY}/learn-slang`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(found),
      signal: AbortSignal.timeout(4000),
    });
    // Bust the local lexicon cache so the new entry is served on next request
    _lexiconCacheAt = 0;
  } catch {
    // best-effort — never break the chat response
  }
}

// ── Pre-flight: detect a target word and look it up if unknown ──────────────
// When the user asks about a word the lexicon doesn't have, we hit
// /verify-slang (which already does corpus + LLM verification) BEFORE
// generating the chat reply. The result is injected into the system prompt
// so the bot can answer authoritatively, OR — when the word can't be
// verified anywhere — instructs the bot to admit ignorance and point the
// user at the "Find missed slang" / "Import from web" tools.

// Patterns that explicitly mark a "what does X mean" intent. When any of
// these match, we extract the captured word as the lookup target.
const ASK_PATTERNS: RegExp[] = [
  // English variants
  /(?:what(?:'s|s|\s+is|\s+does|\s+da)?|whats?)\s+["“']?([a-z][a-z'-]{1,30})["”']?\s*(?:mean|stand for|\?)?/i,
  /\b(?:meaning|definition|define|explain)\s+(?:of\s+)?["“']?([a-z][a-z'-]{1,30})["”']?/i,
  /["“']?([a-z][a-z'-]{1,30})["”']?\s+(?:meaning|definition|mean|means|ano)/i,
  // Tagalog variants
  /(?:ibig\s+sabihin|kahulugan|paliwanagin|paki-explain)\s+(?:ng|nung?|nang)\s+["“']?([a-z][a-z'-]{1,30})["”']?/i,
  /\bano\s+(?:yung?|ang|ba\s+yung?|po\s+yung?|daw\s+yung?)?\s*["“']?([a-z][a-z'-]{1,30})["”']?/i,
  /\bsabi\s+ng\s+["“']?([a-z][a-z'-]{1,30})["”']?/i,
  // Bare word(s) — the entire message is just the word, with optional ?
  /^\s*["“']?([a-z][a-z'-]{2,30})["”']?\s*\??\s*$/i,
];

// Stopwords that should NEVER be sent to verify-slang even if matched
const COMMON_WORDS = new Set([
  // English fillers
  "the","and","but","for","you","that","this","with","from","have","what","when","where",
  "why","how","who","yes","no","not","can","could","would","should","will","just","like",
  "about","been","are","was","were","one","two","three","very","also","more","most","much",
  "some","any","other","than","then","over","new","old","day","time","year","good","bad",
  // Tagalog particles + pronouns
  "ang","ng","sa","na","at","ay","si","ni","ko","mo","ka","ikaw","kami","kayo","sila",
  "ako","tayo","ako","ito","iyan","iyon","pero","kasi","lang","yung","ung","din","rin",
  "raw","daw","pala","naman","talaga","sana","ano","anong","anu","kanino","saan","kanya",
  "po","opo","oo","hindi","wala","mayroon","may","kung","para","bago","matapos",
  // Greetings + chat verbs that aren't slang
  "hi","hello","hey","kumusta","kamusta","musta","quiz","test","list","help","please",
  "sige","oo","ok","okay","tnx","thanks","salamat","thank","you","oo","yup","nope",
]);

function detectUnknownWord(
  userMsg: string,
  lexicon: Record<string, LexiconEntry>,
): string | null {
  const text = userMsg.toLowerCase().trim();

  // Pass 1 — explicit ask patterns (high signal)
  for (const pat of ASK_PATTERNS) {
    const m = text.match(pat);
    if (!m) continue;
    const word = (m[1] || "").trim().replace(/^['"]+|['"]+$/g, "");
    if (!word || word.length < 3 || COMMON_WORDS.has(word)) continue;
    if (lexicon[word]) return null;   // already known — let LLM answer normally
    return word;
  }

  // Pass 2 — short messages with a single non-stopword unknown token.
  // Catches cases like "kalingangin po", "petmalu naman", "ano si forda"
  // that the structured patterns miss. Capped at 8 tokens to avoid firing
  // on every casual message.
  const tokens = text.match(/[a-z][a-z'-]{2,30}/g) ?? [];
  if (tokens.length === 0 || tokens.length > 8) return null;

  for (const t of tokens) {
    if (COMMON_WORDS.has(t)) continue;
    if (lexicon[t]) return null;        // user is asking about known slang — LLM handles
    // Skip clearly-English / clearly-Tagalog dictionary words. The LLM
    // probably already knows the answer if it's a standard word.
    // We do NOT skip here — we let verify-slang decide. False positives
    // are cheap (LLM returns is_slang: false → we don't add anything).
    return t;
  }
  return null;
}

interface VerifyResult {
  is_slang: boolean;
  from_cache?: boolean;
  definition?: string;
  plain?: string | null;
  formation_type?: string | null;
}

async function lookupUnknown(word: string): Promise<VerifyResult | null> {
  try {
    const res = await fetch(`${PY}/verify-slang`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as VerifyResult;
  } catch {
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const last = messages[messages.length - 1];

  if (last?.role === "user") logToCorpus(last.content);

  const lexicon = await getLexicon();

  // Pre-flight word lookup. Only run when we can clearly identify a
  // target word — we don't want to fire LLM calls on every chat turn.
  let lookupNote = "";
  if (last?.role === "user") {
    const targetWord = detectUnknownWord(last.content, lexicon);
    if (targetWord) {
      const verified = await lookupUnknown(targetWord);
      if (verified?.is_slang && verified.definition) {
        // Bust the local lexicon cache so the fresh entry is visible to
        // future requests on this server instance.
        _lexiconCacheAt = 0;
        lookupNote =
          `\n\n[INTERNAL — system note for this turn]\n` +
          `The user is asking about "${targetWord}". This word was NOT in your ` +
          `dictionary, but we just searched the corpus + web and confirmed:\n` +
          `  • Definition: ${verified.definition}\n` +
          (verified.plain ? `  • Plain English: ${verified.plain}\n` : "") +
          (verified.formation_type ? `  • Formation: ${verified.formation_type}\n` : "") +
          `Use this in your reply, naturally — and mention casually that you just ` +
          `learned it (e.g. "Ay grabe, bago ko 'to nalaman!" / "I just picked this up!").`;
      } else {
        lookupNote =
          `\n\n[INTERNAL — system note for this turn]\n` +
          `The user is asking about "${targetWord}". It is NOT in your dictionary ` +
          `and our online search could not confirm it as Filipino slang. Reply honestly: ` +
          `tell them you don't recognize "${targetWord}" yet, ask if they can describe how ` +
          `they've heard it used, and suggest they try the "Find missed slang" or "Import ` +
          `from web" buttons on the Top Slang page so the dictionary can grow. Do NOT invent ` +
          `a definition.`;
      }
    }
  }

  const systemPrompt = buildSystemPrompt(lexicon) + lookupNote;

  let reply: string | null = null;

  if (process.env.GROQ_API_KEY) {
    try {
      reply = await callGroq(messages, systemPrompt);
    } catch (err) {
      console.error("[chat] Groq failed:", String(err));
    }
  } else {
    console.warn("[chat] GROQ_API_KEY not set");
  }

  if (reply == null && process.env.GEMINI_API_KEY) {
    try {
      reply = await callGemini(messages, systemPrompt);
    } catch (err) {
      console.error("[chat] Gemini failed:", String(err));
    }
  } else if (reply == null) {
    console.warn("[chat] GEMINI_API_KEY not set — using fallback");
  }

  if (reply == null) {
    reply = buildFallbackResponse(last?.content ?? "", messages.slice(0, -1), lexicon);
  }

  // Auto-learn — fire-and-forget. Only meaningful when an LLM is configured;
  // skip when we're on the rule-based fallback (it just echoes the lexicon).
  if (last?.role === "user" && (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)) {
    autoLearn(last.content, reply, lexicon).catch(() => {});
  }

  return NextResponse.json({ content: reply });
}
