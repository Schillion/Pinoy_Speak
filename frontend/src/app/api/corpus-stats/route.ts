import { NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${PY}/corpus-stats`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 503 });
  }
}
