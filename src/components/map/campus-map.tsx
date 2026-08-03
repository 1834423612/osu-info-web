"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import type {
  FillLayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";

import { getPermitZoneMeta } from "@/lib/permit-map";
import type { ParkingAccessPresentation } from "@/components/parking-card";
import {
  Map as MapCNMap,
  MapControls,
  MapGeoJSON,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import {
  buildParkingGroupRegion,
  parkingMapGroupIdForLocation,
  type ParkingMapGroupId,
} from "@/lib/parking-map-groups";
import {
  buildTransitRouteFeatureCollection,
  deriveTransitVehicleMapInfo,
  type TransitVehicleMapInfo,
} from "@/lib/transit-map";
import { occupancyLevel } from "@/lib/utils";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type { TransitFeed } from "@/types/transit";

const CAMPUS_CENTER: [number, number] = [-83.0226, 40.0035];
// Main campus, medical center, west campus and Buckeye Lots, with a small GPS
// accuracy buffer. A device outside this box should not leave a misleading
// "you are here" marker on the campus map.
const CAMPUS_LOCATION_BOUNDS = {
  west: -83.059,
  south: 39.975,
  east: -82.993,
  north: 40.031,
} as const;
const CABS_SOURCE_ID = "campus-cabs-routes";
const CABS_HALO_LAYER_ID = "campus-cabs-routes-halo";
const CABS_LINE_LAYER_ID = "campus-cabs-routes-line";
const CABS_DIRECTION_LAYER_ID = "campus-cabs-routes-direction";
const CABS_DIRECTION_IMAGE_ID = "campus-cabs-direction-arrow";
const PARKING_GROUP_FILL_PAINT: FillLayerSpecification["paint"] = {
  "fill-color": ["get", "groupColor"],
  "fill-opacity": ["get", "fillOpacity"],
};
const PARKING_GROUP_LINE_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "groupColor"],
  "line-opacity": ["get", "lineOpacity"],
  "line-width": ["get", "lineWidth"],
  "line-dasharray": [2, 1.4],
};
const PERMIT_AREA_FILL_PAINT: FillLayerSpecification["paint"] = {
  "fill-color": ["get", "zoneColor"],
  "fill-opacity": ["get", "fillOpacity"],
};
const PERMIT_AREA_LINE_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "zoneOutline"],
  "line-opacity": 0.86,
  "line-width": 1.4,
};
const PERMIT_AREA_PREVIEW_LINE_PAINT: LineLayerSpecification["paint"] = {
  ...PERMIT_AREA_LINE_PAINT,
  "line-width": 2,
};

const EMPTY_TRANSIT_FEED: TransitFeed = {
  routes: [],
  details: {},
  vehicles: [],
};

export type CampusMapVariant = "default" | "permit-preview";
export type { ParkingMapGroupId } from "@/lib/parking-map-groups";

export type CampusMapProps = {
  variant?: CampusMapVariant;
  locations?: ParkingLocation[];
  selectedId?: number;
  onSelect?: (id: number) => void;
  transitFeed?: TransitFeed;
  activeRoutes?: string[];
  selectedTransitRoute?: string;
  showTransit?: boolean;
  evStations?: EvStation[];
  showEv?: boolean;
  selectedEvStationId?: string;
  onSelectEvStation?: (id: string) => void;
  parkingAccessById?: Readonly<Record<number, ParkingAccessPresentation>>;
  permitAreas: FeatureCollection;
  showPermitAreas?: boolean;
  expandedPermitZones?: string[];
  expandedParkingGroup?: ParkingMapGroupId;
  className?: string;
};

function extendBoundsWithCoordinates(
  bounds: maplibregl.LngLatBounds,
  coordinates: unknown,
) {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number" &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1])
  ) {
    bounds.extend([coordinates[0], coordinates[1]]);
    return;
  }
  coordinates.forEach((entry) => extendBoundsWithCoordinates(bounds, entry));
}

function extendBoundsWithGeometry(
  bounds: maplibregl.LngLatBounds,
  geometry: Geometry | null,
) {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((entry) =>
      extendBoundsWithGeometry(bounds, entry),
    );
    return;
  }
  extendBoundsWithCoordinates(bounds, geometry.coordinates);
}

function getPermitAreaBounds(areas: FeatureCollection) {
  const bounds = new maplibregl.LngLatBounds();
  areas.features.forEach((feature) =>
    extendBoundsWithGeometry(bounds, feature.geometry),
  );
  return bounds.isEmpty() ? undefined : bounds;
}

