import { NextResponse } from "next/server";

import teslaChargerSnapshot from "../../../../../data-example/get-charger-details.json";
import teslaLocationSnapshot from "../../../../../data-example/get-location-details.json";

import {
  OSU_EV_CHARGING_SOURCE,
  PARKING_LOCATIONS,
} from "@/data/parking-locations";
import {
  parseTeslaWestThird,
  TESLA_WEST_THIRD_ENDPOINTS,
} from "@/lib/tesla-ev";
import type {
  EvChargingSpeed,
  EvConnector,
  EvConnectorType,
  EvNetworkKind,
  EvStation,
  EvStationsResponse,
  EvStationStatus,
} from "@/types/ev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NLR_NEAREST_URL =
  "https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json";
const AFDC_STATION_LOCATOR = "https://afdc.energy.gov/stations/";
const TESLA_WEST_THIRD =
  "https://www.tesla.com/findus/location/supercharger/18647";
const CAMPUS_CENTER = { latitude: 40.0067, longitude: -83.0305 };
const SEARCH_RADIUS_MILES = 5;
const SOURCE_CHECK_DATE = "2026-08-01";
const SUCCESS_CACHE_TTL = 60 * 60 * 1000;
const PARTIAL_FALLBACK_CACHE_TTL = 15 * 60 * 1000;
const TESLA_FETCH_TIMEOUT_MS = 12_000;

type JsonRecord = Record<string, unknown>;
type SuccessfulCacheEntry = {
  payload: EvStationsResponse;
  cachedAt: number;
};

let successfulCache: SuccessfulCacheEntry | undefined;
let refreshInFlight: Promise<EvStationsResponse> | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asPositiveInteger(value: unknown) {
  const parsed = asNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : undefined;
}

