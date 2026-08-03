import {
  OSU_EV_CHARGING_SOURCE,
  PARKING_LOCATIONS,
} from "@/data/parking-locations";
import type {
  EvChargingSpeed,
  EvConnector,
  EvConnectorType,
  EvNetworkKind,
  EvStation,
  EvStationStatus,
} from "@/types/ev";

const AFDC_STATION_URL = "https://afdc.energy.gov/stations/#/station/";
const SOURCE_CHECK_DATE = "2026-08-01";

type JsonRecord = Record<string, unknown>;

export const CAMPUS_EV_SEARCH = {
  latitude: 40.0067,
  longitude: -83.0305,
  radiusMiles: 5,
} as const;

export const KNOWN_TESLA_LOCATIONS: Record<
  string,
  { locationSlug: string; siteUrl: string }
> = {
  "afdc-320148": {
    locationSlug: "18647",
    siteUrl: "https://www.tesla.com/findus/location/supercharger/18647",
  },
  "afdc-118948": {
    locationSlug: "columbusohiosupercharger",
    siteUrl:
      "https://www.tesla.com/findus/location/supercharger/columbusohiosupercharger",
  },
};

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
    case "NACS":
      return "NACS";
    case "J1772COMBO":
    case "CCS":
    case "CCS1":
      return "CCS1";
    case "CHADEMO":
      return "CHAdeMO";
    case "J1772":
      return "J1772";
    case "J3271":
    case "MCS":
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
  return Array.isArray(record.ev_charging_units)
    ? record.ev_charging_units.filter(isRecord)
    : [];
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

  const legacyTypes = Array.isArray(record.ev_connector_types)
    ? record.ev_connector_types.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  for (const rawType of legacyTypes) {
    const type = connectorType(rawType);
    if (![...aggregated.values()].some((item) => item.type === type)) {
      aggregated.set(`${type}:unknown`, { type });
    }
  }
  return [...aggregated.values()].sort(
    (left, right) =>
      (right.powerKw ?? 0) - (left.powerKw ?? 0) ||
      left.type.localeCompare(right.type),
  );
}

function extractCapacity(record: JsonRecord) {
  const detailed = chargingUnits(record).reduce(
    (sum, unit) => sum + (asPositiveInteger(unit.port_count) ?? 0),
    0,
  );
  if (detailed) return detailed;
  const legacy = [
    record.ev_level1_evse_num,
    record.ev_level2_evse_num,
    record.ev_dc_fast_num,
  ].reduce<number>(
    (sum, value) => sum + (asPositiveInteger(value) ?? 0),
    0,
  );
  return legacy || undefined;
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

function extractPublishedPricing(record: JsonRecord) {
  const published = asText(record.ev_pricing);
  if (published) return published;

  // AFDC occasionally places the operator's price notice in its official
  // directions/notes field while `ev_pricing` remains null (including OSU).
  const directions = asText(record.intersection_directions);
  if (directions && /\$\s?(?:\d+(?:\.\d+)?|\.\d+)/.test(directions)) {
    return directions.length <= 280
      ? directions
      : `${directions.slice(0, 277).trimEnd()}…`;
  }
  return undefined;
}

function normalizeStation(value: unknown): EvStation | null {
  if (!isRecord(value)) return null;
  const numericId = asPositiveInteger(value.id);
  const name = asText(value.station_name);
  const latitude = asNumber(value.latitude);
  const longitude = asNumber(value.longitude);
  const accessCode = asText(value.access_code)?.toLowerCase();
  if (
    !numericId ||
    !name ||
    latitude === undefined ||
    longitude === undefined ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    accessCode !== "public" ||
    !hasEvCharging(value)
  ) {
    return null;
  }

  const id = `afdc-${numericId}`;
  const network = asText(value.ev_network);
  const kind = networkKind(network, name);
  const connectors = extractConnectors(value);
  const chargingSpeeds = extractChargingSpeeds(value);
  const capacity = extractCapacity(value);
  const maximumPower = connectors.reduce(
    (maximum, connector) => Math.max(maximum, connector.powerKw ?? 0),
    0,
  );
  const updatedAt = asText(value.updated_at);
  const lastConfirmedAt = asText(value.date_last_confirmed);
  const networkWebsite = asHttpUrl(value.ev_network_web);
  const afdcStationUrl = `${AFDC_STATION_URL}${numericId}`;
  const teslaLocation = KNOWN_TESLA_LOCATIONS[id];
  const officialStationUrl = teslaLocation?.siteUrl ?? afdcStationUrl;
  const accessDescription = asText(value.groups_with_access_code);

  return {
    id,
    name,
    latitude,
    longitude,
    address: buildAddress(value) || undefined,
    operator: network,
    networkKind: kind,
    connectors,
    chargingSpeeds,
    capacity,
    availabilityIsRealtime: false,
    pricing: extractPublishedPricing(value),
    status: stationStatus(value.status_code),
    hours: asText(value.access_days_time),
    updatedAt,
    lastConfirmedAt,
    accessNote: [
      accessDescription,
      value.restricted_access === true
        ? "NLR 将此公开站标记为受限使用，请先确认访客或现场资格。"
        : undefined,
      "AFDC 的运营状态不等同于实时空闲端口。",
    ]
      .filter(Boolean)
      .join(" · "),
    sources: [
      {
        label:
          kind === "tesla-supercharger"
            ? "Tesla 官方站点页"
            : `AFDC 官方站点 #${numericId}`,
        url: officialStationUrl,
        checkedAt: updatedAt,
      },
      ...(networkWebsite && networkWebsite !== officialStationUrl
        ? [{ label: `${network ?? "充电网络"}官网`, url: networkWebsite }]
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
    website: officialStationUrl,
    isTesla: kind === "tesla-supercharger",
    source: "afdc",
  };
}

export function normalizeAfdcPayload(payload: unknown): EvStation[] {
  const raw =
    isRecord(payload) && Array.isArray(payload.fuel_stations)
      ? payload.fuel_stations
      : [];
  return raw
    .map(normalizeStation)
    .filter((station): station is EvStation => station !== null);
}

function distanceMiles(left: EvStation, right: EvStation) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const latitudeA = radians(left.latitude);
  const latitudeB = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    3958.8 *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function campusLevel2Stations(): EvStation[] {
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
      "Ohio State 官方双头 Level 2 充电点；另需符合停车权限并支付停车费。实时空闲和最终结算以 ChargePoint 为准。",
    sources: [
      {
        label: "Ohio State 校园充电站详情",
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

export function mergeCampusStations(stations: EvStation[]) {
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
      pricing: existing.pricing ?? campus.pricing,
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

export function mergeStationById(
  stations: EvStation[],
  enriched: EvStation,
) {
  const index = stations.findIndex((station) => station.id === enriched.id);
  if (index < 0) return [...stations, enriched];
  const next = [...stations];
  next[index] = enriched;
  return next;
}

export function latestStationUpdate(stations: EvStation[]) {
  return stations
    .map((station) => station.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => {
      const leftTime = Date.parse(left);
      const rightTime = Date.parse(right);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return right.localeCompare(left);
      }
      return rightTime - leftTime;
    })[0];
}
