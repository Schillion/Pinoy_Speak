import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get("word")?.toLowerCase().trim();
  if (!word) return NextResponse.json({ error: "Missing word" }, { status: 400 });

  try {
    const res = await fetch(`${PY}/define?word=${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        ...data,
        source: data.in_dictionary ? "dictionary" : "corpus",
      });
    }
  } catch {
    // Backend offline
  }

  return NextResponse.json({ error: "Word not found" }, { status: 404 });
}
