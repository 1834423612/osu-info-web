export type EvNetworkKind =
  | "tesla-supercharger"
  | "chargepoint"
  | "electrify-america"
  | "evgo"
  | "other";

export type EvConnectorType =
  | "NACS"
  | "CCS1"
  | "CHAdeMO"
  | "J1772"
  | "MCS"
  | "other";

export type EvStationStatus =
  | "operational"
  | "temporarily-unavailable"
  | "planned"
  | "unknown";

export type EvChargingSpeed =
  | "level-1"
  | "level-2"
  | "dc-fast"
  | "unknown";

export type EvTeslaDataState = "live" | "static-snapshot";

export type EvUpstreamService =
  | "nlr"
  | "tesla-charger"
  | "tesla-location";

export type EvUpstreamTransport = "browser" | "server" | "snapshot";
export type EvUpstreamFailureKind =
  | "edge-challenge"
  | "rate-limit"
  | "invalid-response"
  | "network";

/**
 * A sanitized status for one upstream request. This is intentionally safe to
 * show in the UI and console: API keys and complete upstream response bodies
 * are never included.
 */
export type EvUpstreamStatus = {
  service: EvUpstreamService;
  transport: EvUpstreamTransport;
  ok: boolean;
  attemptedAt: string;
  status?: number;
  stationId?: string;
  durationMs?: number;
  cache?: "miss" | "fresh" | "stale";
  failureKind?: EvUpstreamFailureKind;
  message?: string;
  requestId?: string;
};

export type EvPricePeriod = {
  /** Local time at the charging site, in HH:mm format. */
  startTime: string;
  /** Local time at the charging site, in HH:mm format. */
  endTime: string;
  /** Tesla weekday numbers (0 = Sunday through 6 = Saturday). */
  days: number[];
  rate: number;
  currencyCode: string;
  unit: "kWh" | "minute" | string;
};

export type EvTeslaPriceAudience = {
  audience: "tesla-member" | "non-tesla";
  baseRate?: number;
  periods: EvPricePeriod[];
  congestionFee?: EvPricePeriod;
};

export type EvTeslaDetails = {
  locationSlug: string;
  /** `live` means the current request was parsed from Tesla, via browser or server. */
  dataState: EvTeslaDataState;
  fetchedAt: string;
  sourceUpdatedAt?: string;
  timeZone: string;
  openToNonTeslas?: boolean;
  adapterRequiredForNonTesla?: boolean;
  adapterNote?: string;
  commonSiteName?: string;
  amenities: string[];
  pricing: EvTeslaPriceAudience[];
  /** Expected hourly congestion, not live free-stall availability. */
  congestionByDay: Partial<
    Record<
      | "sunday"
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday",
      number[]
    >
  >;
};

export type EvConnector = {
  type: EvConnectorType;
  /** Number of ports for this connector and power combination. */
  count?: number;
  powerKw?: number;
};

export type EvSourceLink = {
  label: string;
  url: string;
  checkedAt?: string;
};

export type EvStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  operator?: string;
  networkKind: EvNetworkKind;
  connectors: EvConnector[];
  chargingSpeeds?: EvChargingSpeed[];
  /** Number of vehicles that can charge simultaneously, when published. */
  capacity?: number;
  /** Only populated by a source that actually publishes live port status. */
  availablePorts?: number;
  availabilityUpdatedAt?: string;
  availabilityIsRealtime: boolean;
  pricing?: string;
  status: EvStationStatus;
  hours?: string;
  updatedAt?: string;
  lastConfirmedAt?: string;
  accessNote?: string;
  sources: EvSourceLink[];
  teslaDetails?: EvTeslaDetails;
  /** Present for OSU-published Level 2 locations. */
  campusLocation?: {
    garageId: number;
    name: string;
  };

  /** Compatibility fields used by the existing map and detail views. */
  openingHours?: string;
  power?: string;
  website?: string;
  isTesla: boolean;
  source: "afdc" | "tesla" | "campus" | "fallback" | "osm";
};

export type EvStationsResponse = {
  stations: EvStation[];
  generatedAt: string;
  sourceUpdatedAt?: string;
  isFallback: boolean;
  warning?: string;
  /** Whether this result came from direct requests, the same-origin proxy, or both. */
  requestOrigin?: "browser" | "server" | "mixed" | "snapshot";
  /** Per-upstream diagnostics without secrets or raw provider response bodies. */
  upstreams?: EvUpstreamStatus[];
  /** Correlates a browser failure with the corresponding server log entry. */
  requestId?: string;
};
