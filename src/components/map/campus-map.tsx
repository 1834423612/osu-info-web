"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import type {
  Map as MapLibreMap,
  Marker,
  StyleSpecification,
} from "maplibre-gl";

import { getPermitZoneMeta } from "@/lib/permit-map";
import { decodePolyline } from "@/lib/polyline";
import { occupancyLevel } from "@/lib/utils";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type {
  TransitFeed,
  TransitRoute,
  TransitVehicle,
} from "@/types/transit";

const CAMPUS_CENTER: [number, number] = [-83.0226, 40.0035];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const EMPTY_TRANSIT_FEED: TransitFeed = {
  routes: [],
  details: {},
  vehicles: [],
};

export type CampusMapVariant = "default" | "permit-preview";

export type CampusMapProps = {
  variant?: CampusMapVariant;
  locations?: ParkingLocation[];
  selectedId?: number;
  onSelect?: (id: number) => void;
  transitFeed?: TransitFeed;
  activeRoutes?: string[];
  showTransit?: boolean;
  evStations?: EvStation[];
  showEv?: boolean;
  permitAreas: FeatureCollection;
  showPermitAreas?: boolean;
  expandedPermitZones?: string[];
  onTogglePermitZone?: (zone: string) => void;
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

function getPermitZoneRepresentatives(areas: FeatureCollection) {
  const grouped = new Map<
    string,
    Array<{ coordinates: [number, number]; distance?: number }>
  >();

  areas.features.forEach((feature) => {
    const code =
      typeof feature.properties?.Permit === "string"
        ? feature.properties.Permit.toUpperCase()
        : "";
    if (!getPermitZoneMeta(code)) return;

    const bounds = new maplibregl.LngLatBounds();
    extendBoundsWithGeometry(bounds, feature.geometry);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter();
    const candidates = grouped.get(code) ?? [];
    candidates.push({ coordinates: [center.lng, center.lat] });
    grouped.set(code, candidates);
  });

  return Array.from(grouped.entries()).flatMap(([code, candidates]) => {
    const meta = getPermitZoneMeta(code);
    if (!meta || candidates.length === 0) return [];
    const mean = candidates.reduce(
      (total, candidate) => [
        total[0] + candidate.coordinates[0] / candidates.length,
        total[1] + candidate.coordinates[1] / candidates.length,
      ],
      [0, 0],
    );
    const representative = candidates
      .map((candidate) => ({
        ...candidate,
        distance:
          (candidate.coordinates[0] - mean[0]) ** 2 +
          (candidate.coordinates[1] - mean[1]) ** 2,
      }))
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];

    return [
      {
        meta,
        coordinates: representative.coordinates,
        areaCount: candidates.length,
      },
    ];
  });
}

function permitZoneMarkerElement(
  code: string,
  shortNameZh: string,
  color: string,
  areaCount: number,
  expanded: boolean,
  onToggle?: (zone: string) => void,
) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `permit-ticket-map-marker${expanded ? " is-expanded" : ""}`;
  element.style.setProperty("--permit-zone-color", color);
  element.setAttribute(
    "aria-label",
    `${code} 停车证区域，${shortNameZh}，${areaCount} 处，${expanded ? "收起" : "展开"}具体位置`,
  );
  element.setAttribute("aria-pressed", String(expanded));
  element.innerHTML = `
    <span class="permit-ticket-map-marker__code">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V9a3 3 0 0 0 0 6v3.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V15a3 3 0 0 0 0-6V5.5Z"/></svg>
      <b>${code}</b>
    </span>
    <span class="permit-ticket-map-marker__name">
      <b>${shortNameZh}</b>
      <small>${areaCount} 处 · ${expanded ? "已展开" : "点按细分"}</small>
    </span>
    <svg class="permit-ticket-map-marker__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
  `;
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggle?.(code);
  });
  return element;
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

function permitLotMarkerElement(lot: PermitLotRepresentative, color: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "permit-lot-map-marker";
  element.style.setProperty("--permit-zone-color", color);
  element.setAttribute(
    "aria-label",
    `${lot.name}，${lot.code} 停车证区域`,
  );

  const code = document.createElement("b");
  code.textContent = lot.code;
  const name = document.createElement("span");
  name.textContent = lot.name;
  element.append(code, name);
  return element;
}

