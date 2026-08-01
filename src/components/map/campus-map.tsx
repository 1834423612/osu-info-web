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
import {
  buildTransitRouteFeatureCollection,
  deriveTransitVehicleMapInfo,
  transitDirectionLabel,
  type TransitVehicleMapInfo,
} from "@/lib/transit-map";
import { occupancyLevel } from "@/lib/utils";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type {
  TransitFeed,
  TransitRoute,
} from "@/types/transit";

const CAMPUS_CENTER: [number, number] = [-83.0226, 40.0035];
const PERMIT_SOURCE_ID = "campus-permit-areas";
const PERMIT_FILL_LAYER_ID = "campus-permit-areas-fill";
const PERMIT_OUTLINE_LAYER_ID = "campus-permit-areas-outline";
const CABS_SOURCE_ID = "campus-cabs-routes";
const CABS_HALO_LAYER_ID = "campus-cabs-routes-halo";
const CABS_LINE_LAYER_ID = "campus-cabs-routes-line";
const CABS_DIRECTION_LAYER_ID = "campus-cabs-routes-direction";
const CABS_DIRECTION_IMAGE_ID = "campus-cabs-direction-arrow";

const EMPTY_TRANSIT_FEED: TransitFeed = {
  routes: [],
  details: {},
  vehicles: [],
};