type PermitLotRepresentative = {
  id: string;
  code: string;
  name: string;
  usage?: string;
  visitorParking?: string;
  link?: string;
  coordinates: [number, number];
  areaCount: number;
};

function featureText(
  feature: FeatureCollection["features"][number],
  key: string,
) {
  const value = feature.properties?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getPermitLotRepresentatives(
  areas: FeatureCollection,
): PermitLotRepresentative[] {
  const grouped = new Map<
    string,
    Array<{
      feature: FeatureCollection["features"][number];
      coordinates: [number, number];
    }>
  >();

  areas.features.forEach((feature, index) => {
    const code = featureText(feature, "Permit")?.toUpperCase() ?? "";
    if (!getPermitZoneMeta(code)) return;
    const name =
      featureText(feature, "CPNAME") ??
      featureText(feature, "Name") ??
      `${code} 停车区域 ${index + 1}`;
    const bounds = new maplibregl.LngLatBounds();
    extendBoundsWithGeometry(bounds, feature.geometry);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter();
    const key = `${code}:${name.toLocaleLowerCase()}`;
    const entries = grouped.get(key) ?? [];
    entries.push({ feature, coordinates: [center.lng, center.lat] });
    grouped.set(key, entries);
  });

  return Array.from(grouped.entries()).map(([key, entries]) => {
    const source = entries[0].feature;
    const code = featureText(source, "Permit")?.toUpperCase() ?? "";
    const name =
      featureText(source, "CPNAME") ?? featureText(source, "Name") ?? code;
    const mean = entries.reduce(
      (total, entry) => [
        total[0] + entry.coordinates[0] / entries.length,
        total[1] + entry.coordinates[1] / entries.length,
      ],
      [0, 0],
    );
    const representative = entries
      .map((entry) => ({
        ...entry,
        distance:
          (entry.coordinates[0] - mean[0]) ** 2 +
          (entry.coordinates[1] - mean[1]) ** 2,
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return {
      id: key,
      code,
      name,
      usage: featureText(source, "Usage"),
      visitorParking: featureText(source, "VisitorPark"),
      link: featureText(source, "Link"),
      coordinates: representative.coordinates,
      areaCount: entries.length,
    };
  });
}

function PermitLotPopup({ lot }: { lot: PermitLotRepresentative }) {
  const sourceUrl = safeHttpsUrl(lot.link, "https://osu.campusparc.com");
  const meta = getPermitZoneMeta(lot.code);

  return (
    <div className="map-info-popup map-info-popup--permit">
      <small>{meta?.shortNameZh ?? lot.code} · {lot.code}</small>
      <strong>{lot.name}</strong>
      {meta && <p>{meta.descriptionZh}</p>}
      {(lot.usage || lot.visitorParking) && (
        <div>
          {lot.usage && <span>{lot.usage}</span>}
          {lot.visitorParking && (
            <span className="is-warning">访客：{lot.visitorParking}</span>
          )}
        </div>
      )}
      {lot.areaCount > 1 && <span>同名区域共 {lot.areaCount} 处</span>}
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          查看官方说明 ↗
        </a>
      )}
    </div>
  );
}

const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -0.82,
        "raster-brightness-min": 0.22,
        "raster-brightness-max": 0.97,
        "raster-contrast": 0.06,
      },
    },
  ],
};

function removeLayerIfPresent(map: MapLibreMap, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // React can dispose the map-owning effect before layer effects on unmount.
  }
}

function removeSourceIfPresent(map: MapLibreMap, sourceId: string) {
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    // The whole MapLibre instance may already have been removed.
  }
}

function createDirectionArrowImage(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return new ImageData(32, 32);

  context.clearRect(0, 0, 32, 32);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(9, 6);
  context.lineTo(22, 16);
  context.lineTo(9, 26);
  context.stroke();
  return context.getImageData(0, 0, 32, 32);
}

function transitMarkerScaleForZoom(zoom: number) {
  if (zoom < 12.5) return 0.7;
  if (zoom < 14) return 0.82;
  if (zoom < 15.5) return 0.92;
  return 1;
}

