import { NextResponse } from "next/server";

export async function GET() {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const results: Record<string, string> = {
    groq_key: groqKey ? `set (${groqKey.slice(0, 8)}...)` : "NOT SET",
    gemini_key: geminiKey ? `set (${geminiKey.slice(0, 8)}...)` : "NOT SET",
  };

  // Test Groq
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "reply with just the word: ok" }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        results.groq_test = `OK — model replied: "${data.choices?.[0]?.message?.content ?? "?"}"`;
      } else {
        results.groq_test = `FAILED — HTTP ${res.status}: ${await res.text()}`;
      }
    } catch (e) {
      results.groq_test = `ERROR — ${String(e)}`;
    }
  } else {
    results.groq_test = "SKIPPED — no key";
  }

  // Test Gemini
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "reply with just the word: ok" }] }] }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        results.gemini_test = `OK — model replied: "${data.candidates?.[0]?.content?.parts?.[0]?.text ?? "?"}"`;
      } else {
        results.gemini_test = `FAILED — HTTP ${res.status}: ${await res.text()}`;
      }
    } catch (e) {
      results.gemini_test = `ERROR — ${String(e)}`;
    }
  } else {
    results.gemini_test = "SKIPPED — no key";
  }

  return NextResponse.json(results);
}
