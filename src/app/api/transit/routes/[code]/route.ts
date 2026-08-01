import { NextRequest, NextResponse } from "next/server";

const CABS_API_BASE =
  process.env.CABS_API_BASE ?? "https://content.osu.edu/v2/bus";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await context.params;
  const code = rawCode.toUpperCase();

  if (!/^[A-Z0-9]{1,8}$/.test(code)) {
    return NextResponse.json({ error: "Invalid route code" }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${CABS_API_BASE}/routes/${encodeURIComponent(code)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`CABS upstream ${response.status}`);
    const payload = (await response.json()) as {
      lastModified?: string;
      data?: { patterns?: unknown[]; stops?: unknown[] };
    };

    return NextResponse.json(
      {
        code,
        patterns: Array.isArray(payload.data?.patterns)
          ? payload.data.patterns
          : [],
        stops: Array.isArray(payload.data?.stops) ? payload.data.stops : [],
        lastModified: payload.lastModified,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "CABS route detail unavailable" },
      { status: 502 },
    );
  }
}
