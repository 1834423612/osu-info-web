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
