export type Classification = "slang" | "standard" | "profane" | "unknown";

export interface WordResult {
  classification: Classification;
  reason: string;
  formation_type: string;
  burstiness: number;
  definition: string | null;
  plain_word: string | null;
  canonical?: string | null;
  standard_approx: string[];
  related: string[];
}

export interface AnalyzeResponse {
  tokens: string[];
  results: Record<string, WordResult>;
}

export interface SlangWord {
  word: string;
  count: number;
  definition: string | null;
  plain_word: string | null;
}

export interface CorpusStats {
  total_posts: number;
  top_slang: string;
  slang_count: number;
}

export interface Post {
  id: string;
  text: string | null;
  date: string | null;
  author: string | null;
  likes: number | null;
  source: string;
}

export interface LexiconEntry {
  definition: string;
  formation_type: string;
  plain: string | null;
  pos: string | null;
  origin: string | null;
  example: string | null;
  is_ambiguous: boolean;
}

export interface DefineResult {
  word?: string;
  in_dictionary?: boolean;
  formation_type?: string;
  description?: string;
  plain?: string;
  plain_from_model?: string;
  neighbors?: string[];
  context_words?: string[];
  examples?: string[];
  source?: "dictionary" | "corpus";
  // slang-data.ts hardcoded fallback fields (when backend is offline)
  pos?: string;
  def?: string;
  origin?: string;
  example?: string;
}
