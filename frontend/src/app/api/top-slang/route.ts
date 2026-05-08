import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const n      = req.nextUrl.searchParams.get("n")      ?? "15";
  const period = req.nextUrl.searchParams.get("period") ?? "overall";
  try {
    const res = await fetch(`${PY}/top-slang?n=${n}&period=${period}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 503 });
  }
}
