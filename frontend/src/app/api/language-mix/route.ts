import { NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${PY}/language-mix`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ available: false, total: 0, data: [] }, { status: 503 });
  }
}
