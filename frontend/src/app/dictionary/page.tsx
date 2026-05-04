import type { LexiconEntry } from "@/types";
import DictionaryClient from "./DictionaryClient";

export const metadata = {
  title: "Filipino Slang Dictionary | PinoySpeak",
  description: "Browse the complete, continuously updated dictionary of Filipino internet slang with definitions, examples, and origins."
};

// Revalidate this page in the background every 10 minutes so new slang gets SSR'd
export const revalidate = 600;

export default async function DictionaryPage() {
  let initialLexicon: Record<string, LexiconEntry> = {};
  try {
    // Next.js Server Components require an absolute URL to fetch.
    const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";
    const res = await fetch(`${PY}/lexicon`, {
      next: { revalidate: 600 },
    });
    const data = await res.json();
    initialLexicon = data.entries ?? {};
  } catch (e) {
    console.error("[SSR] Failed to fetch initial lexicon:", e);
  }

  return <DictionaryClient initialLexicon={initialLexicon} />;
}
