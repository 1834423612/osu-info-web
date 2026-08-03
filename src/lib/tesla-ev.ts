import type {
  EvPricePeriod,
  EvStation,
  EvStationStatus,
  EvTeslaDataState,
  EvTeslaPriceAudience,
} from "@/types/ev";

const TESLA_WEST_THIRD_LOCATION_SLUG = "18647";
const TESLA_WEST_THIRD_SITE_URL =
  "https://www.tesla.com/findus/location/supercharger/18647";

type JsonRecord = Record<string, unknown>;

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const AMENITY_LABELS: Record<string, string> = {
  AMENITIES_RESTROOMS: "洗手间",
  AMENITIES_CAFE: "咖啡",
  AMENITIES_RESTAURANT: "餐饮",
  AMENITIES_TWENTY_FOUR_HOUR: "24 小时服务",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
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
  const number = asNumber(value);
  return number !== undefined && number > 0 ? Math.round(number) : undefined;
}

function nestedRecord(root: unknown, keys: readonly string[]) {
  let cursor: unknown = root;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (!record) return undefined;
    cursor = record[key];
  }
  return asRecord(cursor);
}

function validTime(value: unknown) {
  const text = asText(value);
  return text && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)
    ? text
    : undefined;
}

function priceUnit(value: unknown) {
  const unit = asText(value)?.toLowerCase();
  if (unit === "kwh") return "kWh";
  if (unit === "min") return "minute";
  return unit ?? "kWh";
}

function parseDays(value: unknown) {
  const text = asText(value);
  if (!text) return [];
  return [...new Set(text.split(",").map(Number))].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
}