function ParkingMarker({
  location,
  selected,
  access,
}: {
  location: ParkingLocation;
  selected: boolean;
  access?: ParkingAccessPresentation;
}) {
  const level = occupancyLevel(location.UsePercentage);
  const visual =
    location.kind === "surface"
      ? location.GarageId === 3005
        ? {
            color: "#7c3aed",
            background: "#7c3aed",
            accessLabel: "CX 为主，局部限制区域以标牌为准",
          }
        : location.GarageId === 3002
          ? {
              color: "#2563eb",
              background:
                "linear-gradient(135deg, #2563eb 0 50%, #0891b2 50% 100%)",
              accessLabel: "WA / WB 聚合地面停车区",
            }
          : {
              color: "#0891b2",
              background: "#0891b2",
              accessLabel: "WB 地面停车区",
            }
      : location.GarageType === 3
        ? {
            color: "#2563eb",
            background: "#2563eb",
            accessLabel: "访客 / 患者入口为主",
          }
        : location.GarageType === 2
          ? {
              color: "#d97706",
              background: "#d97706",
              accessLabel: "进入前核对当前车库权限表",
            }
          : {
              color: "#ba0c2f",
              background: "#ba0c2f",
              accessLabel: "综合实时车库，具体权限以入口提示为准",
            };
  return (
    <button
      type="button"
      className={`parking-map-marker occupancy-${level}${selected ? " is-selected" : ""}${location.Closed ? " is-closed" : ""}${access ? ` access-${access.status}` : ""}`}
      style={
        {
          "--parking-marker-color":
            access?.status === "unavailable"
              ? "#94a3b8"
              : access?.status === "later"
                ? "#b7791f"
                : access?.status === "visitor-paid"
                  ? "#c2410c"
                  : visual.color,
          "--parking-marker-background":
            access?.status === "unavailable"
              ? "#cbd5e1"
              : access?.status === "later"
                ? "#b7791f"
                : access?.status === "visitor-paid"
                  ? "#c2410c"
                  : visual.background,
        } as React.CSSProperties
      }
      aria-label={`${location.GarageName}，${access?.title ?? visual.accessLabel}，${location.available} 个估算空位`}
      title={`${access?.title ?? visual.accessLabel}${access?.nextAccessLabel ? ` · ${access.nextAccessLabel}` : ""} · ${location.available} 个估算空位`}
    >
      <span className="parking-map-marker__icon">
        {location.kind === "surface" ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3h6a5 5 0 0 1 0 10H9v8H7V3Zm2 2v6h4a3 3 0 1 0 0-6H9Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 3h16v18h-2v-2H6v2H4V3Zm2 2v3h12V5H6Zm0 5v7h12v-7H6Zm2 2h3v3H8v-3Z" />
          </svg>
        )}
      </span>
      <span className="parking-map-marker__count">
        {location.Closed ? "关" : location.available}
      </span>
      {access && (
        <span className="parking-map-marker__access" aria-hidden="true">
          <Icon
            icon={
              access.status === "included"
                ? "solar:shield-check-bold"
                : access.status === "later"
                  ? "solar:clock-circle-bold"
                  : access.status === "visitor-paid"
                    ? "solar:wallet-money-bold"
                    : "solar:lock-keyhole-bold"
            }
          />
        </span>
      )}
    </button>
  );
}

function formatTransitUpdated(value?: string) {
  if (!value) return undefined;
  const updated = new Date(value);
  if (Number.isNaN(updated.getTime())) return undefined;
  return `${updated.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  })} ET`;
}

