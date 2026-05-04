import { NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function POST() {
  try {
    const res = await fetch(`${PY}/train`, { method: "POST", cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 503 });
  }
}
