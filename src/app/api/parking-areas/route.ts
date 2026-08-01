import { NextRequest, NextResponse } from "next/server";

const PARKING_LAYER =
  "https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Transportation/MapServer/0/query";
const ALLOWED_ZONES = new Set([
  "A",
  "B",
  "C",
  "CX",
  "WA",
  "WB",
  "WC",
  "WCO",
]);

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const zones = Array.from(
    new Set(
      (request.nextUrl.searchParams.get("zones") ?? "")
        .split(",")
        .map((zone) => zone.trim().toUpperCase())
        .filter((zone) => ALLOWED_ZONES.has(zone)),
    ),
  );

  if (!zones.length) {
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }

  const where = `Permit IN (${zones.map((zone) => `'${zone}'`).join(",")})`;
  const params = new URLSearchParams({
    where,
    outFields: "Name,CPNAME,Permit,Usage,VisitorPark,Link",
    returnGeometry: "true",
    geometry: "-83.065,39.975,-82.985,40.035",
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    outSR: "4326",
    geometryPrecision: "6",
    maxAllowableOffset: "0.000005",
    f: "geojson",
  });

  try {
    const response = await fetch(`${PARKING_LAYER}?${params}`, {
      headers: { Accept: "application/geo+json, application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`OSU GIS upstream ${response.status}`);

    const payload = (await response.json()) as {
      type?: string;
      features?: unknown[];
    };
    if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
      throw new Error("Unexpected OSU GIS response");
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: [],
        error: "OSU parking area layer unavailable",
      },
      { status: 502 },
    );
  }
}