function TransitStationBoard({
  info,
  color,
}: {
  info: TransitVehicleMapInfo;
  color: string;
}) {
  const { vehicle, route } = info;
  const currentStop = info.lastReportedStop
    ? {
        label: "最近上报站",
        name: info.lastReportedStop.name,
        detail: "车辆上报",
      }
    : info.nearestStop
      ? {
          label: "车辆附近",
          name: info.nearestStop.name,
          detail: `位置估算 · ${info.nearestStop.distanceMeters} m`,
        }
      : undefined;
  const upcoming = info.upcomingStops.slice(0, 3);
  const updated = formatTransitUpdated(vehicle.updated);

  return (
    <div
      className="transit-station-board"
      style={{ "--route-color": color } as React.CSSProperties}
    >
      <header className="transit-station-board__header">
        <span>{vehicle.routeCode}</span>
        <div>
          <small>CABS · 实时车辆 {info.vehicleLabel}</small>
          <strong>{route?.name ?? "校园公交"}</strong>
        </div>
        <Icon icon="solar:bus-bold" />
      </header>

      <div className="transit-station-board__destination">
        <span>开往</span>
        <strong>{info.destination || info.terminalStop?.name || "线路终点"}</strong>
        {info.routeDirectionLabel && <small>{info.routeDirectionLabel}</small>}
      </div>

      <section className="transit-station-board__stops">
        {currentStop && (
          <div className="is-current">
            <i />
            <span>
              <small>{currentStop.label}</small>
              <strong>{currentStop.name}</strong>
              <em>{currentStop.detail}</em>
            </span>
          </div>
        )}
        {upcoming.length > 0 ? (
          upcoming.map((stop, index) => (
            <div key={`${stop.id ?? stop.name}-${index}`} className={index === 0 ? "is-next" : ""}>
              <i>{index === 0 ? <Icon icon="solar:bus-bold" /> : null}</i>
              <span>
                <small>{index === 0 ? "下一站" : `后续第 ${index + 1} 站`}</small>
                <strong>{stop.name}</strong>
                {stop.destination && <em>开往 {stop.destination}</em>}
              </span>
              <b>
                {stop.etaMinutes === undefined
                  ? "预测中"
                  : stop.etaMinutes <= 1
                    ? "即将到站"
                    : `${stop.etaMinutes} 分`}
              </b>
            </div>
          ))
        ) : (
          <div className="is-next">
            <i />
            <span>
              <small>下一站</small>
              <strong>{info.nextStop?.stopName ?? "等待实时到站预测"}</strong>
            </span>
            <b>预测中</b>
          </div>
        )}
        {info.terminalStop &&
          !upcoming.some((stop) => stop.name === info.terminalStop?.name) && (
            <div className="is-terminal">
              <i />
              <span>
                <small>线路终点</small>
                <strong>{info.terminalStop.name}</strong>
              </span>
            </div>
          )}
      </section>

      <footer className="transit-station-board__meta">
        {typeof vehicle.speed === "number" && (
          <span>{Math.round(vehicle.speed)} mph</span>
        )}
        {vehicle.delayed && <span className="is-warning">可能延误</span>}
        {updated && <span>更新 {updated}</span>}
        <small>到站时间来自车辆实时预测</small>
      </footer>
    </div>
  );
}

function formatEvAvailabilityUpdate(value?: string) {
  if (!value) return undefined;
  const updated = new Date(value);
  if (Number.isNaN(updated.getTime())) return undefined;
  return `${updated.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  })} ET`;
}