function asHttpUrl(value: unknown) {
  const text = asText(value);
  if (!text) return undefined;

  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function connectorType(value: string): EvConnectorType {
  switch (value.toUpperCase()) {
    case "TESLA":
      return "NACS";
    case "J1772COMBO":
      return "CCS1";
    case "CHADEMO":
      return "CHAdeMO";
    case "J1772":
      return "J1772";
    case "J3271":
      return "MCS";
    default:
      return "other";
  }
}

function networkKind(network: string | undefined, name: string): EvNetworkKind {
  const haystack = `${network ?? ""} ${name}`.toLowerCase();
  if (network?.toLowerCase() === "tesla" || haystack.includes("supercharger")) {
    return "tesla-supercharger";
  }
  if (haystack.includes("chargepoint")) return "chargepoint";
  if (haystack.includes("electrify america")) return "electrify-america";
  if (haystack.includes("evgo")) return "evgo";
  return "other";
}

function stationStatus(value: unknown): EvStationStatus {
  switch (asText(value)?.toUpperCase()) {
    case "E":
      return "operational";
    case "T":
      return "temporarily-unavailable";
    case "P":
      return "planned";
    default:
      return "unknown";
  }
}

function chargingUnits(record: JsonRecord) {
  if (!Array.isArray(record.ev_charging_units)) return [];
  return record.ev_charging_units.filter(
    (unit): unit is JsonRecord => isRecord(unit),
  );
}

function hasEvCharging(record: JsonRecord) {
  if (
    [
      record.ev_level1_evse_num,
      record.ev_level2_evse_num,
      record.ev_dc_fast_num,
    ].some((value) => (asPositiveInteger(value) ?? 0) > 0)
  ) {
    return true;
  }

  return chargingUnits(record).some((unit) => {
    if ((asPositiveInteger(unit.port_count) ?? 0) > 0) return true;
    if (!isRecord(unit.connectors)) return false;
    return Object.values(unit.connectors).some(
      (details) =>
        isRecord(details) && (asPositiveInteger(details.port_count) ?? 0) > 0,
    );
  });
}

function extractConnectors(record: JsonRecord): EvConnector[] {
  const aggregated = new Map<string, EvConnector>();

  for (const unit of chargingUnits(record)) {
    if (!isRecord(unit.connectors)) continue;

    for (const [rawType, details] of Object.entries(unit.connectors)) {
      if (!isRecord(details)) continue;
      const count = asPositiveInteger(details.port_count);
      if (!count) continue;

      const type = connectorType(rawType);
      const powerKw = asNumber(details.power_kw);
      const key = `${type}:${powerKw ?? "unknown"}`;
      const previous = aggregated.get(key);
      aggregated.set(key, {
        type,
        count: (previous?.count ?? 0) + count,
        ...(powerKw !== undefined && powerKw > 0 ? { powerKw } : {}),
      });
    }
  }

  const legacyConnectorTypes = Array.isArray(record.ev_connector_types)
    ? record.ev_connector_types.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  for (const rawType of legacyConnectorTypes) {
    const type = connectorType(rawType);
    if (![...aggregated.values()].some((connector) => connector.type === type)) {
      aggregated.set(`${type}:unknown`, { type });
    }
  }

  return [...aggregated.values()].sort((a, b) => {
    const powerDifference = (b.powerKw ?? 0) - (a.powerKw ?? 0);
    return powerDifference || a.type.localeCompare(b.type);
  });
}

function extractCapacity(record: JsonRecord) {
  const detailedCount = chargingUnits(record).reduce(
    (sum, unit) => sum + (asPositiveInteger(unit.port_count) ?? 0),
    0,
  );
  if (detailedCount) return detailedCount;

  const legacyCount = [
    record.ev_level1_evse_num,
    record.ev_level2_evse_num,
    record.ev_dc_fast_num,
  ].reduce<number>(
    (sum, value) => sum + (asPositiveInteger(value) ?? 0),
    0,
  );
  return legacyCount || undefined;
}

function extractChargingSpeeds(record: JsonRecord): EvChargingSpeed[] {
  const speeds = new Set<EvChargingSpeed>();

  if ((asPositiveInteger(record.ev_level1_evse_num) ?? 0) > 0) {
    speeds.add("level-1");
  }
  if ((asPositiveInteger(record.ev_level2_evse_num) ?? 0) > 0) {
    speeds.add("level-2");
  }
  if ((asPositiveInteger(record.ev_dc_fast_num) ?? 0) > 0) {
    speeds.add("dc-fast");
  }

  for (const unit of chargingUnits(record)) {
    switch (asText(unit.charging_level)?.toLowerCase()) {
      case "level_1":
        speeds.add("level-1");
        break;
      case "level_2":
        speeds.add("level-2");
        break;
      case "dc_fast":
        speeds.add("dc-fast");
        break;
    }
  }

  return speeds.size ? [...speeds] : ["unknown"];
}

function buildAddress(record: JsonRecord) {
  const locality = [asText(record.city), asText(record.state)]
    .filter(Boolean)
    .join(", ");
  return [asText(record.street_address), locality, asText(record.zip)]
    .filter(Boolean)
    .join(" ");
}

function normalizeStation(value: unknown): EvStation | null {
  if (!isRecord(value)) return null;

  const id = asPositiveInteger(value.id);
  const name = asText(value.station_name);
  const latitude = asNumber(value.latitude);
  const longitude = asNumber(value.longitude);
  const accessCode = asText(value.access_code)?.toLowerCase();

  if (
    !id ||
    !name ||
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accessCode !== "public" ||
    value.restricted_access === true ||
    !hasEvCharging(value)
  ) {
    return null;
  }

  const network = asText(value.ev_network);
  const kind = networkKind(network, name);
  const connectors = extractConnectors(value);
  const chargingSpeeds = extractChargingSpeeds(value);
  const capacity = extractCapacity(value);
  const maximumPower = connectors.reduce(
    (maximum, connector) => Math.max(maximum, connector.powerKw ?? 0),
    0,
  );
  const website = asHttpUrl(value.ev_network_web);
  const updatedAt = asText(value.updated_at);
  const lastConfirmedAt = asText(value.date_last_confirmed);
  const accessDescription = asText(value.groups_with_access_code);
  const isKnownTeslaWestThird = id === 320148;
  const isKnownOsuCar = id === 98595;
  const officialWebsite = isKnownTeslaWestThird
    ? TESLA_WEST_THIRD
    : website ?? AFDC_STATION_LOCATOR;

  return {
    id: `afdc-${id}`,
    name,
    latitude,
    longitude,
    address: buildAddress(value) || undefined,
    operator: network,
    networkKind: kind,
    connectors,
    chargingSpeeds,
    capacity,
    // AFDC's status is an operating status, not live per-port availability.
    availabilityIsRealtime: false,
    pricing: isKnownOsuCar
      ? "$0.50/kWh（Ohio State，自 2026-03-02）"
      : asText(value.ev_pricing),
    status: stationStatus(value.status_code),
    hours: asText(value.access_days_time),
    updatedAt,
    lastConfirmedAt,
    accessNote: [
      accessDescription,
      "AFDC 的站点状态不代表实时空闲端口。",
    ]
      .filter(Boolean)
      .join(" · "),
    sources: [
      {
        label: `AFDC 站点 #${id}`,
        url: AFDC_STATION_LOCATOR,
        checkedAt: updatedAt,
      },
      ...(website && website !== AFDC_STATION_LOCATOR
        ? [{ label: `${network ?? "充电网络"}官网`, url: website }]
        : []),
      ...(isKnownTeslaWestThird
        ? [
            {
              label: "Tesla 官方站点页",
              url: TESLA_WEST_THIRD,
              checkedAt: SOURCE_CHECK_DATE,
            },
          ]
        : []),
      ...(isKnownOsuCar
        ? [
            {
              label: "Ohio State TTM 充电站说明",
              url: OSU_EV_CHARGING_SOURCE,
              checkedAt: SOURCE_CHECK_DATE,
            },
          ]
        : []),
    ],
    openingHours: asText(value.access_days_time),
    power:
      maximumPower > 0
        ? `最高 ${maximumPower} kW`
        : chargingSpeeds.includes("dc-fast")
          ? "DC 快充"
          : chargingSpeeds.includes("level-2")
            ? "Level 2"
            : "功率未公布",
    website: officialWebsite,
    isTesla: kind === "tesla-supercharger",
    source: "afdc",
  };
}

function staticTeslaStation() {
  return parseTeslaWestThird(
    teslaChargerSnapshot,
    teslaLocationSnapshot,
    "static-snapshot",
    `${SOURCE_CHECK_DATE}T00:00:00-04:00`,
  );
}

function campusLevel2Stations(): EvStation[] {
  return PARKING_LOCATIONS.filter(
    (location) => location.hasEvCharging && location.evCharging,
  ).map((location) => ({
    id: `osu-level2-${location.garageId}`,
    name: `Ohio State · ${location.name} Level 2`,
    latitude: location.coordinates[1],
    longitude: location.coordinates[0],
    address: location.address,
    operator: "ChargePoint / Ohio State",
    networkKind: "chargepoint" as const,
    connectors: [{ type: "J1772" as const, count: 2 }],
    chargingSpeeds: ["level-2" as const],
    capacity: 2,
    availabilityIsRealtime: false,
    pricing: "$0.50/kWh（Ohio State，自 2026-03-02）",
    status: "operational" as const,
    updatedAt: SOURCE_CHECK_DATE,
    lastConfirmedAt: SOURCE_CHECK_DATE,
    accessNote:
      "Ohio State 官方列出的双头 Level 2 充电点；另需符合停车权限并支付相应停车费。官方页面仍含旧费率段，实际结算以 ChargePoint 为准；未公开实时空闲端口。",
    sources: [
      {
        label: "Ohio State TTM 校园充电站说明",
        url: OSU_EV_CHARGING_SOURCE,
        checkedAt: SOURCE_CHECK_DATE,
      },
    ],
    campusLocation: {
      garageId: location.garageId,
      name: location.name,
    },
    openingHours: "随停车设施开放",
    power: "Level 2（双头）",
    website: OSU_EV_CHARGING_SOURCE,
    isTesla: false,
    source: "campus" as const,
  }));
}

function osuCarFastStation(): EvStation {
  return {
    id: "osu-car-dc-fast",
    name: "Ohio State · CAR DC Fast Charger",
    latitude: 39.9982657,
    longitude: -83.0327743,
    address:
      "Center for Automotive Research · 930 Kinnear Rd, Columbus, OH 43212",
    operator: "The Ohio State University",
    networkKind: "other",
    connectors: [{ type: "other", count: 1 }],
    chargingSpeeds: ["dc-fast"],
    capacity: 1,
    availabilityIsRealtime: false,
    pricing: "$0.50/kWh（自 2026-03-02）",
    status: "operational",
    updatedAt: SOURCE_CHECK_DATE,
    lastConfirmedAt: SOURCE_CHECK_DATE,
    accessNote:
      "官方未公开接口类型、功率或实时空闲状态；以现场停车权限和标识为准。",
    sources: [
      {
        label: "Ohio State TTM 充电站说明",
        url: OSU_EV_CHARGING_SOURCE,
        checkedAt: SOURCE_CHECK_DATE,
      },
    ],
    power: "DC 快充（官方未公布功率）",
    website: OSU_EV_CHARGING_SOURCE,
    isTesla: false,
    source: "fallback",
  };
}

function distanceMiles(left: EvStation, right: EvStation) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const latitudeA = toRadians(left.latitude);
  const latitudeB = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    earthRadiusMiles *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function mergeCampusStations(stations: EvStation[]) {
  return campusLevel2Stations().reduce((merged, campus) => {
    const existingIndex = merged.findIndex(
      (station) =>
        station.networkKind === "chargepoint" &&
        distanceMiles(station, campus) <= 0.08,
    );
    if (existingIndex < 0) return [...merged, campus];

    const existing = merged[existingIndex];
    const next = [...merged];
    next[existingIndex] = {
      ...existing,
      campusLocation: campus.campusLocation,
      sources: [
        ...existing.sources,
        ...campus.sources.filter(
          (source) =>
            !existing.sources.some((current) => current.url === source.url),
        ),
      ],
      accessNote: [existing.accessNote, campus.accessNote]
        .filter(Boolean)
        .join(" · "),
    };
    return next;
  }, stations);
}

function mergeTeslaStation(stations: EvStation[], tesla: EvStation) {
  return [
    ...stations.filter(
      (station) =>
        station.networkKind !== "tesla-supercharger" ||
        distanceMiles(station, tesla) > 0.35,
    ),
    tesla,
  ];
}

function fallbackStations(): EvStation[] {
  return mergeCampusStations([staticTeslaStation(), osuCarFastStation()]);
}

function latestSourceUpdate(stations: EvStation[]) {
  return stations
    .map((station) => station.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => {
      const aTime = Date.parse(a);
      const bTime = Date.parse(b);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) return b.localeCompare(a);
      return bTime - aTime;
    })[0];
}

