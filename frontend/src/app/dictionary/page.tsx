import type { LexiconEntry } from "@/types";
import DictionaryClient from "./DictionaryClient";

export const metadata = {
  title: "Filipino Slang Dictionary | PinoySpeak",
  description: "Browse the complete, continuously updated dictionary of Filipino internet slang with definitions, examples, and origins."
};

// Never pre-render at build time — always fetch fresh from the backend
export const dynamic = "force-dynamic";

export default async function DictionaryPage() {
  let initialLexicon: Record<string, LexiconEntry> = {};
  try {
    const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";
    const res = await fetch(`${PY}/lexicon`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      initialLexicon = data.entries ?? {};
    }
  } catch (e) {
    // Backend offline — client will retry on mount
    console.warn("[SSR] Lexicon fetch skipped (backend unavailable)");
  }

  return <DictionaryClient initialLexicon={initialLexicon} />;
}

