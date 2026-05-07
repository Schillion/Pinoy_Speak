import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

const PY = process.env.PYTHON_API_URL ?? "http://localhost:8000";

const getCachedStats = unstable_cache(
  async () => {
    const res = await fetch(`${PY}/corpus-stats`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return res.json();
  },
  ["corpus-stats"],
  { revalidate: 1800, tags: ["corpus-stats"] },
);

export async function GET() {
  try {
    const data = await getCachedStats();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 503 });
  }
}