function dataResponse(
  payload: EvStationsResponse,
  state: "fresh" | "memory-cache" | "stale" | "fallback",
  cacheControl: string,
) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": cacheControl,
      "X-EV-Data-State": state,
    },
  });
}

function fallbackResponse(reason?: string) {
  const stations = fallbackStations();
  const payload: EvStationsResponse = {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestSourceUpdate(stations),
    isFallback: true,
    warning:
      reason ??
      "NLR/AFDC 暂不可用，当前显示 Ohio State 官方地点资料与用户提供的 Tesla 官方接口快照，均非实时。",
  };

  return dataResponse(
    payload,
    "fallback",
    "public, s-maxage=300, stale-while-revalidate=900",
  );
}

async function fetchAfdcStations(apiKey: string): Promise<EvStation[]> {
  const url = new URL(NLR_NEAREST_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("latitude", String(CAMPUS_CENTER.latitude));
  url.searchParams.set("longitude", String(CAMPUS_CENTER.longitude));
  url.searchParams.set("radius", String(SEARCH_RADIUS_MILES));
  url.searchParams.set("fuel_type", "ELEC");
  url.searchParams.set("access", "public");
  url.searchParams.set("status", "E");
  url.searchParams.set("country", "US");
  url.searchParams.set("limit", "200");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`NLR/AFDC 请求失败（${response.status}）`);
  }

  const payload: unknown = await response.json();
  const rawStations =
    isRecord(payload) && Array.isArray(payload.fuel_stations)
      ? payload.fuel_stations
      : [];
  const stations = rawStations
    .map(normalizeStation)
    .filter((station): station is EvStation => station !== null);

  if (!stations.length) {
    throw new Error("NLR/AFDC 未返回校园附近的公开充电站");
  }

  return stations;
}

