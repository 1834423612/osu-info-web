import type { Feature, FeatureCollection, LineString } from "geojson";

import { decodePolyline } from "@/lib/polyline";
import type {
  TransitFeed,
  TransitPattern,
  TransitPrediction,
  TransitRoute,
  TransitRouteDetail,
  TransitStop,
  TransitVehicle,
} from "@/types/transit";

const DEFAULT_ROUTE_COLOR = "#64748b";
const EARTH_RADIUS_METERS = 6_371_008.8;

export type TransitRouteLineProperties = {
  routeCode: string;
  routeName: string;
  patternId: string;
  color: string;
  darkColor: string;
  direction: string;
  directionLabel: string;
};

export type TransitRouteFeatureCollection = FeatureCollection<
  LineString,
  TransitRouteLineProperties
>;

export type TransitNearbyStop = TransitStop & {
  /** A nearest geographic stop is not necessarily the vehicle's current stop. */
  label: "附近站点";
  distanceMeters: number;
};

export type TransitVehicleMapInfo = {
  vehicle: TransitVehicle;
  route?: TransitRoute;
  pattern?: TransitPattern;
  routeDirection?: string;
  routeDirectionLabel?: string;
  nextStop?: TransitPrediction;
  etaSeconds?: number;
  etaMinutes?: number;
  nearestStop?: TransitNearbyStop;
  destination?: string;
};

function normalizeCode(value?: string) {
  return value?.trim().toUpperCase() ?? "";
}

function finiteNumber(value: number | string | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findRoute(feed: TransitFeed, routeCode: string) {
  const normalizedCode = normalizeCode(routeCode);
  return feed.routes.find(
    (route) => normalizeCode(route.code) === normalizedCode,
  );
}

function findRouteDetail(feed: TransitFeed, routeCode: string) {
  const direct = feed.details[routeCode];
  if (direct) return direct;

  const normalizedCode = normalizeCode(routeCode);
  return Object.values(feed.details).find(
    (detail) => normalizeCode(detail.code) === normalizedCode,
  );
}

/** Translate the direction vocabulary currently used by the CABS feed. */
export function transitDirectionLabel(direction?: string) {
  const normalized = direction?.trim().toLowerCase();
  if (!normalized) return undefined;

  if (["circular", "circle", "loop"].includes(normalized)) return "循环线";
  if (["clockwise", "cw"].includes(normalized)) return "顺时针循环";
  if (["counterclockwise", "anticlockwise", "ccw"].includes(normalized)) {
    return "逆时针循环";
  }
  if (["ib", "inbound"].includes(normalized)) return "进校方向";
  if (["ob", "outbound"].includes(normalized)) return "出校方向";
  if (["nb", "northbound", "north"].includes(normalized)) return "北行";
  if (["sb", "southbound", "south"].includes(normalized)) return "南行";
  if (["eb", "eastbound", "east"].includes(normalized)) return "东行";
  if (["wb", "westbound", "west"].includes(normalized)) return "西行";
  return undefined;
}

function decodeRenderableLine(encodedPolyline: string) {
  try {
    const coordinates = decodePolyline(encodedPolyline);
    if (
      coordinates.length < 2 ||
      coordinates.some(
        ([longitude, latitude]) =>
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          longitude < -180 ||
          longitude > 180 ||
          latitude < -90 ||
          latitude > 90,
      )
    ) {
      return undefined;
    }
    return coordinates;
  } catch {
    return undefined;
  }
}

/** Build one stable GeoJSON line feature for every active CABS pattern. */
export function buildTransitRouteFeatureCollection(
  activeRoutes: readonly string[],
  feed: TransitFeed,
): TransitRouteFeatureCollection {
  const features: Feature<LineString, TransitRouteLineProperties>[] = [];
  const seenCodes = new Set<string>();

  activeRoutes.forEach((requestedCode) => {
    const normalizedCode = normalizeCode(requestedCode);
    if (!normalizedCode || seenCodes.has(normalizedCode)) return;
    seenCodes.add(normalizedCode);

    const route = findRoute(feed, normalizedCode);
    const detail = findRouteDetail(feed, normalizedCode);
    if (!detail) return;

    const routeCode = route?.code ?? detail.code ?? normalizedCode;
    const color = route?.color || DEFAULT_ROUTE_COLOR;
    const darkColor = route?.darkColor || color;

    detail.patterns.forEach((pattern) => {
      const coordinates = decodeRenderableLine(pattern.encodedPolyline);
      if (!coordinates) return;

      features.push({
        type: "Feature",
        id: `${routeCode}:${pattern.id}`,
        properties: {
          routeCode,
          routeName: route?.name ?? routeCode,
          patternId: pattern.id,
          color,
          darkColor,
          direction: pattern.direction?.trim() ?? "",
          directionLabel: transitDirectionLabel(pattern.direction) ?? "",
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      });
    });
  });

  return { type: "FeatureCollection", features };
}

function haversineDistanceMeters(
  first: Pick<TransitStop, "latitude" | "longitude">,
  second: Pick<TransitStop, "latitude" | "longitude">,
) {
  const toRadians = Math.PI / 180;
  const firstLatitude = first.latitude * toRadians;
  const secondLatitude = second.latitude * toRadians;
  const latitudeDelta = (second.latitude - first.latitude) * toRadians;
  const longitudeDelta = (second.longitude - first.longitude) * toRadians;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const a =
    sinLatitude * sinLatitude +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      sinLongitude *
      sinLongitude;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  );
}

/**
 * Return the closest route stop, deliberately labelled only as a nearby stop.
 * Route details do not expose an ordered per-pattern stop list, so this must not
 * be presented as the vehicle's current stop.
 */
export function findNearestTransitStop(
  vehicle: Pick<TransitVehicle, "latitude" | "longitude">,
  detail?: Pick<TransitRouteDetail, "stops">,
): TransitNearbyStop | undefined {
  if (
    !detail?.stops.length ||
    !Number.isFinite(vehicle.latitude) ||
    !Number.isFinite(vehicle.longitude)
  ) {
    return undefined;
  }

  let nearest: TransitStop | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  detail.stops.forEach((stop) => {
    if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) {
      return;
    }
    const distance = haversineDistanceMeters(vehicle, stop);
    if (distance < nearestDistance) {
      nearest = stop;
      nearestDistance = distance;
    }
  });

  if (!nearest) return undefined;
  return {
    ...nearest,
    label: "附近站点",
    distanceMeters: Math.round(nearestDistance),
  };
}