function timeSortValue(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function parsePricePeriod(record: JsonRecord): EvPricePeriod | undefined {
  const rate = asNumber(record.rateBase);
  if (rate === undefined || rate < 0) return undefined;

  return {
    startTime: validTime(record.startTime) ?? "00:00",
    endTime: validTime(record.endTime) ?? "00:00",
    days: parseDays(record.days),
    rate,
    currencyCode: asText(record.currencyCode) ?? "USD",
    unit: priceUnit(record.uom),
  };
}

function parsePricebooks(value: unknown): EvTeslaPriceAudience[] {
  const records = Array.isArray(value) ? value.filter(isRecord) : [];

  return (["tesla-member", "non-tesla"] as const).flatMap((audience) => {
    const isMember = audience === "tesla-member";
    const matching = records.filter((record) => {
      if (typeof record.isMemberPricebook === "boolean") {
        return record.isMemberPricebook === isMember;
      }
      return (asText(record.vehicleMakeType) === "TSLA") === isMember;
    });
    if (!matching.length) return [];

    const charging = matching.filter(
      (record) => asText(record.feeType)?.toUpperCase() === "CHARGING",
    );
    const periods = charging
      .filter((record) => record.isTou === true)
      .map(parsePricePeriod)
      .filter((period): period is EvPricePeriod => Boolean(period))
      .sort(
        (left, right) =>
          timeSortValue(left.startTime) - timeSortValue(right.startTime),
      );
    const baseRate = charging
      .filter((record) => record.isTou !== true)
      .map((record) => asNumber(record.rateBase))
      .find((rate): rate is number => rate !== undefined && rate >= 0);
    const congestionFee = matching
      .filter(
        (record) => asText(record.feeType)?.toUpperCase() === "CONGESTION",
      )
      .map(parsePricePeriod)
      .find((period): period is EvPricePeriod => Boolean(period));

    return [
      {
        audience,
        ...(baseRate !== undefined ? { baseRate } : {}),
        periods,
        ...(congestionFee ? { congestionFee } : {}),
      },
    ];
  });
}

function parseCongestion(value: unknown) {
  const profile: NonNullable<
    EvStation["teslaDetails"]
  >["congestionByDay"] = {};
  const record = asRecord(value);
  if (!record) return profile;

  for (const day of DAY_NAMES) {
    const dayRecord = asRecord(record[day]);
    const rawValues = dayRecord?.congestionValue;
    if (!Array.isArray(rawValues)) continue;
    const values = rawValues
      .map(asNumber)
      .filter((entry): entry is number => entry !== undefined)
      .slice(0, 24)
      .map((entry) => Math.max(0, Math.min(1, entry)));
    if (values.length === 24) profile[day] = values;
  }
  return profile;
}

function mapTeslaStatus(value: unknown): EvStationStatus {
  switch (asText(value)?.toLowerCase()) {
    case "open":
      return "operational";
    case "closed temporarily":
    case "temporarily closed":
      return "temporarily-unavailable";
    case "coming soon":
      return "planned";
    default:
      return "unknown";
  }
}

function formatPricingSummary(pricing: EvTeslaPriceAudience[]) {
  const rates = pricing.flatMap((group) => [
    ...(group.baseRate !== undefined ? [group.baseRate] : []),
    ...group.periods.map((period) => period.rate),
  ]);
  if (!rates.length) return "Tesla 官方未返回当前分时价格";
  const minimum = Math.min(...rates);
  const maximum = Math.max(...rates);
  return minimum === maximum
    ? `$${minimum.toFixed(2)}/kWh`
    : `$${minimum.toFixed(2)}–$${maximum.toFixed(2)}/kWh（分时）`;
}

function buildAddress(record: JsonRecord | undefined) {
  if (!record) return undefined;
  const formatted = record.formatted_address;
  if (Array.isArray(formatted)) {
    const lines = formatted.filter(
      (line): line is string => typeof line === "string" && Boolean(line.trim()),
    );
    if (lines.length) return lines.join(", ");
  }
  return [
    asText(record.address_1),
    [asText(record.city), asText(record.state_province)]
      .filter(Boolean)
      .join(", "),
    asText(record.postal_code),
  ]
    .filter(Boolean)
    .join(" ");
}

export type TeslaStationIdentity = {
  locationSlug: string;
  siteUrl: string;
  baseStation?: EvStation;
};

export function teslaDetailsEndpoints(locationSlug: string) {
  const encodedSlug = encodeURIComponent(locationSlug);
  return {
    chargerDetails:
      `https://www.tesla.com/api/findus/get-charger-details?locationSlug=${encodedSlug}` +
      "&programType=supercharger&locale=en-US&isInHkMoTw=false",
    locationDetails:
      `https://www.tesla.com/api/findus/get-location-details?locationSlug=${encodedSlug}` +
      "&functionTypes=nacs&locale=en_US&isInHkMoTw=false",
  } as const;
}

export function parseTeslaStation(
  chargerPayload: unknown,
  locationPayload: unknown,
  dataState: EvTeslaDataState,
  fetchedAt: string,
  identity: TeslaStationIdentity = {
    locationSlug: TESLA_WEST_THIRD_LOCATION_SLUG,
    siteUrl: TESLA_WEST_THIRD_SITE_URL,
  },
): EvStation {
  const charger = nestedRecord(chargerPayload, ["data", "data"]);
  const location = nestedRecord(locationPayload, ["data"]);
  if (!charger || !location) {
    throw new Error("Tesla 站点资料格式异常");
  }

  const marketing = asRecord(location.marketing);
  const keyData = asRecord(location.key_data);
  const keyAddress = asRecord(keyData?.address);
  const keyStatus = asRecord(keyData?.status);
  const supercharger = asRecord(location.supercharger_function);
  const entryPoint = asRecord(charger.entryPoint);
  const latitude =
    asNumber(entryPoint?.latitude) ?? asNumber(supercharger?.actual_latitude);
  const longitude =
    asNumber(entryPoint?.longitude) ?? asNumber(supercharger?.actual_longitude);
  if (latitude === undefined || longitude === undefined) {
    throw new Error("Tesla 站点坐标缺失");
  }

  const availabilityRoot = asRecord(charger.availabilityProfile);
  const pricing = parsePricebooks(charger.effectivePricebooks);
  const capacity =
    asPositiveInteger(charger.publicStallCount) ??
    asPositiveInteger(supercharger?.num_charger_stalls);
  const maxPowerKw =
    asNumber(charger.maxPowerKw) ??
    asNumber(supercharger?.installed_full_power);
  const twentyFourSeven = asRecord(charger.accessHours)?.twentyFourSeven === true;
  const openToNonTeslas =
    typeof charger.openToNonTeslas === "boolean"
      ? charger.openToNonTeslas
      : undefined;
  const commonSiteName = asText(charger.commonSiteName);
  const sourceUpdatedAt = asText(availabilityRoot?.createdTimestamp);
  const siteName =
    asText(charger.name) ??
    asText(marketing?.display_name) ??
    "Columbus, OH – West 3rd Avenue";
  const status = mapTeslaStatus(
    keyStatus?.name ?? supercharger?.site_status ?? supercharger?.project_status,
  );
  const amenityCodes = Array.isArray(charger.amenities)
    ? charger.amenities.filter(
        (amenity): amenity is string => typeof amenity === "string",
      )
    : [];

  const endpoints = teslaDetailsEndpoints(identity.locationSlug);
  const base = identity.baseStation;
  return {
    ...base,
    id: base?.id ?? `tesla-supercharger-${identity.locationSlug}`,
    name: `Tesla Supercharger · ${siteName}`,
    latitude,
    longitude,
    address:
      [commonSiteName, buildAddress(keyAddress)].filter(Boolean).join(" · ") ||
      undefined,
    operator: "Tesla",
    networkKind: "tesla-supercharger",
    connectors: [
      {
        type: "NACS",
        ...(capacity ? { count: capacity } : {}),
        ...(maxPowerKw ? { powerKw: maxPowerKw } : {}),
      },
    ],
    chargingSpeeds: ["dc-fast"],
    capacity,
    availabilityIsRealtime: false,
    pricing: formatPricingSummary(pricing),
    status,
    hours: twentyFourSeven ? "24/7" : undefined,
    updatedAt: fetchedAt,
    lastConfirmedAt: sourceUpdatedAt,
    accessNote: openToNonTeslas
      ? "向非 Tesla 车辆开放；请先在 Tesla App 确认车辆和 NACS 适配器兼容性。拥挤度为典型时段预测，不是实时空闲端口。"
      : "车辆兼容性和接入权限以 Tesla App 为准。拥挤度为典型时段预测，不是实时空闲端口。",
    sources: [
      {
        label: "Tesla 官方站点页",
        url: identity.siteUrl,
        checkedAt: fetchedAt,
      },
      {
        label: "Tesla 官方充电详情接口",
        url: endpoints.chargerDetails,
        checkedAt: fetchedAt,
      },
      {
        label: "Tesla 官方位置详情接口",
        url: endpoints.locationDetails,
        checkedAt: fetchedAt,
      },
      ...(base?.sources ?? []).filter(
        (source) =>
          source.url !== identity.siteUrl &&
          source.url !== endpoints.chargerDetails &&
          source.url !== endpoints.locationDetails,
      ),
    ],
    teslaDetails: {
      locationSlug: identity.locationSlug,
      dataState,
      fetchedAt,
      sourceUpdatedAt,
      timeZone: asText(charger.timeZone) ?? "America/New_York",
      openToNonTeslas,
      adapterRequiredForNonTesla: openToNonTeslas ? true : undefined,
      adapterNote: openToNonTeslas
        ? "Tesla 官方站点界面提示非 Tesla 车辆需要 NACS 适配器；原生 NACS 车型请以 Tesla App 的兼容性判断为准。"
        : undefined,
      commonSiteName,
      amenities: amenityCodes.map(
        (amenity) => AMENITY_LABELS[amenity] ?? amenity,
      ),
      pricing,
      congestionByDay: parseCongestion(
        availabilityRoot?.availabilityProfile,
      ),
    },
    openingHours: twentyFourSeven ? "24/7" : undefined,
    power: maxPowerKw ? `最高 ${maxPowerKw} kW` : "Tesla Supercharger",
    website: identity.siteUrl,
    isTesla: true,
    source: dataState === "live" ? "tesla" : "fallback",
  };
}

export function parseTeslaWestThird(
  chargerPayload: unknown,
  locationPayload: unknown,
  dataState: EvTeslaDataState,
  fetchedAt: string,
) {
  return parseTeslaStation(
    chargerPayload,
    locationPayload,
    dataState,
    fetchedAt,
  );
}

export const TESLA_WEST_THIRD_ENDPOINTS = {
  ...teslaDetailsEndpoints(TESLA_WEST_THIRD_LOCATION_SLUG),
} as const;
