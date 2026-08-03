import teslaChargerSnapshot from "../../data/tesla-snapshots/18647/get-charger-details.json";
import teslaLocationSnapshot from "../../data/tesla-snapshots/18647/get-location-details.json";

import { KNOWN_TESLA_LOCATIONS } from "@/lib/ev-stations";
import { parseTeslaStation, teslaDetailsEndpoints } from "@/lib/tesla-ev";
import type { EvStation } from "@/types/ev";

type SnapshotEnvelope = {
  _snapshot?: {
    capturedAt?: unknown;
    locationSlug?: unknown;
    sourceUrl?: unknown;
  };
  data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function snapshotMetadata(
  payload: SnapshotEnvelope,
  fileLabel: string,
  expectedSourceUrl: string,
) {
  const capturedAt = payload._snapshot?.capturedAt;
  const locationSlug = payload._snapshot?.locationSlug;
  const sourceUrl = payload._snapshot?.sourceUrl;
  if (
    typeof capturedAt !== "string" ||
    Number.isNaN(Date.parse(capturedAt))
  ) {
    throw new Error(`${fileLabel} 缺少有效的 _snapshot.capturedAt`);
  }
  if (locationSlug !== "18647") {
    throw new Error(`${fileLabel} 的 _snapshot.locationSlug 必须为 18647`);
  }
  if (sourceUrl !== expectedSourceUrl) {
    throw new Error(`${fileLabel} 的 _snapshot.sourceUrl 不是预期官方 GET`);
  }
  return { capturedAt, locationSlug, sourceUrl };
}

const expectedEndpoints = teslaDetailsEndpoints("18647");

const chargerMetadata = snapshotMetadata(
  teslaChargerSnapshot,
  "Tesla charger 快照",
  expectedEndpoints.chargerDetails,
);
const locationMetadata = snapshotMetadata(
  teslaLocationSnapshot,
  "Tesla location 快照",
  expectedEndpoints.locationDetails,
);

if (chargerMetadata.capturedAt !== locationMetadata.capturedAt) {
  throw new Error("Tesla 两份快照的 _snapshot.capturedAt 不一致，请同时更新");
}

const chargerData = asRecord(asRecord(teslaChargerSnapshot.data)?.data);
const availability = asRecord(chargerData?.availabilityProfile);
const chargerIdentity = asRecord(availability?.trtId)?.id;
const locationData = asRecord(teslaLocationSnapshot.data);
const locationIdentity = asRecord(locationData?.marketing)?.location_url_slug;
if (chargerIdentity !== 18647 || locationIdentity !== "18647") {
  throw new Error("Tesla 快照响应内容并非 West 3rd 站点 18647");
}

export const TESLA_SNAPSHOT_CHECKED_AT = chargerMetadata.capturedAt;

export function teslaWestThirdSnapshot(baseStation?: EvStation) {
  const identity = KNOWN_TESLA_LOCATIONS["afdc-320148"];
  return parseTeslaStation(
    teslaChargerSnapshot,
    teslaLocationSnapshot,
    "static-snapshot",
    TESLA_SNAPSHOT_CHECKED_AT,
    { ...identity, baseStation },
  );
}
