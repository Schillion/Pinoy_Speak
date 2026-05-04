import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const words = url.searchParams.get("words") ?? "";
  const days  = url.searchParams.get("days")  ?? "30";
  try {
    const res = await fetch(
      `${PY}/word-trends?words=${encodeURIComponent(words)}&days=${encodeURIComponent(days)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ days: [], series: {}, available: false }, { status: 503 });
  }
}
