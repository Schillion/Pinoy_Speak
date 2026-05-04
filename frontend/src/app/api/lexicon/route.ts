import { NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${PY}/lexicon`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "ML service unavailable", entries: {}, count: 0 }, { status: 503 });
  }
}
