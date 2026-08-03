import type { Feature, FeatureCollection, LineString, Point } from "geojson";

import { decodePolyline } from "@/lib/polyline";
import type {
  TransitFeed,
  TransitPattern,
  TransitPatternStop,
  TransitPrediction,
  TransitRoute,
  TransitRouteDetail,
  TransitStationBoardStop,
  TransitStop,
  TransitVehicle,
} from "@/types/transit";

const DEFAULT_ROUTE_COLOR = "#64748b";
const EARTH_RADIUS_METERS = 6_371_008.8;

export type TransitRouteLineProperties = {
  routeCode: string;
  routeName: string;
  patternId: string;
  patternIndex: number;
  patternCount: number;
  color: string;
  darkColor: string;
  displayColor: string;
  emphasized: boolean;
  direction: string;
  directionLabel: string;
  startStopName: string;
  endStopName: string;
};

export type TransitRouteFeatureCollection = FeatureCollection<
  LineString,
  TransitRouteLineProperties
>;

export type TransitRouteEndpointProperties = {
  routeCode: string;
  patternId: string;
  patternIndex: number;
  endpoint: "start" | "end";
  endpointLabel: "起" | "终";
  stopName: string;
  directionLabel: string;
  color: string;
};

export type TransitRouteEndpointFeatureCollection = FeatureCollection<
  Point,
  TransitRouteEndpointProperties
>;

export type TransitNearbyStop = TransitStop & {
  /** A nearest geographic stop is not necessarily the vehicle's current stop. */
  label: "附近站点";
  distanceMeters: number;
};

export type TransitVehicleMapInfo = {
  vehicle: TransitVehicle;
  vehicleLabel: string;
  route?: TransitRoute;
  pattern?: TransitPattern;
  routeDirection?: string;
  routeDirectionLabel?: string;
  nextStop?: TransitPrediction;
  etaSeconds?: number;
  etaMinutes?: number;
  nearestStop?: TransitNearbyStop;
  lastReportedStop?: TransitStop;
  upcomingStops: TransitStationBoardStop[];
  terminalStop?: Pick<TransitStationBoardStop, "id" | "name">;
  destination?: string;
};

export type TransitPatternOverview = {
  pattern: TransitPattern;
  directionLabel: string;
  stops: TransitPatternStop[];
  terminalStop?: TransitPatternStop;
};

export type TransitRouteOverview = {
  route: TransitRoute;
  detail?: TransitRouteDetail;
  patterns: TransitPatternOverview[];
  vehicles: TransitVehicleMapInfo[];
  vehicleCount: number;
  operating: boolean;
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
  // CABS uses IB/OB as internal pattern names. “上行/下行” is shorter and
  // avoids implying that every IB pattern literally crosses a campus gate.
  if (["ib", "inbound"].includes(normalized)) return "上行";
  if (["ob", "outbound"].includes(normalized)) return "下行";
  if (["nb", "northbound", "north"].includes(normalized)) return "北行";
  if (["sb", "southbound", "south"].includes(normalized)) return "南行";
  if (["eb", "eastbound", "east"].includes(normalized)) return "东行";
  if (["wb", "westbound", "west"].includes(normalized)) return "西行";
  return undefined;
}

export function compactTransitStopName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
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

/** Prefer a concrete terminus over the feed's terse IB/OB vocabulary. */
export function transitPatternDirectionLabel(
  pattern: TransitPattern,
  stops: readonly TransitStop[],
) {
  const generic = transitDirectionLabel(pattern.direction);
  if (generic?.includes("循环")) return generic;

  const terminal = estimateTransitPatternStopSequence(pattern, stops).at(-1);
  const terminalName = terminal && compactTransitStopName(terminal.name);
  return terminalName ? `开往 ${terminalName}` : (generic ?? "线路方向");
}

