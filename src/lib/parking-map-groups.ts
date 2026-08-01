import type { Feature, FeatureCollection, Polygon } from "geojson";

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
    nameZh: "实时车库",
    descriptionZh: "查看 17 座车库的实时余位",
    color: "#ba0c2f",
  },
  "west-surface": {
    id: "west-surface",
    code: "WEST",
    nameZh: "西校区地面",
    descriptionZh: "Carmack 地面停车区",
    color: "#0891b2",
  },
  buckeye: {
    id: "buckeye",
    code: "CX",
    nameZh: "Buckeye Lot",
    descriptionZh: "CX 远端停车与 CABS 接驳",
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

function paddedRectangle(points: Point[]): Point[] {
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes) - 0.00125;
  const east = Math.max(...longitudes) + 0.00125;
  const south = Math.min(...latitudes) - 0.0009;
  const north = Math.max(...latitudes) + 0.0009;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

export function buildParkingGroupRegion(
  id: ParkingMapGroupId | undefined,
  locations: readonly ParkingLocation[],
): FeatureCollection<Polygon, { groupId: string; groupColor: string }> {
  const definition = getParkingMapGroup(id);
  if (!id || !definition) return { type: "FeatureCollection", features: [] };
  const points = locations
    .filter((location) => parkingMapGroupIdForLocation(location) === id)
    .map<Point>((location) => [location.longitude, location.latitude]);
  if (!points.length) return { type: "FeatureCollection", features: [] };

  const rawRing = points.length < 3 ? paddedRectangle(points) : convexHull(points);
  const center = rawRing.reduce<Point>(
    (total, point) => [
      total[0] + point[0] / rawRing.length,
      total[1] + point[1] / rawRing.length,
    ],
    [0, 0],
  );
  const ring = rawRing.map<Point>((point) => [
    center[0] + (point[0] - center[0]) * 1.12,
    center[1] + (point[1] - center[1]) * 1.12,
  ]);
  ring.push(ring[0]);

  const feature: Feature<
    Polygon,
    { groupId: string; groupColor: string }
  > = {
    type: "Feature",
    properties: { groupId: id, groupColor: definition.color },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  return { type: "FeatureCollection", features: [feature] };
}
