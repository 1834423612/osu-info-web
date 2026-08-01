import { NextResponse } from "next/server";

const CABS_API_BASE =
  process.env.CABS_API_BASE ?? "https://content.osu.edu/v2/bus";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetch(`${CABS_API_BASE}/routes`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`CABS upstream ${response.status}`);

    const payload = (await response.json()) as {
      lastModified?: string;
      data?: { routes?: unknown[] };
    };

    return NextResponse.json(
      {
        routes: Array.isArray(payload.data?.routes) ? payload.data.routes : [],
        lastModified: payload.lastModified,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { routes: [], error: "CABS route feed unavailable" },
      { status: 502 },
    );
  }
}
