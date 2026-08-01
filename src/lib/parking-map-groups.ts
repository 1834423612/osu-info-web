import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

import type { ParkingLocation } from "@/types/parking";

export type ParkingMapGroupId = "garage" | "west-surface" | "buckeye";

export type ParkingMapGroup = {
  id: ParkingMapGroupId;
  code: string;
  nameZh: string;
  descriptionZh: string;
  color: string;
  count: number;
};

const GROUP_DEFINITIONS: Readonly<
  Record<ParkingMapGroupId, Omit<ParkingMapGroup, "count">>
> = {
  garage: {
    id: "garage",
    code: "GAR",
    nameZh: "停车楼（实时空位）",
    descriptionZh: "分布在校园各区的 17 座车库，入口权限各不相同",
    color: "#ba0c2f",
  },
  "west-surface": {
    id: "west-surface",
    code: "WEST",
    nameZh: "西校区地面车位",
    descriptionZh: "Carmack 一带的学生、员工与教师分区",
    color: "#0891b2",
  },
  buckeye: {
    id: "buckeye",
    code: "CX",
    nameZh: "学生 Buckeye 接驳停车",
    descriptionZh: "CX 远端停车区，搭乘 Buckeye Express 进校",
    color: "#7c3aed",
  },
};

export function parkingMapGroupIdForLocation(
  location: ParkingLocation,
): ParkingMapGroupId {
  if (location.kind === "garage") return "garage";
  return location.GarageId === 3005 ? "buckeye" : "west-surface";
}

export function getParkingMapGroups(
  locations: readonly ParkingLocation[],
): ParkingMapGroup[] {
  return (Object.keys(GROUP_DEFINITIONS) as ParkingMapGroupId[]).flatMap(
    (id) => {
      const count = locations.filter(
        (location) => parkingMapGroupIdForLocation(location) === id,
      ).length;
      return count ? [{ ...GROUP_DEFINITIONS[id], count }] : [];
    },
  );
}

export function getParkingMapGroup(
  id?: ParkingMapGroupId,
): Omit<ParkingMapGroup, "count"> | undefined {
  return id ? GROUP_DEFINITIONS[id] : undefined;
}

type Point = [number, number];

export type ParkingGroupRegionProperties = {
  groupId: ParkingMapGroupId;
  groupCode: string;
  groupLabel: string;
  groupDescription: string;
  groupColor: string;
  groupCount: number;
  clusterCount: number;
  selected: boolean;
  fillOpacity: number;
  lineOpacity: number;
  lineWidth: number;
  labelLongitude: number;
  labelLatitude: number;
};

function cross(origin: Point, first: Point, second: Point) {
  return (
    (first[0] - origin[0]) * (second[1] - origin[1]) -
    (first[1] - origin[1]) * (second[0] - origin[0])
  );
}

