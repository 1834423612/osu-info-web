import { NextResponse } from "next/server";

import type {
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
const OSU_EV_CHARGING =
  "https://ttm.osu.edu/other-transit-and-services/electric-charging-stations";
const CAMPUS_CENTER = { latitude: 40.0067, longitude: -83.0305 };
const SEARCH_RADIUS_MILES = 5;
const SOURCE_CHECK_DATE = "2026-08-01";
const SUCCESS_CACHE_TTL = 60 * 60 * 1000;

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

function dcFastUnits(record: JsonRecord) {
  if (!Array.isArray(record.ev_charging_units)) return [];
  return record.ev_charging_units.filter(
    (unit): unit is JsonRecord =>
      isRecord(unit) && asText(unit.charging_level)?.toLowerCase() === "dc_fast",
  );
}

function hasDcFastCharging(record: JsonRecord) {
  if ((asPositiveInteger(record.ev_dc_fast_num) ?? 0) > 0) return true;

  return dcFastUnits(record).some((unit) => {
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

  for (const unit of dcFastUnits(record)) {
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

  // These AFDC connector codes can carry DC power. AC-only connectors are not
  // shown in a result explicitly requested as a DC-fast station.
  const dcConnectorCodes = new Set([
    "TESLA",
    "J1772COMBO",
    "CHADEMO",
    "J3271",
  ]);

  for (const rawType of legacyConnectorTypes) {
    if (!dcConnectorCodes.has(rawType.toUpperCase())) continue;
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
  const legacyCount = asPositiveInteger(record.ev_dc_fast_num);
  if (legacyCount) return legacyCount;

  const detailedCount = dcFastUnits(record).reduce(
    (sum, unit) => sum + (asPositiveInteger(unit.port_count) ?? 0),
    0,
  );
  return detailedCount || undefined;
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
    !hasDcFastCharging(value)
  ) {
    return null;
  }

  const network = asText(value.ev_network);
  const kind = networkKind(network, name);
  const connectors = extractConnectors(value);
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
              url: OSU_EV_CHARGING,
              checkedAt: SOURCE_CHECK_DATE,
            },
          ]
        : []),
    ],
    openingHours: asText(value.access_days_time),
    power: maximumPower > 0 ? `最高 ${maximumPower} kW` : "DC 快充",
    website: officialWebsite,
    isTesla: kind === "tesla-supercharger",
    source: "afdc",
  };
}

function fallbackStations(): EvStation[] {
  return [
    {
      id: "tesla-supercharger-18647",
      name: "Tesla Supercharger · Columbus – West 3rd Avenue",
      latitude: 39.9859,
      longitude: -83.0252,
      address: "GetGo Café + Market · 820 W 3rd Ave, Columbus, OH 43212",
      operator: "Tesla",
      networkKind: "tesla-supercharger",
      connectors: [{ type: "NACS", count: 8, powerKw: 250 }],
      capacity: 8,
      availabilityIsRealtime: false,
      pricing: "请在 Tesla App 查看实时价格",
      status: "operational",
      hours: "24/7",
      updatedAt: SOURCE_CHECK_DATE,
      lastConfirmedAt: SOURCE_CHECK_DATE,
      accessNote:
        "非 Tesla 车辆需要 NACS 适配器；实时空闲与价格以 Tesla App 和现场信息为准。",
      sources: [
        {
          label: "Tesla 官方站点页",
          url: TESLA_WEST_THIRD,
          checkedAt: SOURCE_CHECK_DATE,
        },
      ],
      openingHours: "24/7",
      power: "最高 250 kW",
      website: TESLA_WEST_THIRD,
      isTesla: true,
      source: "fallback",
    },
    {
      id: "osu-car-dc-fast",
      name: "Ohio State · CAR DC Fast Charger",
      latitude: 39.9982657,
      longitude: -83.0327743,
      address:
        "Center for Automotive Research · 930 Kinnear Rd, Columbus, OH 43212",
      operator: "The Ohio State University",
      networkKind: "other",
      connectors: [{ type: "other", count: 1 }],
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
          url: OSU_EV_CHARGING,
          checkedAt: SOURCE_CHECK_DATE,
        },
      ],
      power: "DC 快充（官方未公布功率）",
      website: OSU_EV_CHARGING,
      isTesla: false,
      source: "fallback",
    },
  ];
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
      "NLR/AFDC 暂不可用，当前显示经官方页面核对的非实时备用数据。",
  };

  return dataResponse(
    payload,
    "fallback",
    "public, s-maxage=300, stale-while-revalidate=900",
  );
}

async function fetchFreshStations(apiKey: string): Promise<EvStationsResponse> {
  const url = new URL(NLR_NEAREST_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("latitude", String(CAMPUS_CENTER.latitude));
  url.searchParams.set("longitude", String(CAMPUS_CENTER.longitude));
  url.searchParams.set("radius", String(SEARCH_RADIUS_MILES));
  url.searchParams.set("fuel_type", "ELEC");
  url.searchParams.set("access", "public");
  url.searchParams.set("status", "E");
  url.searchParams.set("ev_charging_level", "dc_fast");
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
    throw new Error("NLR/AFDC 未返回校园附近的公开 DC 快充");
  }

  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestSourceUpdate(stations),
    isFallback: false,
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
  if (successfulCache && now - successfulCache.cachedAt < SUCCESS_CACHE_TTL) {
    return dataResponse(
      successfulCache.payload,
      "memory-cache",
      "public, s-maxage=3600, stale-while-revalidate=21600",
    );
  }

  const apiKey =
    process.env.NLR_API_KEY ?? process.env.NREL_API_KEY ?? "DEMO_KEY";

  try {
    const payload = await refreshStations(apiKey);
    return dataResponse(
      payload,
      "fresh",
      "public, s-maxage=3600, stale-while-revalidate=21600",
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
      `${message}，当前显示经官方页面核对的非实时备用数据。`,
    );
  }
}
