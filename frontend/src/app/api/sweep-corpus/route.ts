import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

// Sweep can take 30-90 seconds depending on candidate pool & LLM provider.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const maxNew = url.searchParams.get("max_new") ?? "15";
  try {
    const res = await fetch(`${PY}/sweep-corpus?max_new=${encodeURIComponent(maxNew)}`, {
      method: "POST",
      signal: AbortSignal.timeout(110_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "ml_unavailable", detail: String(err) },
      { status: 503 },
    );
  }
}
