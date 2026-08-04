import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { NextResponse } from "next/server";

import type {
  CampusImpactCollection,
  CampusImpactProperties,
  CampusImpactResponse,
} from "@/types/campus-gis";

const IMPACT_LAYER =
  "https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer/0/query";
const OFFICIAL_MAP_URL = "https://maps.osu.edu/";
const CAMPUS_ENVELOPE = "-83.07,39.97,-82.98,40.04";

type ArcGisImpactProperties = {
  OBJECTID?: number;
  ConstructionID?: number;
  NAME?: string;
  NOTES?: string;
  Start_Date?: number;
  End_Date?: number;
  Comments?: string;
  Parking?: string;
  Vehicle?: string;
  Pedestrian?: string;
  Cyclist?: string;
  Event?: string;
  ImpactType?: string;
};

type ArcGisImpactCollection = FeatureCollection<
  Polygon | MultiPolygon,
  ArcGisImpactProperties
>;

export const runtime = "nodejs";

function yes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isoDate(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeFeature(
  feature: Feature<Polygon | MultiPolygon, ArcGisImpactProperties>,
): Feature<Polygon | MultiPolygon, CampusImpactProperties> | undefined {
  const properties = feature.properties;
  const id = properties.ConstructionID ?? properties.OBJECTID;
  const name = properties.NAME?.trim() || "校园施工影响";
  if (!Number.isFinite(id) || !feature.geometry) return undefined;

  const isEvent = yes(properties.Event) || properties.ImpactType === "Event";
  const affectsParking = yes(properties.Parking);
  const impactType = isEvent
    ? "event"
    : properties.ImpactType === "Other"
      ? "other"
      : "construction";

  return {
    type: "Feature",
    id,
    geometry: feature.geometry,
    properties: {
      id: id as number,
      name,
      summary:
        properties.Comments?.trim() ||
        properties.NOTES?.trim() ||
        undefined,
      startDate: isoDate(properties.Start_Date),
      endDate: isoDate(properties.End_Date),
      affectsParking,
      affectsVehicles: yes(properties.Vehicle),
      affectsPedestrians: yes(properties.Pedestrian),
      affectsCyclists: yes(properties.Cyclist),
      isEvent,
      impactType,
      impactColor: isEvent ? "#7c3aed" : affectsParking ? "#ba0c2f" : "#d97706",
      officialMapUrl: OFFICIAL_MAP_URL,
    },
  };
}

export async function GET() {
  const params = new URLSearchParams({
    where: "Publish = 'Yes'",
    outFields:
      "OBJECTID,ConstructionID,NAME,NOTES,Start_Date,End_Date,Comments,Parking,Vehicle,Pedestrian,Cyclist,Event,ImpactType",
    returnGeometry: "true",
    geometry: CAMPUS_ENVELOPE,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    outSR: "4326",
    geometryPrecision: "6",
    maxAllowableOffset: "0.000003",
    f: "geojson",
  });
  const queryUrl = `${IMPACT_LAYER}?${params}`;

  try {
    const response = await fetch(queryUrl, {
      headers: { Accept: "application/geo+json, application/json" },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`OSU GIS upstream ${response.status}`);

    const payload = (await response.json()) as ArcGisImpactCollection;
    if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
      throw new Error("Unexpected OSU GIS response");
    }

    const now = Date.now();
    const features = payload.features.flatMap((feature) => {
      const endDate = feature.properties.End_Date;
      if (typeof endDate === "number" && endDate < now) return [];
      const normalized = normalizeFeature(feature);
      return normalized ? [normalized] : [];
    });
    const data: CampusImpactCollection = {
      type: "FeatureCollection",
      features,
    };
    const body: CampusImpactResponse = {
      data,
      count: features.length,
      updatedAt: new Date().toISOString(),
      source: {
        label: "Ohio State Facilities Information and Technology Services",
        url: OFFICIAL_MAP_URL,
        queryUrl,
      },
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        data: { type: "FeatureCollection", features: [] },
        count: 0,
        updatedAt: new Date().toISOString(),
        source: {
          label: "Ohio State Facilities Information and Technology Services",
          url: OFFICIAL_MAP_URL,
          queryUrl,
        },
        error:
          error instanceof Error ? error.message : "OSU campus impacts unavailable",
      },
      { status: 502 },
    );
  }
}
