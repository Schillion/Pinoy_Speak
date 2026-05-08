import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days  = url.searchParams.get("days")  ?? "30";
  const n     = url.searchParams.get("n")     ?? "";
  const words = url.searchParams.get("words") ?? "";

  const params = new URLSearchParams({ days });
  if (n)     params.set("n", n);
  if (words) params.set("words", words);

  try {
    const res = await fetch(
      `${PY}/word-trends?${params}`,
      { cache: "no-store", signal: AbortSignal.timeout(45000) },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ days: [], series: {}, words: [], available: false }, { status: 503 });
  }
}