function predictionEtaSeconds(prediction: TransitPrediction) {
  const seconds = finiteNumber(prediction.timeToArrivalInSeconds);
  return seconds !== undefined && seconds >= 0 ? Math.round(seconds) : undefined;
}

/** Select the earliest non-past official prediction for this vehicle. */
export function findNextTransitStop(
  vehicle: Pick<TransitVehicle, "routeCode" | "predictions">,
) {
  const routeCode = normalizeCode(vehicle.routeCode);
  const predictions = Array.isArray(vehicle.predictions)
    ? vehicle.predictions.filter(
        (prediction) =>
          !prediction.routeCode ||
          normalizeCode(prediction.routeCode) === routeCode,
      )
    : [];

  const timed = predictions
    .map((prediction, index) => ({
      prediction,
      index,
      etaSeconds: predictionEtaSeconds(prediction),
    }))
    .filter(
      (candidate): candidate is {
        prediction: TransitPrediction;
        index: number;
        etaSeconds: number;
      } => candidate.etaSeconds !== undefined,
    )
    .sort(
      (first, second) =>
        first.etaSeconds - second.etaSeconds || first.index - second.index,
    );

  if (timed[0]) return timed[0].prediction;
  return predictions.find(
    (prediction) => prediction.stopId || prediction.stopName,
  );
}

function findVehiclePattern(
  vehicle: TransitVehicle,
  detail?: TransitRouteDetail,
) {
  if (!detail?.patterns.length) return undefined;
  const declaredPatternId = vehicle.patternId?.trim();
  if (declaredPatternId) {
    const declared = detail.patterns.find(
      (pattern) => String(pattern.id) === declaredPatternId,
    );
    if (declared) return declared;
  }

  // A single available pattern is unambiguous (for example WMC Circular).
  return detail.patterns.length === 1 ? detail.patterns[0] : undefined;
}

/** Derive map-ready vehicle facts without guessing a current stop. */
export function deriveTransitVehicleMapInfo(
  vehicle: TransitVehicle,
  feed: TransitFeed,
): TransitVehicleMapInfo {
  const route = findRoute(feed, vehicle.routeCode);
  const detail = findRouteDetail(feed, vehicle.routeCode);
  const pattern = findVehiclePattern(vehicle, detail);
  const nextPrediction = findNextTransitStop(vehicle);
  const etaSeconds = nextPrediction
    ? predictionEtaSeconds(nextPrediction)
    : undefined;
  const matchingStop = nextPrediction?.stopId
    ? detail?.stops.find(
        (stop) => String(stop.id) === String(nextPrediction.stopId),
      )
    : undefined;
  const nextStop = nextPrediction
    ? {
        ...nextPrediction,
        stopName: nextPrediction.stopName || matchingStop?.name,
      }
    : undefined;

  return {
    vehicle,
    route,
    pattern,
    routeDirection: pattern?.direction,
    routeDirectionLabel: transitDirectionLabel(pattern?.direction),
    nextStop,
    etaSeconds,
    etaMinutes:
      etaSeconds === undefined ? undefined : Math.ceil(etaSeconds / 60),
    nearestStop: findNearestTransitStop(vehicle, detail),
    destination: vehicle.destination || nextStop?.destination,
  };
}

/** Derive the same stable shape for every vehicle in a feed. */
export function deriveTransitVehicleMapInfoList(feed: TransitFeed) {
  return feed.vehicles.map((vehicle) =>
    deriveTransitVehicleMapInfo(vehicle, feed),
  );
}
