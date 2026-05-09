import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

// Cache the full lexicon for 1 hour. Tagged so a POST to /api/revalidate
// can purge it immediately after a new word is learned.
const getCachedLexicon = unstable_cache(
  async () => {
    const res = await fetch(`${PY}/lexicon`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return res.json();
  },
  ["lexicon"],
  { revalidate: 60, tags: ["lexicon"] },
);

export async function GET() {
  try {
    const data = await getCachedLexicon();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "ML service unavailable", entries: {}, count: 0 },
      { status: 503 },
    );
  }
}