function convexHull(points: Point[]) {
  const sorted = [...points].sort(
    (first, second) => first[0] - second[0] || first[1] - second[1],
  );
  if (sorted.length <= 2) return sorted;
  const lower: Point[] = [];
  sorted.forEach((point) => {
    while (
      lower.length >= 2 &&
      cross(lower.at(-2)!, lower.at(-1)!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });
  const upper: Point[] = [];
  [...sorted].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      cross(upper.at(-2)!, upper.at(-1)!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function paddedRectangle(
  points: Point[],
  longitudePadding: number,
  latitudePadding: number,
): Point[] {
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes) - longitudePadding;
  const east = Math.max(...longitudes) + longitudePadding;
  const south = Math.min(...latitudes) - latitudePadding;
  const north = Math.max(...latitudes) + latitudePadding;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

function closeRing(points: Point[]): Point[] {
  if (!points.length) return points;
  const [firstLongitude, firstLatitude] = points[0];
  const last = points.at(-1);
  if (last?.[0] === firstLongitude && last[1] === firstLatitude) return points;
  return [...points, [firstLongitude, firstLatitude]];
}

function buildLocalRing(
  points: Point[],
  longitudePadding: number,
  latitudePadding: number,
) {
  if (points.length < 3) {
    return closeRing(
      paddedRectangle(points, longitudePadding, latitudePadding),
    );
  }

  const hull = convexHull(points);
  const center = hull.reduce<Point>(
    (total, point) => [
      total[0] + point[0] / hull.length,
      total[1] + point[1] / hull.length,
    ],
    [0, 0],
  );
  const longitudeRadius = Math.max(
    ...hull.map(([longitude]) => Math.abs(longitude - center[0])),
  );
  const latitudeRadius = Math.max(
    ...hull.map(([, latitude]) => Math.abs(latitude - center[1])),
  );
  if (hull.length < 3 || longitudeRadius === 0 || latitudeRadius === 0) {
    return closeRing(
      paddedRectangle(points, longitudePadding, latitudePadding),
    );
  }
  const longitudeScale = 1 + longitudePadding / longitudeRadius;
  const latitudeScale = 1 + latitudePadding / latitudeRadius;

  return closeRing(
    hull.map<Point>((point) => [
      center[0] + (point[0] - center[0]) * longitudeScale,
      center[1] + (point[1] - center[1]) * latitudeScale,
    ]),
  );
}

function pointsForGroup(
  id: ParkingMapGroupId,
  locations: readonly ParkingLocation[],
) {
  return locations.filter(
    (location) => parkingMapGroupIdForLocation(location) === id,
  );
}

function localClusters(
  id: ParkingMapGroupId,
  locations: readonly ParkingLocation[],
): Point[][] {
  const groupLocations = pointsForGroup(id, locations);
  if (id !== "garage") {
    return [
      groupLocations.map<Point>((location) => [
        location.longitude,
        location.latitude,
      ]),
    ];
  }

  // Garages span the medical center, academic core, south campus and a remote
  // west-campus facility. One campus-wide convex hull would falsely imply that
  // every street and surface lot between them belongs to the garage category.
  // ParkingRegion is stable static metadata, so it makes a natural geographic
  // cluster boundary without relying on zoom-dependent screen coordinates.
  const byRegion = new Map<string, Point[]>();
  groupLocations.forEach((location) => {
    const cluster = byRegion.get(location.region) ?? [];
    cluster.push([location.longitude, location.latitude]);
    byRegion.set(location.region, cluster);
  });
  return [...byRegion.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, points]) => points);
}

function regionPadding(id: ParkingMapGroupId) {
  if (id === "buckeye") {
    return { longitude: 0.00215, latitude: 0.00145 };
  }
  if (id === "west-surface") {
    return { longitude: 0.00145, latitude: 0.00105 };
  }
  return { longitude: 0.00105, latitude: 0.00078 };
}

export function buildParkingGroupRegion(
  selectedId: ParkingMapGroupId | undefined,
  locations: readonly ParkingLocation[],
): FeatureCollection<
  Polygon | MultiPolygon,
  ParkingGroupRegionProperties
> {
  const features = (Object.keys(GROUP_DEFINITIONS) as ParkingMapGroupId[])
    .flatMap((id) => {
      const definition = GROUP_DEFINITIONS[id];
      const groupLocations = pointsForGroup(id, locations);
      if (!groupLocations.length) return [];
      const padding = regionPadding(id);
      const rings = localClusters(id, locations)
        .filter((points) => points.length > 0)
        .map((points) =>
          buildLocalRing(points, padding.longitude, padding.latitude),
        );
      if (!rings.length) return [];

      const selected = selectedId === id;
      const anotherGroupSelected = selectedId !== undefined && !selected;
      const center = groupLocations.reduce<Point>(
        (total, location) => [
          total[0] + location.longitude / groupLocations.length,
          total[1] + location.latitude / groupLocations.length,
        ],
        [0, 0],
      );
      const properties: ParkingGroupRegionProperties = {
        groupId: id,
        groupCode: definition.code,
        groupLabel: definition.nameZh,
        groupDescription: definition.descriptionZh,
        groupColor: definition.color,
        groupCount: groupLocations.length,
        clusterCount: rings.length,
        selected,
        fillOpacity: selected ? 0.25 : anotherGroupSelected ? 0.055 : 0.12,
        lineOpacity: selected ? 0.98 : anotherGroupSelected ? 0.38 : 0.72,
        lineWidth: selected ? 3.2 : anotherGroupSelected ? 1.25 : 1.8,
        labelLongitude: center[0],
        labelLatitude: center[1],
      };
      const geometry: Polygon | MultiPolygon =
        rings.length === 1
          ? { type: "Polygon", coordinates: [rings[0]] }
          : {
              type: "MultiPolygon",
              coordinates: rings.map((ring) => [ring]),
            };
      const feature: Feature<
        Polygon | MultiPolygon,
        ParkingGroupRegionProperties
      > = { type: "Feature", properties, geometry };
      return [feature];
    });

  return { type: "FeatureCollection", features };
}
