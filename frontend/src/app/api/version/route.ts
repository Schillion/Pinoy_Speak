import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const id =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "dev";
  return NextResponse.json({ buildId: id });
}