function permitLotPopupElement(lot: PermitLotRepresentative) {
  const content = document.createElement("div");
  content.className = "map-info-popup map-info-popup--permit";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = `${lot.code} · 具体停车区域`;
  const title = document.createElement("strong");
  title.textContent = lot.name;
  content.append(eyebrow, title);

  if (lot.usage || lot.visitorParking) {
    const detail = document.createElement("p");
    detail.textContent = [lot.usage, lot.visitorParking]
      .filter(Boolean)
      .join(" · ");
    content.append(detail);
  }
  if (lot.areaCount > 1) {
    const count = document.createElement("span");
    count.textContent = `同名区域共 ${lot.areaCount} 处`;
    content.append(count);
  }
  if (lot.link) {
    try {
      const url = new URL(lot.link, "https://osu.campusparc.com");
      if (url.protocol === "https:") {
        const link = document.createElement("a");
        link.href = url.toString();
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "查看官方说明 ↗";
        content.append(link);
      }
    } catch {
      // Ignore malformed GIS links instead of exposing them in the popup.
    }
  }
  return content;
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

function createSvgOverlay(
  map: MapLibreMap,
  className: string,
): SVGSVGElement {
  const overlay = document.createElementNS(SVG_NAMESPACE, "svg");
  overlay.classList.add("map-svg-overlay", className);
  overlay.setAttribute("aria-hidden", "true");
  const container = map.getCanvasContainer();
  container.insertBefore(overlay, map.getCanvas().nextSibling);
  return overlay;
}

function projectRing(
  map: MapLibreMap,
  ring: readonly unknown[],
): string {
  return ring
    .flatMap((coordinate, index) => {
      if (
        !Array.isArray(coordinate) ||
        typeof coordinate[0] !== "number" ||
        typeof coordinate[1] !== "number"
      ) {
        return [];
      }
      const point = map.project([coordinate[0], coordinate[1]]);
      return [`${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`];
    })
    .join(" ");
}

function projectGeometryPath(
  map: MapLibreMap,
  geometry: Geometry | null,
): string {
  if (!geometry) return "";
  if (geometry.type === "Polygon") {
    return geometry.coordinates
      .map((ring) => `${projectRing(map, ring)} Z`)
      .join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .flatMap((polygon) =>
        polygon.map((ring) => `${projectRing(map, ring)} Z`),
      )
      .join(" ");
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries
      .map((entry) => projectGeometryPath(map, entry))
      .join(" ");
  }
  return "";
}

function projectLine(
  map: MapLibreMap,
  coordinates: readonly [number, number][],
): string {
  return coordinates
    .map((coordinate, index) => {
      const point = map.project(coordinate);
      return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    })
    .join(" ");
}

function parkingMarkerElement(location: ParkingLocation, selected: boolean) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `parking-map-marker level-${occupancyLevel(
    location.UsePercentage,
  )}${selected ? " is-selected" : ""}${location.Closed ? " is-closed" : ""}`;
  element.setAttribute(
    "aria-label",
    `${location.GarageName}，${location.available} 个估算空位`,
  );

  const icon = document.createElement("span");
  icon.className = "parking-map-marker__icon";
  icon.innerHTML =
    location.kind === "surface"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h6a5 5 0 0 1 0 10H9v8H7V3Zm2 2v6h4a3 3 0 1 0 0-6H9Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18h-2v-2H6v2H4V3Zm2 2v3h12V5H6Zm0 5v7h12v-7H6Zm2 2h3v3H8v-3Z"/></svg>';

  const count = document.createElement("span");
  count.className = "parking-map-marker__count";
  count.textContent = location.Closed ? "关" : String(location.available);
  element.append(icon, count);
  return element;
}

function routeLabelMarkerElement(
  route: TransitRoute,
  directionSummary?: string,
) {
  const element = document.createElement("div");
  element.className = "cabs-route-map-label";
  element.style.setProperty("--route-color", route.color);
  const code = document.createElement("b");
  code.textContent = route.code;
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = route.name;
  copy.append(name);
  if (directionSummary) {
    const direction = document.createElement("small");
    direction.textContent = directionSummary;
    copy.append(direction);
  }
  element.append(code, copy);
  return element;
}

function patternDirectionLabel(direction?: string) {
  const normalized = direction?.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  if (["circular", "circle", "loop"].includes(normalized)) return "循环线";
  if (["ib", "inbound"].includes(normalized)) return "进校方向";
  if (["ob", "outbound"].includes(normalized)) return "出校方向";
  if (["nb", "northbound"].includes(normalized)) return "北行";
  if (["sb", "southbound"].includes(normalized)) return "南行";
  if (["eb", "eastbound"].includes(normalized)) return "东行";
  if (["wb", "westbound"].includes(normalized)) return "西行";
  return undefined;
}