async function fetchTeslaStation() {
  const headers = {
    Accept: "application/json, text/plain, */*",
    Referer: TESLA_WEST_THIRD,
    "User-Agent":
      "Mozilla/5.0 (compatible; BuckeyeParking/1.0; +https://www.tesla.com/findus)",
  };
  const [chargerResponse, locationResponse] = await Promise.all([
    fetch(TESLA_WEST_THIRD_ENDPOINTS.chargerDetails, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(TESLA_FETCH_TIMEOUT_MS),
    }),
    fetch(TESLA_WEST_THIRD_ENDPOINTS.locationDetails, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(TESLA_FETCH_TIMEOUT_MS),
    }),
  ]);

  if (!chargerResponse.ok || !locationResponse.ok) {
    throw new Error(
      `Tesla 官方接口请求失败（充电 ${chargerResponse.status} / 位置 ${locationResponse.status}）`,
    );
  }

  const [chargerPayload, locationPayload]: [unknown, unknown] =
    await Promise.all([chargerResponse.json(), locationResponse.json()]);
  return parseTeslaWestThird(
    chargerPayload,
    locationPayload,
    "live",
    new Date().toISOString(),
  );
}

async function fetchFreshStations(apiKey: string): Promise<EvStationsResponse> {
  const [afdcResult, teslaResult] = await Promise.all([
    fetchAfdcStations(apiKey)
      .then((stations) => ({ stations, error: undefined }))
      .catch((reason: unknown) => ({
        stations: [] as EvStation[],
        error:
          reason instanceof Error ? reason.message : "NLR/AFDC 暂不可用",
      })),
    fetchTeslaStation()
      .then((station) => ({ station, error: undefined }))
      .catch((reason: unknown) => ({
        station: staticTeslaStation(),
        error:
          reason instanceof Error
            ? reason.message
            : "Tesla 官方接口暂不可用",
      })),
  ]);
  const publicStations = afdcResult.stations.length
    ? afdcResult.stations
    : [osuCarFastStation()];
  const stations = mergeCampusStations(
    mergeTeslaStation(publicStations, teslaResult.station),
  );
  const warnings = [
    afdcResult.error
      ? `${afdcResult.error}；附近第三方站点暂以 Ohio State 官方清单补位`
      : undefined,
    teslaResult.error
      ? `${teslaResult.error}；Tesla 当前显示用户提供的官方接口快照，价格与拥挤度已明确标为非实时`
      : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestSourceUpdate(stations),
    isFallback: warnings.length > 0,
    ...(warnings.length ? { warning: `${warnings.join("；")}。` } : {}),
  };
}

