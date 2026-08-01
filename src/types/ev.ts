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
};