/** Build one stable GeoJSON line feature for every active CABS pattern. */
export function buildTransitRouteFeatureCollection(
  activeRoutes: readonly string[],
  feed: TransitFeed,
  selectedRoute?: string,
): TransitRouteFeatureCollection {
  const features: Feature<LineString, TransitRouteLineProperties>[] = [];
  const seenCodes = new Set<string>();
  const normalizedSelectedRoute = normalizeCode(selectedRoute);

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

    detail.patterns.forEach((pattern, patternIndex) => {
      const coordinates = decodeRenderableLine(pattern.encodedPolyline);
      if (!coordinates) return;

      const patternStops = estimateTransitPatternStopSequence(
        pattern,
        detail.stops,
      );
      const directionLabel = transitPatternDirectionLabel(
        pattern,
        detail.stops,
      );
      const startStopName = compactTransitStopName(
        patternStops.at(0)?.name ?? "线路起点",
      );
      const endStopName = compactTransitStopName(
        patternStops.at(-1)?.name ?? "线路终点",
      );

      features.push({
        type: "Feature",
        id: `${routeCode}:${pattern.id || patternIndex}`,
        properties: {
          routeCode,
          routeName: route?.name ?? routeCode,
          patternId: pattern.id,
          patternIndex,
          patternCount: detail.patterns.length,
          color,
          darkColor,
          displayColor: patternIndex % 2 === 0 ? color : darkColor,
          emphasized:
            Boolean(normalizedSelectedRoute) &&
            normalizeCode(routeCode) === normalizedSelectedRoute,
          direction: pattern.direction?.trim() ?? "",
          directionLabel,
          startStopName,
          endStopName,
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

/**
 * Mark the two ends of every official pattern for the selected route. These
 * points are derived from the complete encoded polyline, never from a
 * vehicle's remaining prediction list, so a route stays understandable even
 * when there are no buses online.
 */
export function buildTransitRouteEndpointFeatureCollection(
  routeData?: TransitRouteFeatureCollection,
): TransitRouteEndpointFeatureCollection {
  const features: Feature<Point, TransitRouteEndpointProperties>[] = [];

  routeData?.features.forEach((feature) => {
    const coordinates = feature.geometry.coordinates;
    const start = coordinates.at(0);
    const end = coordinates.at(-1);
    if (!start || !end) return;

    const shared = {
      routeCode: feature.properties.routeCode,
      patternId: feature.properties.patternId,
      patternIndex: feature.properties.patternIndex,
      directionLabel: feature.properties.directionLabel,
      color: feature.properties.displayColor,
    };

    features.push(
      {
        type: "Feature",
        id: `${feature.properties.routeCode}:${feature.properties.patternId}:start`,
        properties: {
          ...shared,
          endpoint: "start",
          endpointLabel: "起",
          stopName: feature.properties.startStopName,
        },
        geometry: { type: "Point", coordinates: start },
      },
      {
        type: "Feature",
        id: `${feature.properties.routeCode}:${feature.properties.patternId}:end`,
        properties: {
          ...shared,
          endpoint: "end",
          endpointLabel: "终",
          stopName: feature.properties.endStopName,
        },
        geometry: { type: "Point", coordinates: end },
      },
    );
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

type LineProjection = {
  distanceAlongRouteMeters: number;
  distanceToRouteMeters: number;
};

function projectStopOntoLine(
  stop: TransitStop,
  coordinates: readonly [number, number][],
): LineProjection | undefined {
  if (coordinates.length < 2) return undefined;

  let best: LineProjection | undefined;
  let traversedMeters = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const [startLongitude, startLatitude] = coordinates[index - 1];
    const [endLongitude, endLatitude] = coordinates[index];
    const referenceLatitude =
      ((startLatitude + endLatitude + stop.latitude) / 3) * (Math.PI / 180);
    const metersPerLongitudeDegree =
      111_320 * Math.max(0.01, Math.cos(referenceLatitude));
    const metersPerLatitudeDegree = 110_574;
    const segmentX =
      (endLongitude - startLongitude) * metersPerLongitudeDegree;
    const segmentY = (endLatitude - startLatitude) * metersPerLatitudeDegree;
    const stopX =
      (stop.longitude - startLongitude) * metersPerLongitudeDegree;
    const stopY = (stop.latitude - startLatitude) * metersPerLatitudeDegree;
    const squaredLength = segmentX * segmentX + segmentY * segmentY;
    const progress =
      squaredLength === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, (stopX * segmentX + stopY * segmentY) / squaredLength),
          );
    const projectedX = segmentX * progress;
    const projectedY = segmentY * progress;
    const distanceToRouteMeters = Math.hypot(
      stopX - projectedX,
      stopY - projectedY,
    );
    const segmentLengthMeters = haversineDistanceMeters(
      { latitude: startLatitude, longitude: startLongitude },
      { latitude: endLatitude, longitude: endLongitude },
    );
    const candidate = {
      distanceAlongRouteMeters:
        traversedMeters + segmentLengthMeters * progress,
      distanceToRouteMeters,
    };

    if (!best || candidate.distanceToRouteMeters < best.distanceToRouteMeters) {
      best = candidate;
    }
    traversedMeters += segmentLengthMeters;
  }

  return best;
}

/**
 * Estimate a pattern's stop order by map-matching the route-level stop set to
 * its official encoded polyline. The feed does not publish an official
 * per-pattern stop sequence, so `distanceToRouteMeters` remains available to
 * callers that want to disclose or filter the estimate.
 */
export function estimateTransitPatternStopSequence(
  pattern: TransitPattern,
  stops: readonly TransitStop[],
  maximumDistanceMeters = 90,
): TransitPatternStop[] {
  const coordinates = decodeRenderableLine(pattern.encodedPolyline);
  if (!coordinates) return [];

  return stops
    .flatMap((stop) => {
      if (
        !Number.isFinite(stop.latitude) ||
        !Number.isFinite(stop.longitude)
      ) {
        return [];
      }
      const projection = projectStopOntoLine(stop, coordinates);
      if (
        !projection ||
        projection.distanceToRouteMeters > maximumDistanceMeters
      ) {
        return [];
      }
      return [{ ...stop, ...projection }];
    })
    .sort(
      (first, second) =>
        first.distanceAlongRouteMeters - second.distanceAlongRouteMeters ||
        second.distanceToRouteMeters - first.distanceToRouteMeters,
    )
    .map((stop, index) => ({ ...stop, sequence: index + 1 }));
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

export function transitPredictionEtaSeconds(prediction: TransitPrediction) {
  const seconds = finiteNumber(prediction.timeToArrivalInSeconds);
  if (seconds !== undefined && seconds >= 0) return Math.round(seconds);

  const countdownMinutes = finiteNumber(prediction.predictionCountdown);
  if (countdownMinutes !== undefined && countdownMinutes >= 0) {
    return Math.round(countdownMinutes * 60);
  }

  const predictionTime = prediction.predictionTime
    ? Date.parse(prediction.predictionTime)
    : Number.NaN;
  const systemTime = prediction.systemTime
    ? Date.parse(prediction.systemTime)
    : Number.NaN;
  if (Number.isFinite(predictionTime) && Number.isFinite(systemTime)) {
    return Math.max(0, Math.round((predictionTime - systemTime) / 1_000));
  }
  return undefined;
}

/** Normalize the official prediction array into a stable station-board order. */
export function buildTransitStationBoard(
  vehicle: Pick<TransitVehicle, "routeCode" | "predictions">,
  detail?: Pick<TransitRouteDetail, "stops">,
): TransitStationBoardStop[] {
  const routeCode = normalizeCode(vehicle.routeCode);
  const stopsById = new Map(
    detail?.stops.map((stop) => [String(stop.id), stop]) ?? [],
  );
  const predictions = Array.isArray(vehicle.predictions)
    ? vehicle.predictions.filter(
        (prediction) =>
          !prediction.routeCode ||
          normalizeCode(prediction.routeCode) === routeCode,
      )
    : [];

  return predictions
    .map((prediction, sourceIndex) => {
      const matchedStop = prediction.stopId
        ? stopsById.get(String(prediction.stopId))
        : undefined;
      const etaSeconds = transitPredictionEtaSeconds(prediction);
      const stopName = compactTransitStopName(
        prediction.stopName || matchedStop?.name || "待确认站点",
      );
      return {
        id: prediction.stopId ? String(prediction.stopId) : matchedStop?.id,
        name: stopName,
        sequence: sourceIndex + 1,
        etaSeconds,
        etaMinutes:
          etaSeconds === undefined ? undefined : Math.ceil(etaSeconds / 60),
        predictionTime: prediction.predictionTime,
        destination: prediction.destination,
        type: prediction.type,
        delayed: prediction.isDelayed,
        sourceIndex,
      };
    })
    .filter((stop) => stop.etaSeconds === undefined || stop.etaSeconds >= 0)
    .sort((first, second) => {
      if (first.etaSeconds === undefined) {
        return second.etaSeconds === undefined
          ? first.sourceIndex - second.sourceIndex
          : 1;
      }
      if (second.etaSeconds === undefined) return -1;
      return first.etaSeconds - second.etaSeconds ||
        first.sourceIndex - second.sourceIndex;
    })
    .map((stop, index) => ({
      id: stop.id,
      name: stop.name,
      sequence: index + 1,
      etaSeconds: stop.etaSeconds,
      etaMinutes: stop.etaMinutes,
      predictionTime: stop.predictionTime,
      destination: stop.destination,
      type: stop.type,
      delayed: stop.delayed,
    }));
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
      etaSeconds: transitPredictionEtaSeconds(prediction),
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

function findLastReportedStop(
  vehicle: TransitVehicle,
  detail?: TransitRouteDetail,
) {
  if (vehicle.lastStop === null || vehicle.lastStop === undefined) {
    return undefined;
  }
  const reported = String(vehicle.lastStop).trim();
  if (!reported) return undefined;
  const normalizedReported = compactTransitStopName(reported).toLowerCase();
  return detail?.stops.find(
    (stop) =>
      String(stop.id) === reported ||
      compactTransitStopName(stop.name).toLowerCase() === normalizedReported,
  );
}

function findCurrentTripTerminal(
  vehicle: TransitVehicle,
  upcomingStops: readonly TransitStationBoardStop[],
) {
  const destination = (
    vehicle.destination ?? upcomingStops.find((stop) => stop.destination)?.destination
  )
    ?.trim()
    .toLowerCase();
  if (!destination) return upcomingStops.at(-1);

  let terminal: TransitStationBoardStop | undefined;
  for (const stop of upcomingStops) {
    const stopDestination = stop.destination?.trim().toLowerCase();
    if (stopDestination && stopDestination !== destination) {
      if (terminal) break;
      continue;
    }
    terminal = stop;
  }
  return terminal;
}

export function transitVehicleLabel(vehicle: TransitVehicle) {
  const identifier = vehicle.bus_id ?? vehicle.id;
  return identifier === undefined || identifier === null || identifier === ""
    ? "车辆号待确认"
    : `#${String(identifier)}`;
}

/** Derive map-ready vehicle facts without guessing a current stop. */
export function deriveTransitVehicleMapInfo(
  vehicle: TransitVehicle,
  feed: TransitFeed,
): TransitVehicleMapInfo {
  const route = findRoute(feed, vehicle.routeCode);
  const detail = findRouteDetail(feed, vehicle.routeCode);
  const pattern = findVehiclePattern(vehicle, detail);
  const upcomingStops = buildTransitStationBoard(vehicle, detail);
  const nextPrediction = findNextTransitStop(vehicle);
  const etaSeconds = nextPrediction
    ? transitPredictionEtaSeconds(nextPrediction)
    : undefined;
  const matchingStop = nextPrediction?.stopId
    ? detail?.stops.find(
        (stop) => String(stop.id) === String(nextPrediction.stopId),
      )
    : undefined;
  const nextStop = nextPrediction
    ? {
        ...nextPrediction,
        stopName: compactTransitStopName(
          nextPrediction.stopName || matchingStop?.name || "待确认站点",
        ),
      }
    : undefined;
  const predictedTerminal = findCurrentTripTerminal(vehicle, upcomingStops);
  const estimatedPatternTerminal = pattern
    ? estimateTransitPatternStopSequence(pattern, detail?.stops ?? []).at(-1)
    : undefined;

  return {
    vehicle,
    vehicleLabel: transitVehicleLabel(vehicle),
    route,
    pattern,
    routeDirection: pattern?.direction,
    routeDirectionLabel: pattern
      ? transitPatternDirectionLabel(pattern, detail?.stops ?? [])
      : undefined,
    nextStop,
    etaSeconds,
    etaMinutes:
      etaSeconds === undefined ? undefined : Math.ceil(etaSeconds / 60),
    nearestStop: findNearestTransitStop(vehicle, detail),
    lastReportedStop: findLastReportedStop(vehicle, detail),
    upcomingStops,
    terminalStop: predictedTerminal
      ? { id: predictedTerminal.id, name: predictedTerminal.name }
      : estimatedPatternTerminal
        ? { id: estimatedPatternTerminal.id, name: estimatedPatternTerminal.name }
        : undefined,
    destination:
      vehicle.destination ||
      nextStop?.destination ||
      predictedTerminal?.name ||
      estimatedPatternTerminal?.name,
  };
}

/** Derive the same stable shape for every vehicle in a feed. */
export function deriveTransitVehicleMapInfoList(feed: TransitFeed) {
  return feed.vehicles.map((vehicle) =>
    deriveTransitVehicleMapInfo(vehicle, feed),
  );
}

/** Build the six-route list model independently from map visibility. */
export function buildTransitRouteOverviews(
  feed: TransitFeed,
): TransitRouteOverview[] {
  return feed.routes.map((route) => {
    const detail = findRouteDetail(feed, route.code);
    const vehicles = feed.vehicles
      .filter(
        (vehicle) => normalizeCode(vehicle.routeCode) === normalizeCode(route.code),
      )
      .map((vehicle) => deriveTransitVehicleMapInfo(vehicle, feed));
    const patterns = (detail?.patterns ?? []).map((pattern) => {
      const stops = estimateTransitPatternStopSequence(
        pattern,
        detail?.stops ?? [],
      );
      return {
        pattern,
        directionLabel: transitPatternDirectionLabel(
          pattern,
          detail?.stops ?? [],
        ),
        stops,
        terminalStop: stops.at(-1),
      };
    });

    return {
      route,
      detail,
      patterns,
      vehicles,
      vehicleCount: vehicles.length,
      operating: vehicles.length > 0,
    };
  });
}
