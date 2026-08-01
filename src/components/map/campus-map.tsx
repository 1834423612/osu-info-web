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
import type { TransitFeed } from "@/types/transit";

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

    return [{ meta, coordinates: representative.coordinates }];
  });
}

function permitZoneMarkerElement(
  code: string,
  shortNameZh: string,
  color: string,
) {
  const element = document.createElement("div");
  element.className = "permit-ticket-map-marker";
  element.style.setProperty("--permit-zone-color", color);
  element.setAttribute("aria-label", `${code} 停车证区域，${shortNameZh}`);
  element.innerHTML = `
    <span class="permit-ticket-map-marker__code">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V9a3 3 0 0 0 0 6v3.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V15a3 3 0 0 0 0-6V5.5Z"/></svg>
      <b>${code}</b>
    </span>
    <span class="permit-ticket-map-marker__name">${shortNameZh}</span>
  `;
  return element;
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

function vehicleMarkerElement(routeCode: string, color: string, heading = 0) {
  const element = document.createElement("div");
  element.className = "transit-map-marker";
  element.style.setProperty("--route-color", color);
  element.setAttribute("aria-label", `${routeCode} 线路公交`);
  element.innerHTML = `<span style="transform: rotate(${heading}deg)">▲</span><b>${routeCode}</b>`;
  return element;
}

function evMarkerElement(station: EvStation) {
  const element = document.createElement("div");
  element.className = `ev-map-marker${station.isTesla ? " is-fast" : ""}`;
  element.setAttribute("aria-label", station.name);
  element.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 11h5l-1 9 8-12h-5V2Z"/></svg>';
  return element;
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
  className,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const parkingMarkersRef = useRef<Marker[]>([]);
  const permitMarkersRef = useRef<Marker[]>([]);
  const transitMarkersRef = useRef<Marker[]>([]);
  const evMarkersRef = useRef<Marker[]>([]);
  const isPermitPreview = variant === "permit-preview";

  const routeColors = useMemo(
    () =>
      Object.fromEntries(
        transitFeed.routes.map((route) => [route.code, route.color]),
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
        path.setAttribute("fill-opacity", isPermitPreview ? "0.3" : "0.21");
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
  }, [isPermitPreview, permitAreas, showPermitAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    permitMarkersRef.current.forEach((marker) => marker.remove());
    permitMarkersRef.current = [];
    if (!showPermitAreas || permitAreas.features.length === 0) return;

    permitMarkersRef.current = getPermitZoneRepresentatives(permitAreas).map(
      ({ meta, coordinates }) => {
        const element = permitZoneMarkerElement(
          meta.code,
          meta.shortNameZh,
          meta.color,
        );
        return new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(coordinates)
          .addTo(map);
      },
    );

    return () => {
      permitMarkersRef.current.forEach((marker) => marker.remove());
      permitMarkersRef.current = [];
    };
  }, [permitAreas, showPermitAreas]);

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
    if (!map || !isPermitPreview || permitAreas.features.length === 0) return;

    const bounds = getPermitAreaBounds(permitAreas);
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: 30,
      maxZoom: 16,
      duration: 450,
    });
  }, [isPermitPreview, permitAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isPermitPreview || !showTransit) return;

    const routes = activeRoutes.flatMap((code) => {
      const detail = transitFeed.details[code];
      if (!detail) return [];
      return detail.patterns.flatMap((pattern) => {
        const coordinates = decodePolyline(pattern.encodedPolyline);
        return coordinates.length > 1
          ? [
              {
                color: routeColors[code] ?? "#6b7280",
                coordinates,
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

        const line = document.createElementNS(SVG_NAMESPACE, "path");
        line.setAttribute("d", pathData);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", route.color);
        line.setAttribute("stroke-opacity", "0.84");
        line.setAttribute("stroke-width", "4");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("stroke-linejoin", "round");
        fragment.append(halo, line);
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
    activeRoutes,
    isPermitPreview,
    routeColors,
    showTransit,
    transitFeed.details,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    transitMarkersRef.current.forEach((marker) => marker.remove());
    transitMarkersRef.current = [];
    if (!showTransit || isPermitPreview) return;

    transitMarkersRef.current = transitFeed.vehicles
      .filter(
        (vehicle) =>
          activeRoutes.includes(vehicle.routeCode) &&
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude),
      )
      .map((vehicle) => {
        const element = vehicleMarkerElement(
          vehicle.routeCode,
          routeColors[vehicle.routeCode] ?? "#334155",
          vehicle.heading,
        );
        return new maplibregl.Marker({ element })
          .setLngLat([vehicle.longitude, vehicle.latitude])
          .setPopup(
            new maplibregl.Popup({ offset: 18 }).setHTML(
              `<strong>${vehicle.routeCode}</strong><br/>${vehicle.destination ?? "CABS 实时车辆"}`,
            ),
          )
          .addTo(map);
      });

    return () => {
      transitMarkersRef.current.forEach((marker) => marker.remove());
      transitMarkersRef.current = [];
    };
  }, [
    activeRoutes,
    isPermitPreview,
    routeColors,
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
          new maplibregl.Popup({ offset: 18 }).setHTML(
            `<strong>${station.name}</strong><br/>${station.power ?? station.operator ?? "公共充电站"}`,
          ),
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
      role="region"
      aria-label={
        isPermitPreview
          ? "所选停车证当前可用停车区域预览"
          : "OSU 校园停车与公交实时地图"
      }
    />
  );
}