function vehicleMarkerElement(
  routeCode: string,
  color: string,
  heading?: number,
  delayed = false,
) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `transit-map-marker${delayed ? " is-delayed" : ""}`;
  element.style.setProperty("--route-color", color);
  element.setAttribute("aria-label", `${routeCode} 线路公交`);
  element.setAttribute("aria-haspopup", "dialog");

  const bus = document.createElement("span");
  bus.className = "transit-map-marker__bus";
  bus.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2h-1v2h-2v-2H8v2H6v-2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v5h14V6a1 1 0 0 0-1-1H6Zm1 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>';
  const code = document.createElement("b");
  code.textContent = routeCode;
  element.append(bus, code);
  if (typeof heading === "number" && Number.isFinite(heading)) {
    const direction = document.createElement("i");
    direction.className = "transit-map-marker__direction";
    direction.style.transform = `rotate(${heading}deg)`;
    direction.textContent = "▲";
    element.append(direction);
  }
  return element;
}

function updateVehicleMarkerElement(
  element: HTMLElement,
  routeCode: string,
  color: string,
  heading?: number,
  delayed = false,
) {
  element.style.setProperty("--route-color", color);
  element.classList.toggle("is-delayed", delayed);
  element.setAttribute("aria-label", `${routeCode} 线路公交`);
  const code = element.querySelector("b");
  if (code) code.textContent = routeCode;

  const currentDirection = element.querySelector<HTMLElement>(
    ".transit-map-marker__direction",
  );
  if (typeof heading === "number" && Number.isFinite(heading)) {
    const direction = currentDirection ?? document.createElement("i");
    direction.className = "transit-map-marker__direction";
    direction.style.transform = `rotate(${heading}deg)`;
    direction.textContent = "▲";
    if (!currentDirection) element.append(direction);
  } else {
    currentDirection?.remove();
  }
}

function transitPopupElement(
  vehicle: TransitVehicle,
  route?: TransitRoute,
) {
  const content = document.createElement("div");
  content.className = "map-info-popup map-info-popup--transit";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = `${vehicle.routeCode} · 实时车辆`;
  const title = document.createElement("strong");
  title.textContent = route?.name ?? "CABS 校园公交";
  const destination = document.createElement("p");
  destination.textContent = vehicle.destination || "当前线路运行中";
  content.append(eyebrow, title, destination);

  const facts = document.createElement("div");
  if (typeof vehicle.speed === "number") {
    const speed = document.createElement("span");
    speed.textContent = `速度 ${Math.round(vehicle.speed)} mph`;
    facts.append(speed);
  }
  if (vehicle.delayed) {
    const delay = document.createElement("span");
    delay.className = "is-warning";
    delay.textContent = "可能延误";
    facts.append(delay);
  }
  if (vehicle.updated) {
    const updated = new Date(vehicle.updated);
    if (!Number.isNaN(updated.getTime())) {
      const time = document.createElement("span");
      time.textContent = `更新 ${updated.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
      })} ET`;
      facts.append(time);
    }
  }
  if (facts.childElementCount) content.append(facts);
  return content;
}

