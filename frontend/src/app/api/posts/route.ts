import { NextRequest, NextResponse } from "next/server";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const params = new URLSearchParams({
    page:   searchParams.get("page")   ?? "1",
    limit:  searchParams.get("limit")  ?? "50",
    search: searchParams.get("search") ?? "",
  });
  try {
    const res = await fetch(`${PY}/posts?${params}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 503 });
  }
}
