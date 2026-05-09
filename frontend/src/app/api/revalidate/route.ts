import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

const SECRET = process.env.REVALIDATE_SECRET ?? "";

export async function POST(req: NextRequest) {
  const { secret, tags } = await req.json().catch(() => ({}));

  if (SECRET && secret !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const toRevalidate: string[] = Array.isArray(tags) ? tags : ["lexicon"];
  for (const tag of toRevalidate) {
    revalidateTag(tag);
  }

  return NextResponse.json({ revalidated: toRevalidate });
}
