import { NextRequest, NextResponse } from "next/server";

const CABS_API_BASE =
  process.env.CABS_API_BASE ?? "https://content.osu.edu/v2/bus";
const MAX_ROUTES = 10;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VehiclePayload = {
  lastModified?: string;
  data?: { vehicles?: unknown[] };
};

function normalizeUpdated(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return value;
  const asString = String(value);
  if (/^\d{10,13}$/.test(asString)) {
    const milliseconds =
      asString.length === 10 ? Number(asString) * 1000 : Number(asString);
    return new Date(milliseconds).toISOString();
  }
  return value;
}

export async function GET(request: NextRequest) {
  const routes = Array.from(
    new Set(
      (request.nextUrl.searchParams.get("routes") ?? "")
        .split(",")
        .map((route) => route.trim().toUpperCase())
        .filter((route) => /^[A-Z0-9]{1,8}$/.test(route)),
    ),
  ).slice(0, MAX_ROUTES);

  if (!routes.length) {
    return NextResponse.json({ vehicles: [] });
  }

  const results = await Promise.allSettled(
    routes.map(async (code) => {
      const response = await fetch(
        `${CABS_API_BASE}/routes/${encodeURIComponent(code)}/vehicles`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) throw new Error(`${code}: ${response.status}`);
      return (await response.json()) as VehiclePayload;
    }),
  );

  const vehicles = results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const feedVehicles = result.value.data?.vehicles;
    if (!Array.isArray(feedVehicles)) return [];
    return feedVehicles.map((vehicle) => {
      if (typeof vehicle !== "object" || vehicle === null) return vehicle;
      const record = vehicle as Record<string, unknown>;
      return { ...record, updated: normalizeUpdated(record.updated) };
    });
  });

  const lastModified = results
    .flatMap((result) =>
      result.status === "fulfilled" && result.value.lastModified
        ? [result.value.lastModified]
        : [],
    )
    .sort()
    .at(-1);

  return NextResponse.json(
    { vehicles, lastModified },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
      },
    },
  );
}