function refreshStations(apiKey: string) {
  if (!refreshInFlight) {
    refreshInFlight = fetchFreshStations(apiKey)
      .then((payload) => {
        successfulCache = { payload, cachedAt: Date.now() };
        return payload;
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

export async function GET() {
  const now = Date.now();
  const cacheTtl = successfulCache?.payload.isFallback
    ? PARTIAL_FALLBACK_CACHE_TTL
    : SUCCESS_CACHE_TTL;
  if (successfulCache && now - successfulCache.cachedAt < cacheTtl) {
    return dataResponse(
      successfulCache.payload,
      successfulCache.payload.isFallback ? "fallback" : "memory-cache",
      successfulCache.payload.isFallback
        ? "public, s-maxage=300, stale-while-revalidate=900"
        : "public, s-maxage=3600, stale-while-revalidate=21600",
    );
  }

  const apiKey =
    process.env.NLR_API_KEY ?? process.env.NREL_API_KEY ?? "DEMO_KEY";

  try {
    const payload = await refreshStations(apiKey);
    return dataResponse(
      payload,
      payload.isFallback ? "fallback" : "fresh",
      payload.isFallback
        ? "public, s-maxage=300, stale-while-revalidate=900"
        : "public, s-maxage=3600, stale-while-revalidate=21600",
    );
  } catch (reason: unknown) {
    const message =
      reason instanceof Error ? reason.message : "NLR/AFDC 暂不可用";

    if (successfulCache) {
      const cachedAt = new Date(successfulCache.cachedAt).toLocaleString(
        "zh-CN",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "America/New_York",
        },
      );
      return dataResponse(
        {
          ...successfulCache.payload,
          generatedAt: new Date().toISOString(),
          warning: `${message}，当前显示 ${cachedAt} ET 获取的 AFDC 缓存；实时空闲与价格请以运营商应用为准。`,
        },
        "stale",
        "public, s-maxage=300, stale-while-revalidate=900",
      );
    }

    return fallbackResponse(
      `${message}，当前显示 Ohio State 官方地点资料与用户提供的 Tesla 官方接口快照，均非实时。`,
    );
  }
}