function safeHttpsUrl(value?: string, base?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function EvStationPopup({ station }: { station: EvStation }) {
  const chargingLevel = station.chargingSpeeds?.includes("dc-fast")
    ? "DC FAST"
    : station.chargingSpeeds?.includes("level-2")
      ? "LEVEL 2"
      : station.chargingSpeeds?.includes("level-1")
        ? "LEVEL 1"
        : "EV CHARGING";
  const hasRealtimeAvailability =
    station.availabilityIsRealtime &&
    typeof station.availablePorts === "number" &&
    Number.isFinite(station.availablePorts) &&
    typeof station.capacity === "number" &&
    Number.isFinite(station.capacity) &&
    station.capacity > 0;
  const availablePorts = hasRealtimeAvailability
    ? Math.min(station.capacity!, Math.max(0, station.availablePorts!))
    : undefined;
  const occupiedPercent =
    availablePorts === undefined
      ? undefined
      : Math.round(((station.capacity! - availablePorts) / station.capacity!) * 100);
  const availabilityUpdate = formatEvAvailabilityUpdate(
    station.availabilityUpdatedAt,
  );
  const source =
    station.sources.find(
      (candidate) =>
        candidate.label.includes("Tesla") ||
        candidate.label.includes("Ohio State"),
    ) ?? station.sources[0];
  const sourceUrl = safeHttpsUrl(source?.url);
  const facts = [
    ["价格", station.pricing ?? "运营商未公开；以 App/现场为准"],
    ["开放", station.hours],
    ["地址", station.address],
    ["限制", station.accessNote],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <div className="map-info-popup map-info-popup--ev">
      <small>
        {station.networkKind === "tesla-supercharger"
          ? "TESLA SUPERCHARGER"
          : `${station.operator ?? "PUBLIC EV"} · ${chargingLevel}`}
      </small>
      <strong>{station.name}</strong>
      <section className="ev-popup-availability">
        <strong>
          {availablePorts !== undefined
            ? `${availablePorts} / ${station.capacity} 可用`
            : station.capacity
              ? `${station.capacity} 个充电端口`
              : "端口数量未公开"}
        </strong>
        <span>
          {occupiedPercent !== undefined
            ? [`占用 ${occupiedPercent}%`, availabilityUpdate ? `更新 ${availabilityUpdate}` : undefined]
                .filter(Boolean)
                .join(" · ")
            : station.availabilityIsRealtime
              ? "实时端口状态暂不可用"
              : station.status === "operational"
                ? "站点运营中 · 非实时端口状态"
                : "请在运营商应用确认"}
        </span>
      </section>
      {station.connectors.length > 0 && (
        <div className="ev-popup-connectors">
          {station.connectors.map((connector, index) => (
            <span key={`${connector.type}-${index}`}>
              {[
                connector.type === "other" ? "接口未公开" : connector.type,
                connector.count
                  ? `× ${connector.count} 端口`
                  : connector.type === "other"
                    ? undefined
                    : "支持接口",
                connector.powerKw ? `最高 ${connector.powerKw} kW` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ))}
        </div>
      )}
      {facts.length > 0 && (
        <dl>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {source && (
        <footer>
          <span>
            {station.updatedAt
              ? `数据更新 ${station.updatedAt.slice(0, 10)}`
              : "可追溯站点资料"}
          </span>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              {source.label} ↗
            </a>
          )}
        </footer>
      )}
    </div>
  );
}

function CampusMapRuntime({
  variant = "default",
  locations = [],
  selectedId,
  onSelect,
  transitFeed = EMPTY_TRANSIT_FEED,
  activeRoutes = [],
  selectedTransitRoute,
  showTransit = false,
  evStations = [],
  showEv = false,
  selectedEvStationId,
  onSelectEvStation,
  parkingAccessById,
  permitAreas,
  showPermitAreas = true,
  expandedPermitZones = [],
  expandedParkingGroup,
}: CampusMapProps) {
  const { map } = useMap();
  const mapRef = useRef<MapLibreMap | null>(map);
  const lastFocusedSelectedIdRef = useRef<number | undefined>(undefined);
  const lastFocusedEvStationIdRef = useRef<string | undefined>(undefined);
  const lastFocusedTransitRouteRef = useRef<string | undefined>(undefined);
  const didFitPermitPreviewRef = useRef(false);
  const [transitMarkerScale, setTransitMarkerScale] = useState(() =>
    transitMarkerScaleForZoom(map?.getZoom() ?? 13.25),
  );
  const isPermitPreview = variant === "permit-preview";
  const expandedPermitZoneKey = [...expandedPermitZones].sort().join(",");
  const expandedPermitZoneSet = useMemo(
    () =>
      new Set(
        expandedPermitZoneKey ? expandedPermitZoneKey.split(",") : [],
      ),
    [expandedPermitZoneKey],
  );

  const routeColors = useMemo(
    () =>
      Object.fromEntries(
        transitFeed.routes.map((route) => [route.code, route.color]),
      ),
    [transitFeed.routes],
  );
  const transitGeometryFeed = useMemo<TransitFeed>(
    () => ({
      routes: transitFeed.routes,
      details: transitFeed.details,
      vehicles: [],
    }),
    [transitFeed.details, transitFeed.routes],
  );
  const transitRouteData = useMemo(
    () => buildTransitRouteFeatureCollection(activeRoutes, transitGeometryFeed),
    [activeRoutes, transitGeometryFeed],
  );
  const selectedTransitRouteData = useMemo(
    () =>
      selectedTransitRoute
        ? buildTransitRouteFeatureCollection(
            [selectedTransitRoute],
            transitGeometryFeed,
          )
        : undefined,
    [selectedTransitRoute, transitGeometryFeed],
  );
  const parkingGroupRegion = useMemo(
    () => buildParkingGroupRegion(expandedParkingGroup, locations),
    [expandedParkingGroup, locations],
  );
  const permitAreaData = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: showPermitAreas
        ? permitAreas.features.flatMap((feature) => {
            if (
              feature.geometry?.type !== "Polygon" &&
              feature.geometry?.type !== "MultiPolygon"
            ) {
              return [];
            }
            const code =
              typeof feature.properties?.Permit === "string"
                ? feature.properties.Permit
                : "";
            const meta = getPermitZoneMeta(code);
            if (!meta) return [];
            return [
              {
                ...feature,
                properties: {
                  ...feature.properties,
                  zoneCode: meta.code,
                  zoneColor: meta.color,
                  zoneOutline: meta.outlineColor,
                  fillOpacity:
                    expandedPermitZoneSet.size === 0
                      ? isPermitPreview
                        ? 0.3
                        : 0.21
                      : expandedPermitZoneSet.has(meta.code)
                        ? 0.34
                        : 0.1,
                },
              },
            ];
          })
        : [],
    }),
    [
      expandedPermitZoneSet,
      isPermitPreview,
      permitAreas.features,
      showPermitAreas,
    ],
  );

  const selectedLocation = locations.find(
    (location) => location.GarageId === selectedId,
  );
  const selectedLongitude = selectedLocation?.longitude;
  const selectedLatitude = selectedLocation?.latitude;
  const selectedEvStation = evStations.find(
    (station) => station.id === selectedEvStationId,
  );
  const selectedEvLongitude = selectedEvStation?.longitude;
  const selectedEvLatitude = selectedEvStation?.latitude;

  useEffect(() => {
    const map = mapRef.current;
    if (selectedId === undefined) {
      lastFocusedSelectedIdRef.current = undefined;
      return;
    }
    if (
      !map ||
      selectedLongitude === undefined ||
      selectedLatitude === undefined ||
      isPermitPreview ||
      lastFocusedSelectedIdRef.current === selectedId
    ) {
      return;
    }
    lastFocusedSelectedIdRef.current = selectedId;
    map.easeTo({
      center: [selectedLongitude, selectedLatitude],
      zoom: Math.max(map.getZoom(), 14.4),
      duration: 700,
      offset: [0, -60],
    });
  }, [isPermitPreview, selectedId, selectedLatitude, selectedLongitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (selectedEvStationId === undefined) {
      lastFocusedEvStationIdRef.current = undefined;
      return;
    }
    if (
      !map ||
      !showEv ||
      isPermitPreview ||
      selectedEvLongitude === undefined ||
      selectedEvLatitude === undefined ||
      lastFocusedEvStationIdRef.current === selectedEvStationId
    ) {
      return;
    }
    lastFocusedEvStationIdRef.current = selectedEvStationId;
    map.easeTo({
      center: [selectedEvLongitude, selectedEvLatitude],
      zoom: Math.max(map.getZoom(), 14.6),
      duration: 650,
      offset: [0, -48],
    });
  }, [
    isPermitPreview,
    selectedEvLatitude,
    selectedEvLongitude,
    selectedEvStationId,
    showEv,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const normalizedSelectedRoute = selectedTransitRoute?.trim().toUpperCase();
    const selectedRouteIsVisible = activeRoutes.some(
      (code) => code.trim().toUpperCase() === normalizedSelectedRoute,
    );
    if (!normalizedSelectedRoute || !selectedRouteIsVisible || !showTransit) {
      lastFocusedTransitRouteRef.current = undefined;
      return;
    }
    if (
      !map ||
      isPermitPreview ||
      !selectedTransitRouteData?.features.length
    ) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    selectedTransitRouteData.features.forEach((feature) =>
      extendBoundsWithGeometry(bounds, feature.geometry),
    );
    if (bounds.isEmpty()) return;

    const focusCompleteRoute = () => {
      if (lastFocusedTransitRouteRef.current === normalizedSelectedRoute) {
        return;
      }
      const container = map.getContainer();
      // The mobile map remains mounted while its list view is visible. Defer
      // fitting until ResizeObserver reveals a real canvas size.
      if (container.clientWidth < 120 || container.clientHeight < 120) return;
      lastFocusedTransitRouteRef.current = normalizedSelectedRoute;
      map.fitBounds(bounds, {
        padding: { top: 76, right: 68, bottom: 76, left: 68 },
        maxZoom: 15.4,
        duration: 700,
      });
    };

    focusCompleteRoute();
    map.on("resize", focusCompleteRoute);
    return () => {
      map.off("resize", focusCompleteRoute);
    };
  }, [
    activeRoutes,
    isPermitPreview,
    selectedTransitRoute,
    selectedTransitRouteData,
    showTransit,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isPermitPreview) return;
    const updateMarkerScale = () =>
      setTransitMarkerScale(transitMarkerScaleForZoom(map.getZoom()));
    map.on("zoomend", updateMarkerScale);
    return () => {
      map.off("zoomend", updateMarkerScale);
    };
  }, [isPermitPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !isPermitPreview ||
      didFitPermitPreviewRef.current ||
      !showPermitAreas ||
      permitAreas.features.length === 0
    ) {
      return;
    }

    const bounds = getPermitAreaBounds(permitAreas);
    if (!bounds) return;
    didFitPermitPreviewRef.current = true;
    map.fitBounds(bounds, {
      padding: 30,
      maxZoom: 16,
      duration: 450,
    });
  }, [isPermitPreview, permitAreas, showPermitAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isPermitPreview || !showTransit) return;
    if (transitRouteData.features.length === 0) return;

    let active = true;
    const renderRoutes = () => {
      if (!active) return;
      // Effects can overlap briefly while React swaps a refreshed GeoJSON
      // collection. Clear the complete layer stack before re-adding it so a
      // stale source can never make addSource throw.
      removeLayerIfPresent(map, CABS_DIRECTION_LAYER_ID);
      removeLayerIfPresent(map, CABS_LINE_LAYER_ID);
      removeLayerIfPresent(map, CABS_HALO_LAYER_ID);
      removeSourceIfPresent(map, CABS_SOURCE_ID);
      if (!map.hasImage(CABS_DIRECTION_IMAGE_ID)) {
        map.addImage(CABS_DIRECTION_IMAGE_ID, createDirectionArrowImage());
      }
      map.addSource(CABS_SOURCE_ID, {
        type: "geojson",
        data: transitRouteData,
      });
      map.addLayer({
        id: CABS_HALO_LAYER_ID,
        type: "line",
        source: CABS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.88,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 8],
          "line-offset": [
            "*",
            ["get", "lineOffset"],
            ["interpolate", ["linear"], ["zoom"], 11, 1.4, 16, 2.8],
          ],
        },
      });
      map.addLayer({
        id: CABS_LINE_LAYER_ID,
        type: "line",
        source: CABS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 5],
          "line-offset": [
            "*",
            ["get", "lineOffset"],
            ["interpolate", ["linear"], ["zoom"], 11, 1.4, 16, 2.8],
          ],
        },
      });
      map.addLayer({
        id: CABS_DIRECTION_LAYER_ID,
        type: "symbol",
        source: CABS_SOURCE_ID,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 105,
          "icon-image": CABS_DIRECTION_IMAGE_ID,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.25, 16, 0.42],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-keep-upright": false,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    };

    if (map.isStyleLoaded()) renderRoutes();
    else map.once("load", renderRoutes);
    return () => {
      active = false;
      map.off("load", renderRoutes);
      removeLayerIfPresent(map, CABS_DIRECTION_LAYER_ID);
      removeLayerIfPresent(map, CABS_LINE_LAYER_ID);
      removeLayerIfPresent(map, CABS_HALO_LAYER_ID);
      removeSourceIfPresent(map, CABS_SOURCE_ID);
    };
  }, [isPermitPreview, showTransit, transitRouteData]);

  const visibleTransitVehicles = transitFeed.vehicles.filter(
    (vehicle) =>
      activeRoutes.includes(vehicle.routeCode) &&
      Number.isFinite(vehicle.latitude) &&
      Number.isFinite(vehicle.longitude),
  );
  const visibleParkingLocations = useMemo(
    () =>
      isPermitPreview
        ? []
        : locations.filter(
            (location) =>
              parkingMapGroupIdForLocation(location) ===
                expandedParkingGroup || location.GarageId === selectedId,
          ),
    [expandedParkingGroup, isPermitPreview, locations, selectedId],
  );
  const expandedPermitLots = useMemo(
    () =>
      showPermitAreas &&
      expandedPermitZoneSet.size > 0 &&
      permitAreas.features.length > 0
        ? getPermitLotRepresentatives(permitAreas)
            .filter((lot) => expandedPermitZoneSet.has(lot.code))
            .flatMap((lot) => {
              const meta = getPermitZoneMeta(lot.code);
              return meta ? [{ lot, color: meta.color }] : [];
            })
        : [],
    [expandedPermitZoneSet, permitAreas, showPermitAreas],
  );

  return (
    <>
      {permitAreaData.features.length > 0 && (
        <MapGeoJSON
          id="campus-permit-areas"
          data={permitAreaData}
          fillPaint={PERMIT_AREA_FILL_PAINT}
          linePaint={
            isPermitPreview
              ? PERMIT_AREA_PREVIEW_LINE_PAINT
              : PERMIT_AREA_LINE_PAINT
          }
        />
      )}
      {!isPermitPreview && (
        <MapGeoJSON
          id="campus-parking-group-region"
          data={parkingGroupRegion}
          fillPaint={PARKING_GROUP_FILL_PAINT}
          linePaint={PARKING_GROUP_LINE_PAINT}
        />
      )}
      {visibleParkingLocations.map((location) => (
        <MapMarker
          key={location.GarageId}
          longitude={location.longitude}
          latitude={location.latitude}
          anchor="bottom"
          onClick={() => onSelect?.(location.GarageId)}
        >
          <MarkerContent>
            <ParkingMarker
              location={location}
              selected={location.GarageId === selectedId}
              access={parkingAccessById?.[location.GarageId]}
            />
          </MarkerContent>
        </MapMarker>
      ))}
      {expandedPermitLots.map(({ lot, color }) => (
        <MapMarker
          key={lot.id}
          longitude={lot.coordinates[0]}
          latitude={lot.coordinates[1]}
          anchor="bottom"
        >
          <MarkerContent>
            <button
              type="button"
              className="permit-lot-map-marker"
              style={{ "--permit-zone-color": color } as React.CSSProperties}
              aria-label={`${lot.name}，${lot.code} 停车证区域`}
              aria-haspopup="dialog"
            >
              <b>{lot.code}</b>
              <span>{lot.name}</span>
            </button>
          </MarkerContent>
          <MarkerPopup offset={16} maxWidth="270px">
            <PermitLotPopup lot={lot} />
          </MarkerPopup>
        </MapMarker>
      ))}
      {!isPermitPreview &&
        showTransit &&
        visibleTransitVehicles.map((vehicle) => {
          const color = routeColors[vehicle.routeCode] ?? "#334155";
          const info = deriveTransitVehicleMapInfo(vehicle, transitFeed);
          return (
            <MapMarker
              key={`${vehicle.routeCode}:${vehicle.id}`}
              longitude={vehicle.longitude}
              latitude={vehicle.latitude}
              anchor="bottom"
            >
              <MarkerContent>
                <button
                  type="button"
                  className={`transit-map-marker${vehicle.delayed ? " is-delayed" : ""}`}
                  style={
                    {
                      "--route-color": color,
                      "--transit-marker-scale": transitMarkerScale,
                    } as React.CSSProperties
                  }
                  aria-label={`${vehicle.routeCode} 线路公交 ${info.vehicleLabel}`}
                  aria-haspopup="dialog"
                >
                  <span className="transit-map-marker__bus">
                    <Icon icon="solar:bus-bold" aria-hidden="true" />
                  </span>
                  <b>{vehicle.routeCode}</b>
                  {typeof vehicle.heading === "number" &&
                    Number.isFinite(vehicle.heading) && (
                      <i
                        className="transit-map-marker__direction"
                        style={{ transform: `rotate(${vehicle.heading}deg)` }}
                        aria-hidden="true"
                      >
                        <Icon icon="solar:map-arrow-up-bold" />
                      </i>
                    )}
                </button>
              </MarkerContent>
              <MarkerPopup offset={18} maxWidth="340px">
                <TransitStationBoard info={info} color={color} />
              </MarkerPopup>
            </MapMarker>
          );
        })}
      {!isPermitPreview &&
        showEv &&
        evStations.map((station) => {
          const isTesla = station.networkKind === "tesla-supercharger";
          return (
            <MapMarker
              key={station.id}
              longitude={station.longitude}
              latitude={station.latitude}
              anchor="bottom"
              onClick={() => onSelectEvStation?.(station.id)}
            >
              <MarkerContent>
                <button
                  type="button"
                  className={
                    `ev-map-marker${isTesla ? " is-tesla" : " is-third-party"}${station.id === selectedEvStationId ? " is-selected" : ""}`
                  }
                  aria-label={`${station.name}，${station.capacity ?? "未知数量"} 个充电端口`}
                  aria-haspopup="dialog"
                >
                  {isTesla ? (
                    <b>T</b>
                  ) : (
                    <Icon icon="solar:bolt-bold" aria-hidden="true" />
                  )}
                </button>
              </MarkerContent>
              <MarkerPopup offset={20} maxWidth="320px">
                <EvStationPopup station={station} />
              </MarkerPopup>
            </MapMarker>
          );
        })}
    </>
  );
}

export default function CampusMap(props: CampusMapProps) {
  const isPermitPreview = props.variant === "permit-preview";
  return (
    <MapCNMap
      styles={{ light: baseStyle }}
      center={CAMPUS_CENTER}
      zoom={13.25}
      minZoom={11}
      maxZoom={19}
      attributionControl={{ compact: true }}
      className={props.className}
      ariaLabel={
        isPermitPreview
          ? "所选停车证当前可用停车区域预览"
          : "OSU 校园停车、充电与公交实时地图"
      }
    >
      <CampusMapRuntime {...props} />
      <MapControls
        position="bottom-right"
        showZoom
        showCompass
        showLocate={!isPermitPreview}
        locationBounds={CAMPUS_LOCATION_BOUNDS}
      />
    </MapCNMap>
  );
}
