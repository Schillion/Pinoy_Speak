import type { AnalyzeResponse, CorpusStats, DefineResult, LexiconEntry, SlangWord, Post } from "@/types";

const base = "";

export async function analyzeText(
  sentence: string,
  profanityFilter: boolean,
): Promise<AnalyzeResponse> {
  const res = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentence, profanity_filter: profanityFilter }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCorpusStats(): Promise<CorpusStats> {
  const res = await fetch(`${base}/api/corpus-stats`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTopSlang(n = 15): Promise<SlangWord[]> {
  const res = await fetch(`${base}/api/top-slang?n=${n}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.words;
}

export interface WordTrendsResult {
  days: string[];
  series: Record<string, number[]>;
  available: boolean;
}

export interface LanguageMixResult {
  available: boolean;
  total: number;
  data: { name: string; value: number; pct: number }[];
}

export async function fetchLanguageMix(): Promise<LanguageMixResult> {
  const res = await fetch(`${base}/api/language-mix`, { cache: "no-store" });
  if (!res.ok) return { available: false, total: 0, data: [] };
  return res.json();
}

export async function fetchWordTrends(words: string[], days: number): Promise<WordTrendsResult> {
  if (words.length === 0) return { days: [], series: {}, available: true };
  const params = new URLSearchParams({ words: words.join(","), days: String(days) });
  const res = await fetch(`${base}/api/word-trends?${params}`, { cache: "no-store" });
  if (!res.ok) return { days: [], series: {}, available: false };
  return res.json();
}

export async function fetchPosts(
  page: number,
  limit: number,
  search: string,
): Promise<{ posts: Post[]; total: number }> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
  });
  const res = await fetch(`${base}/api/posts?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchLexicon(): Promise<Record<string, LexiconEntry>> {
  const res = await fetch("/api/lexicon", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.entries ?? {};
}

export interface VerifySlangResult {
  is_slang: boolean;
  from_cache?: boolean;
  definition?: string;
  plain?: string | null;
  formation_type?: string | null;
  reason?: string;
}

export async function verifySlang(word: string): Promise<VerifySlangResult> {
  const res = await fetch(`${base}/api/verify-slang`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word }),
  });
  if (!res.ok) return { is_slang: false, reason: `http_${res.status}` };
  return res.json();
}

export interface SweepCorpusResult {
  scanned?: number;
  candidates?: number;
  added?: number;
  lexicon_size?: number;
  delta?: number;
  error?: string;
  detail?: string;
}

export async function sweepCorpus(maxNew = 15): Promise<SweepCorpusResult> {
  const res = await fetch(`${base}/api/sweep-corpus?max_new=${maxNew}`, {
    method: "POST",
  });
  return res.json();
}

export interface ImportSourceDiag {
  kind?: "url" | "reddit-search" | "llm";
  url?: string;
  subreddit?: string;
  query?: string;
  provider?: string;
  ok: boolean;
  snippets?: number;
  found?: number;
  words?: number;
  error?: string;
}

export interface ImportOnlineResult {
  sources?: ImportSourceDiag[];
  candidates_found?: number;
  fresh?: number;
  verified?: number;
  added?: number;
  rejected?: number;
  added_words?: string[];
  lexicon_size?: number;
  error?: string;
  detail?: string;
}

export async function importOnlineSlang(opts?: {
  sources?: string[];
  maxNew?: number;
}): Promise<ImportOnlineResult> {
  const res = await fetch(`${base}/api/import-online-slang`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sources: opts?.sources,
      max_new: opts?.maxNew ?? 30,
    }),
  });
  return res.json();
}

export async function fetchDefine(word: string): Promise<DefineResult> {
  const res = await fetch(
    `${base}/api/define?word=${encodeURIComponent(word.toLowerCase().trim())}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