export type CampusMapVariant = "default" | "permit-preview";
export type ParkingMapGroupId = "garage" | "west-surface" | "buckeye";

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
  expandedParkingGroup?: ParkingMapGroupId;
  onToggleParkingGroup?: (group: ParkingMapGroupId) => void;
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
  categoryLabel = "停车证区域",
) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `permit-ticket-map-marker${expanded ? " is-expanded" : ""}`;
  element.style.setProperty("--permit-zone-color", color);
  element.setAttribute(
    "aria-label",
    `${code} ${categoryLabel}，${shortNameZh}，${areaCount} 处，${expanded ? "收起" : "展开"}具体位置`,
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

type ParkingMapGroup = {
  id: ParkingMapGroupId;
  code: string;
  nameZh: string;
  color: string;
  coordinates: [number, number];
  count: number;
};

function parkingGroupForLocation(location: ParkingLocation): ParkingMapGroupId {
  if (location.kind === "garage") return "garage";
  return location.GarageId === 3005 ? "buckeye" : "west-surface";
}

function getParkingMapGroups(locations: ParkingLocation[]): ParkingMapGroup[] {
  const definitions: Readonly<
    Record<
      ParkingMapGroupId,
      Pick<ParkingMapGroup, "code" | "nameZh" | "color">
    >
  > = {
    garage: { code: "GAR", nameZh: "实时车库", color: "#ba0c2f" },
    "west-surface": {
      code: "WEST",
      nameZh: "西校区地面",
      color: "#0891b2",
    },
    buckeye: { code: "CX", nameZh: "Buckeye Lot", color: "#7c3aed" },
  };

  return (Object.keys(definitions) as ParkingMapGroupId[]).flatMap((id) => {
    const members = locations.filter(
      (location) => parkingGroupForLocation(location) === id,
    );
    if (members.length === 0) return [];
    const mean: [number, number] = members.reduce(
      (total, location) => [
        total[0] + location.longitude / members.length,
        total[1] + location.latitude / members.length,
      ],
      [0, 0],
    );
    const representative = [...members].sort(
      (a, b) =>
        (a.longitude - mean[0]) ** 2 + (a.latitude - mean[1]) ** 2 -
        ((b.longitude - mean[0]) ** 2 + (b.latitude - mean[1]) ** 2),
    )[0];
    return [
      {
        id,
        ...definitions[id],
        coordinates: [representative.longitude, representative.latitude],
        count: members.length,
      },
    ];
  });
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

function parkingMarkerElement(location: ParkingLocation, selected: boolean) {
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
  const element = document.createElement("button");
  element.type = "button";
  element.className = `parking-map-marker occupancy-${level}${selected ? " is-selected" : ""}${location.Closed ? " is-closed" : ""}`;
  element.style.setProperty("--parking-marker-color", visual.color);
  element.style.setProperty("--parking-marker-background", visual.background);
  element.setAttribute(
    "aria-label",
    `${location.GarageName}，${visual.accessLabel}，${location.available} 个估算空位`,
  );
  element.title = `${visual.accessLabel} · ${location.available} 个估算空位`;

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

function transitPopupElement(info: TransitVehicleMapInfo) {
  const { vehicle, route } = info;
  const content = document.createElement("div");
  content.className = "map-info-popup map-info-popup--transit";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = [
    vehicle.routeCode,
    info.routeDirectionLabel,
    "实时车辆",
  ]
    .filter(Boolean)
    .join(" · ");
  const title = document.createElement("strong");
  title.textContent = route?.name ?? "CABS 校园公交";
  content.append(eyebrow, title);

  const trip = document.createElement("section");
  trip.className = "transit-popup-trip";
  const addTripRow = (
    label: string,
    value: string,
    detail?: string,
    emphasis = false,
  ) => {
    const row = document.createElement("div");
    if (emphasis) row.className = "is-next";
    const copy = document.createElement("span");
    const term = document.createElement("small");
    term.textContent = label;
    const main = document.createElement("strong");
    main.textContent = value;
    copy.append(term, main);
    row.append(copy);
    if (detail) {
      const meta = document.createElement("b");
      meta.textContent = detail;
      row.append(meta);
    }
    trip.append(row);
  };

  if (vehicle.lastStop?.trim()) {
    addTripRow("最近上报站", vehicle.lastStop.trim());
  } else if (info.nearestStop) {
    addTripRow(
      info.nearestStop.label,
      info.nearestStop.name,
      `${info.nearestStop.distanceMeters} m`,
    );
  }
  if (info.nextStop?.stopName) {
    addTripRow(
      info.nextStop.type === "departure" ? "下一次发车" : "下一站",
      info.nextStop.stopName,
      info.etaMinutes === undefined
        ? "实时预测"
        : info.etaMinutes <= 1
          ? "即将到达"
          : `${info.etaMinutes} 分钟`,
      true,
    );
  }
  addTripRow("行驶终点", info.destination || "线路运行中");
  content.append(trip);

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
  expandedParkingGroup,
  onToggleParkingGroup,
  className,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const parkingMarkersRef = useRef<Marker[]>([]);
  const parkingGroupMarkersRef = useRef<Marker[]>([]);
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
    if (!map) return;
    let active = true;
    const renderPermitAreas = () => {
      if (!active || !showPermitAreas || permitAreas.features.length === 0) {
        return;
      }
      const expanded = new Set(expandedPermitZones);
      const data: FeatureCollection = {
        type: "FeatureCollection",
        features: permitAreas.features.flatMap((feature) => {
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
                  expanded.size === 0
                    ? isPermitPreview
                      ? 0.3
                      : 0.21
                    : expanded.has(meta.code)
                      ? 0.34
                      : 0.1,
              },
            },
          ];
        }),
      };

      map.addSource(PERMIT_SOURCE_ID, { type: "geojson", data });
      const beforeId = map.getLayer(CABS_HALO_LAYER_ID)
        ? CABS_HALO_LAYER_ID
        : undefined;
      map.addLayer(
        {
          id: PERMIT_FILL_LAYER_ID,
          type: "fill",
          source: PERMIT_SOURCE_ID,
          paint: {
            "fill-color": ["get", "zoneColor"],
            "fill-opacity": ["get", "fillOpacity"],
          },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: PERMIT_OUTLINE_LAYER_ID,
          type: "line",
          source: PERMIT_SOURCE_ID,
          paint: {
            "line-color": ["get", "zoneOutline"],
            "line-opacity": 0.86,
            "line-width": isPermitPreview ? 2 : 1.4,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        },
        beforeId,
      );
    };

    if (map.isStyleLoaded()) renderPermitAreas();
    else map.once("load", renderPermitAreas);
    return () => {
      active = false;
      map.off("load", renderPermitAreas);
      removeLayerIfPresent(map, PERMIT_OUTLINE_LAYER_ID);
      removeLayerIfPresent(map, PERMIT_FILL_LAYER_ID);
      removeSourceIfPresent(map, PERMIT_SOURCE_ID);
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
    parkingGroupMarkersRef.current.forEach((marker) => marker.remove());
    parkingGroupMarkersRef.current = [];
    if (isPermitPreview || locations.length === 0) return;

    parkingGroupMarkersRef.current = getParkingMapGroups(locations).map(
      (group) => {
        const expanded = expandedParkingGroup === group.id;
        const element = permitZoneMarkerElement(
          group.code,
          group.nameZh,
          group.color,
          group.count,
          expanded,
          () => onToggleParkingGroup?.(group.id),
          "停车分类",
        );
        element.addEventListener("click", () => {
          map.easeTo({
            center: group.coordinates,
            zoom: Math.max(map.getZoom(), expanded ? 13.7 : 14.5),
            duration: 500,
          });
        });
        return new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(group.coordinates)
          .addTo(map);
      },
    );

    return () => {
      parkingGroupMarkersRef.current.forEach((marker) => marker.remove());
      parkingGroupMarkersRef.current = [];
    };
  }, [
    expandedParkingGroup,
    isPermitPreview,
    locations,
    onToggleParkingGroup,
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

    const visibleLocations = locations.filter(
      (location) =>
        parkingGroupForLocation(location) === expandedParkingGroup ||
        location.GarageId === selectedId,
    );
    parkingMarkersRef.current = visibleLocations.map((location) => {
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
  }, [
    expandedParkingGroup,
    isPermitPreview,
    locations,
    onSelect,
    selectedId,
  ]);

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

    const routeData = buildTransitRouteFeatureCollection(
      activeRoutes,
      transitFeed,
    );
    const routes = routeData.features.map((feature) => ({
      code: feature.properties.routeCode,
      color: feature.properties.color,
      coordinates: feature.geometry.coordinates as [number, number][],
      direction: feature.properties.direction,
    }));
    if (routes.length === 0) return;

    let active = true;
    const renderRoutes = () => {
      if (!active) return;
      if (!map.hasImage(CABS_DIRECTION_IMAGE_ID)) {
        map.addImage(CABS_DIRECTION_IMAGE_ID, createDirectionArrowImage());
      }
      map.addSource(CABS_SOURCE_ID, { type: "geojson", data: routeData });
      map.addLayer({
        id: CABS_HALO_LAYER_ID,
        type: "line",
        source: CABS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.88,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 8],
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
        transitDirectionLabel(route.direction),
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
    return () => {
      active = false;
      window.clearTimeout(fitTimer);
      map.off("load", renderRoutes);
      removeLayerIfPresent(map, CABS_DIRECTION_LAYER_ID);
      removeLayerIfPresent(map, CABS_LINE_LAYER_ID);
      removeLayerIfPresent(map, CABS_HALO_LAYER_ID);
      removeSourceIfPresent(map, CABS_SOURCE_ID);
      transitRouteMarkersRef.current.forEach((marker) => marker.remove());
      transitRouteMarkersRef.current = [];
    };
  }, [
    activeRoutes,
    isPermitPreview,
    routesByCode,
    showTransit,
    transitFeed,
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
        marker = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat([vehicle.longitude, vehicle.latitude])
          .setPopup(
            new maplibregl.Popup({
              offset: 20,
              closeButton: false,
              maxWidth: "280px",
            }).setDOMContent(
              transitPopupElement(
                deriveTransitVehicleMapInfo(vehicle, transitFeed),
              ),
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
          transitPopupElement(
            deriveTransitVehicleMapInfo(vehicle, transitFeed),
          ),
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
    showTransit,
    transitFeed,
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