function evMarkerElement(station: EvStation) {
  const element = document.createElement("button");
  element.type = "button";
  const isTeslaSupercharger =
    station.networkKind === "tesla-supercharger";
  element.className = `ev-map-marker${isTeslaSupercharger ? " is-tesla" : " is-third-party"}`;
  element.setAttribute(
    "aria-label",
    `${station.name}，${station.capacity ?? "未知数量"} 个充电端口`,
  );
  element.setAttribute("aria-haspopup", "dialog");
  if (isTeslaSupercharger) {
    const logo = document.createElement("b");
    logo.textContent = "T";
    element.append(logo);
  } else {
    element.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 11h5l-1 9 8-12h-5V2Z"/></svg>';
  }
  return element;
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

function evStationPopupElement(station: EvStation) {
  const content = document.createElement("div");
  content.className = "map-info-popup map-info-popup--ev";

  const eyebrow = document.createElement("small");
  eyebrow.textContent =
    station.networkKind === "tesla-supercharger"
      ? "TESLA SUPERCHARGER"
      : `${station.operator ?? "PUBLIC EV"} · DC FAST`;
  const title = document.createElement("strong");
  title.textContent = station.name;
  content.append(eyebrow, title);

  const availability = document.createElement("section");
  availability.className = "ev-popup-availability";
  const availabilityValue = document.createElement("strong");
  if (
    station.availabilityIsRealtime &&
    typeof station.availablePorts === "number" &&
    Number.isFinite(station.availablePorts) &&
    typeof station.capacity === "number" &&
    Number.isFinite(station.capacity) &&
    station.capacity > 0
  ) {
    const availablePorts = Math.min(
      station.capacity,
      Math.max(0, station.availablePorts),
    );
    const occupied = station.capacity - availablePorts;
    const percent = Math.round((occupied / station.capacity) * 100);
    availabilityValue.textContent = `${availablePorts} / ${station.capacity} 可用`;
    const occupancy = document.createElement("span");
    const availabilityUpdate = formatEvAvailabilityUpdate(
      station.availabilityUpdatedAt,
    );
    occupancy.textContent = [
      `占用 ${percent}%`,
      availabilityUpdate ? `更新 ${availabilityUpdate}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    availability.append(availabilityValue, occupancy);
  } else {
    availabilityValue.textContent = station.capacity
      ? `${station.capacity} 个快充端口`
      : "端口数量未公开";
    const status = document.createElement("span");
    status.textContent =
      station.availabilityIsRealtime
        ? "实时端口状态暂不可用"
        : station.status === "operational"
          ? "站点运营中 · 非实时端口状态"
          : "请在运营商应用确认";
    availability.append(availabilityValue, status);
  }
  content.append(availability);

  if (station.connectors.length > 0) {
    const connectors = document.createElement("div");
    connectors.className = "ev-popup-connectors";
    station.connectors.forEach((connector) => {
      const chip = document.createElement("span");
      const connectorName =
        connector.type === "other" ? "接口未公开" : connector.type;
      chip.textContent = [
        connectorName,
        connector.count
          ? `× ${connector.count} 端口`
          : connector.type === "other"
            ? undefined
            : "支持接口",
        connector.powerKw ? `最高 ${connector.powerKw} kW` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      connectors.append(chip);
    });
    content.append(connectors);
  }

  const facts = document.createElement("dl");
  const addFact = (label: string, value?: string) => {
    if (!value) return;
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    row.append(term, detail);
    facts.append(row);
  };
  addFact("价格", station.pricing ?? "运营商未公开；以 App/现场为准");
  addFact("开放", station.hours);
  addFact("地址", station.address);
  addFact("限制", station.accessNote);
  if (facts.childElementCount) content.append(facts);

  const source =
    station.sources.find(
      (candidate) =>
        candidate.label.includes("Tesla") ||
        candidate.label.includes("Ohio State"),
    ) ?? station.sources[0];
  if (source) {
    const footer = document.createElement("footer");
    const updated = document.createElement("span");
    updated.textContent = station.updatedAt
      ? `数据更新 ${station.updatedAt.slice(0, 10)}`
      : "可追溯站点资料";
    footer.append(updated);
    try {
      const url = new URL(source.url);
      if (url.protocol === "https:") {
        const link = document.createElement("a");
        link.href = url.toString();
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = `${source.label} ↗`;
        footer.append(link);
      }
    } catch {
      // A bad upstream source URL must not become an interactive link.
    }
    content.append(footer);
  }
  return content;
}

export default function CampusMap({
  variant = "default",
  locations = [],
  selectedId,
  onSelect,
  transitFeed = EMPTY_TRANSIT_FEED,
  activeRoutes = [],
  showTransit = false,
  evStations = [],
  showEv = false,
  permitAreas,
  showPermitAreas = true,
  expandedPermitZones = [],
  onTogglePermitZone,
  className,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const parkingMarkersRef = useRef<Marker[]>([]);
  const permitMarkersRef = useRef<Marker[]>([]);
  const permitLotMarkersRef = useRef<Marker[]>([]);
  const transitMarkersRef = useRef<Map<string, Marker>>(new Map());
  const transitRouteMarkersRef = useRef<Marker[]>([]);
  const evMarkersRef = useRef<Marker[]>([]);
  const isPermitPreview = variant === "permit-preview";
  const expandedPermitZoneKey = [...expandedPermitZones].sort().join(",");

  const routeColors = useMemo(
    () =>
      Object.fromEntries(
        transitFeed.routes.map((route) => [route.code, route.color]),
      ),
    [transitFeed.routes],
  );
  const routesByCode = useMemo(
    () =>
      Object.fromEntries(
        transitFeed.routes.map((route) => [route.code, route]),
      ),
    [transitFeed.routes],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: CAMPUS_CENTER,
      zoom: 13.25,
      minZoom: 11,
      maxZoom: 19,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );
    if (!isPermitPreview) {
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
        }),
        "bottom-right",
      );
    }

    mapRef.current = map;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [isPermitPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !showPermitAreas ||
      permitAreas.features.length === 0
    ) {
      return;
    }

    const overlay = createSvgOverlay(map, "permit-area-svg-overlay");
    let frame = 0;
    const redraw = () => {
      frame = 0;
      const container = map.getCanvasContainer();
      const width = container.clientWidth;
      const height = container.clientHeight;
      overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const fragment = document.createDocumentFragment();

      const expanded = new Set(expandedPermitZones);
      permitAreas.features.forEach((feature) => {
        const code =
          typeof feature.properties?.Permit === "string"
            ? feature.properties.Permit
            : "";
        const meta = getPermitZoneMeta(code);
        const pathData = projectGeometryPath(map, feature.geometry);
        if (!meta || !pathData) return;

        const path = document.createElementNS(SVG_NAMESPACE, "path");
        path.setAttribute("d", pathData);
        path.setAttribute("fill", meta.color);
        path.setAttribute(
          "fill-opacity",
          expanded.size === 0
            ? isPermitPreview
              ? "0.3"
              : "0.21"
            : expanded.has(code.toUpperCase())
              ? "0.34"
              : "0.1",
        );
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("stroke", meta.outlineColor);
        path.setAttribute("stroke-opacity", "0.86");
        path.setAttribute("stroke-width", isPermitPreview ? "2" : "1.4");
        path.setAttribute("stroke-linejoin", "round");
        fragment.append(path);
      });

      overlay.replaceChildren(fragment);
    };
    const scheduleRedraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(redraw);
    };

    redraw();
    map.on("move", scheduleRedraw);
    map.on("resize", scheduleRedraw);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      map.off("move", scheduleRedraw);
      map.off("resize", scheduleRedraw);
      overlay.remove();
    };
  }, [
    expandedPermitZoneKey,
    expandedPermitZones,
    isPermitPreview,
    permitAreas,
    showPermitAreas,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    permitMarkersRef.current.forEach((marker) => marker.remove());
    permitMarkersRef.current = [];
    if (!showPermitAreas || permitAreas.features.length === 0) return;

    const expanded = new Set(expandedPermitZones);
    permitMarkersRef.current = getPermitZoneRepresentatives(permitAreas).map(
      ({ meta, coordinates, areaCount }) => {
        const element = permitZoneMarkerElement(
          meta.code,
          meta.shortNameZh,
          meta.color,
          areaCount,
          expanded.has(meta.code),
          onTogglePermitZone,
        );
        element.addEventListener("click", () => {
          map.easeTo({
            center: coordinates,
            zoom: Math.max(map.getZoom(), 14.6),
            duration: 550,
          });
        });
        return new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(coordinates)
          .addTo(map);
      },
    );

    return () => {
      permitMarkersRef.current.forEach((marker) => marker.remove());
      permitMarkersRef.current = [];
    };
  }, [
    expandedPermitZoneKey,
    expandedPermitZones,
    onTogglePermitZone,
    permitAreas,
    showPermitAreas,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    permitLotMarkersRef.current.forEach((marker) => marker.remove());
    permitLotMarkersRef.current = [];
    if (
      !showPermitAreas ||
      expandedPermitZones.length === 0 ||
      permitAreas.features.length === 0
    ) {
      return;
    }

    const expanded = new Set(expandedPermitZones);
    permitLotMarkersRef.current = getPermitLotRepresentatives(permitAreas)
      .filter((lot) => expanded.has(lot.code))
      .map((lot) => {
        const meta = getPermitZoneMeta(lot.code);
        if (!meta) return undefined;
        const element = permitLotMarkerElement(lot, meta.color);
        const popup = new maplibregl.Popup({
          offset: 16,
          closeButton: false,
          maxWidth: "270px",
        }).setDOMContent(permitLotPopupElement(lot));
        return new maplibregl.Marker({ element, anchor: "bottom" })
          .setLngLat(lot.coordinates)
          .setPopup(popup)
          .addTo(map);
      })
      .filter((marker): marker is Marker => Boolean(marker));

    return () => {
      permitLotMarkersRef.current.forEach((marker) => marker.remove());
      permitLotMarkersRef.current = [];
    };
  }, [
    expandedPermitZoneKey,
    expandedPermitZones,
    permitAreas,
    showPermitAreas,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    parkingMarkersRef.current.forEach((marker) => marker.remove());
    parkingMarkersRef.current = [];
    if (isPermitPreview) return;

    parkingMarkersRef.current = locations.map((location) => {
      const element = parkingMarkerElement(
        location,
        location.GarageId === selectedId,
      );
      element.addEventListener("click", () => onSelect?.(location.GarageId));
      return new maplibregl.Marker({
        element,
        anchor: "bottom",
      })
        .setLngLat([location.longitude, location.latitude])
        .addTo(map);
    });

    return () => {
      parkingMarkersRef.current.forEach((marker) => marker.remove());
      parkingMarkersRef.current = [];
    };
  }, [isPermitPreview, locations, onSelect, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = locations.find(
      (location) => location.GarageId === selectedId,
    );
    if (!map || !selected || isPermitPreview) return;
    map.easeTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(map.getZoom(), 14.4),
      duration: 700,
      offset: [0, -60],
    });
  }, [isPermitPreview, locations, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showPermitAreas || permitAreas.features.length === 0) return;

    const bounds = getPermitAreaBounds(permitAreas);
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: isPermitPreview
        ? 30
        : { top: 82, right: 86, bottom: 70, left: 86 },
      maxZoom: isPermitPreview ? 16 : 14.7,
      duration: 450,
    });
  }, [isPermitPreview, permitAreas, showPermitAreas]);

  useEffect(() => {
    const map = mapRef.current;
    transitRouteMarkersRef.current.forEach((marker) => marker.remove());
    transitRouteMarkersRef.current = [];
    if (!map || isPermitPreview || !showTransit) return;

    const routes = activeRoutes.flatMap((code) => {
      const detail = transitFeed.details[code];
      if (!detail) return [];
      return detail.patterns.flatMap((pattern) => {
        const coordinates = decodePolyline(pattern.encodedPolyline);
        return coordinates.length > 1
          ? [
              {
                code,
                color: routeColors[code] ?? "#6b7280",
                coordinates,
                direction: pattern.direction,
              },
            ]
          : [];
      });
    });
    if (routes.length === 0) return;

    const overlay = createSvgOverlay(map, "cabs-route-svg-overlay");
    let frame = 0;
    const redraw = () => {
      frame = 0;
      const container = map.getCanvasContainer();
      overlay.setAttribute(
        "viewBox",
        `0 0 ${container.clientWidth} ${container.clientHeight}`,
      );
      const fragment = document.createDocumentFragment();

      routes.forEach((route) => {
        const pathData = projectLine(map, route.coordinates);
        if (!pathData) return;

        const halo = document.createElementNS(SVG_NAMESPACE, "path");
        halo.setAttribute("d", pathData);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", "#ffffff");
        halo.setAttribute("stroke-opacity", "0.86");
        halo.setAttribute("stroke-width", "7");
        halo.setAttribute("stroke-linecap", "round");
        halo.setAttribute("stroke-linejoin", "round");
        halo.setAttribute("vector-effect", "non-scaling-stroke");

        const line = document.createElementNS(SVG_NAMESPACE, "path");
        line.setAttribute("d", pathData);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", route.color);
        line.setAttribute("stroke-opacity", "0.94");
        line.setAttribute("stroke-width", "4");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("stroke-linejoin", "round");
        line.setAttribute("vector-effect", "non-scaling-stroke");
        fragment.append(halo, line);
      });

      overlay.replaceChildren(fragment);
    };
    const scheduleRedraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(redraw);
    };

    redraw();
    const labelRoutes = Array.from(
      routes.reduce((grouped, route) => {
        const current = grouped.get(route.code);
        if (!current || route.coordinates.length > current.coordinates.length) {
          grouped.set(route.code, route);
        }
        return grouped;
      }, new Map<string, (typeof routes)[number]>()),
    ).map(([, route]) => route);

    transitRouteMarkersRef.current = labelRoutes.flatMap((route) => {
      const routeMeta = routesByCode[route.code];
      if (!routeMeta || route.coordinates.length < 2) return [];
      const middle = route.coordinates[Math.floor(route.coordinates.length / 2)];
      const element = routeLabelMarkerElement(
        routeMeta,
        patternDirectionLabel(route.direction),
      );
      return [
        new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(middle)
          .addTo(map),
      ];
    });

    const fitTimer = window.setTimeout(() => {
      const bounds = new maplibregl.LngLatBounds();
      routes.forEach((route) =>
        route.coordinates.forEach((coordinate) => bounds.extend(coordinate)),
      );
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 86, right: 72, bottom: 76, left: 72 },
          maxZoom: 14.2,
          duration: 600,
        });
      }
    }, 650);
    map.on("move", scheduleRedraw);
    map.on("resize", scheduleRedraw);
    return () => {
      window.clearTimeout(fitTimer);
      if (frame) window.cancelAnimationFrame(frame);
      map.off("move", scheduleRedraw);
      map.off("resize", scheduleRedraw);
      overlay.remove();
      transitRouteMarkersRef.current.forEach((marker) => marker.remove());
      transitRouteMarkersRef.current = [];
    };
  }, [
    activeRoutes,
    isPermitPreview,
    routeColors,
    routesByCode,
    showTransit,
    transitFeed.details,
  ]);

  useEffect(() => {
    const markers = transitMarkersRef.current;
    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
    };
  }, [isPermitPreview]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = transitMarkersRef.current;
    if (!map || !showTransit || isPermitPreview) {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      return;
    }

    const visibleVehicles = transitFeed.vehicles.filter(
      (vehicle) =>
        activeRoutes.includes(vehicle.routeCode) &&
        Number.isFinite(vehicle.latitude) &&
        Number.isFinite(vehicle.longitude),
    );
    const visibleKeys = new Set<string>();

    visibleVehicles.forEach((vehicle) => {
      const key = `${vehicle.routeCode}:${vehicle.id}`;
      const color = routeColors[vehicle.routeCode] ?? "#334155";
      visibleKeys.add(key);

      let marker = markers.get(key);
      if (!marker) {
        const element = vehicleMarkerElement(
          vehicle.routeCode,
          color,
          vehicle.heading,
          vehicle.delayed,
        );
        marker = new maplibregl.Marker({ element })
          .setLngLat([vehicle.longitude, vehicle.latitude])
          .setPopup(
            new maplibregl.Popup({
              offset: 20,
              closeButton: false,
              maxWidth: "280px",
            }).setDOMContent(
              transitPopupElement(vehicle, routesByCode[vehicle.routeCode]),
            ),
          )
          .addTo(map);
        markers.set(key, marker);
        return;
      }

      marker.setLngLat([vehicle.longitude, vehicle.latitude]);
      updateVehicleMarkerElement(
        marker.getElement(),
        vehicle.routeCode,
        color,
        vehicle.heading,
        vehicle.delayed,
      );
      marker
        .getPopup()
        ?.setDOMContent(
          transitPopupElement(vehicle, routesByCode[vehicle.routeCode]),
        );
    });

    markers.forEach((marker, key) => {
      if (visibleKeys.has(key)) return;
      marker.remove();
      markers.delete(key);
    });
  }, [
    activeRoutes,
    isPermitPreview,
    routeColors,
    routesByCode,
    showTransit,
    transitFeed.vehicles,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    evMarkersRef.current.forEach((marker) => marker.remove());
    evMarkersRef.current = [];
    if (!showEv || isPermitPreview) return;

    evMarkersRef.current = evStations.map((station) => {
      const element = evMarkerElement(station);
      return new maplibregl.Marker({ element })
        .setLngLat([station.longitude, station.latitude])
        .setPopup(
          new maplibregl.Popup({
            offset: 20,
            closeButton: false,
            maxWidth: "320px",
          }).setDOMContent(evStationPopupElement(station)),
        )
        .addTo(map);
    });

    return () => {
      evMarkersRef.current.forEach((marker) => marker.remove());
      evMarkersRef.current = [];
    };
  }, [evStations, isPermitPreview, showEv]);

  return (
    <div
      ref={containerRef}
      className={className}
      tabIndex={0}
      role="region"
      aria-label={
        isPermitPreview
          ? "所选停车证当前可用停车区域预览"
          : "OSU 校园停车与公交实时地图"
      }
    />
  );
}
