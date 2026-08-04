import {
  VISITOR_PARKING_RATES_2026_27,
  type SurfaceZone,
} from "@/data/permits";
import {
  getParkingFacilityDetails,
  type FacilityAccessWindow,
  type ParkingFacilityDetails,
} from "@/data/parking-facilities";
import {
  resolveParkingAccess,
  type ParkingAccessContext,
  type ParkingAccessDecision,
  type ParkingAccessTarget,
} from "@/lib/permit-access";
import type { ParkingLocation } from "@/types/parking";

type SurfaceAggregate = {
  zones: readonly SurfaceZone[];
  visitorPark?: string;
  link: string;
};

function facilityAccessText(
  visitor: FacilityAccessWindow,
  permit: FacilityAccessWindow,
): Pick<ParkingAccessTarget, "permit" | "usage"> {
  const permitText: Readonly<Record<FacilityAccessWindow, string>> = {
    "all-times": "Permit- All Times",
    "off-peak": "Permit- Off-Peak",
    none: "No Permit Access",
  };
  const visitorText: Readonly<Record<FacilityAccessWindow, string>> = {
    "all-times": "Visitor- All Times",
    "off-peak": "Visitor- Off-Peak",
    none: "No Visitor Access",
  };
  return {
    permit: `Garage: ${permitText[permit]}; ${visitorText[visitor]}`,
    usage: `${permitText[permit]}; ${visitorText[visitor]}`.toUpperCase(),
  };
}

function facilityGarageTarget(
  facility: ParkingFacilityDetails,
): Omit<ParkingAccessTarget, "kind"> {
  return {
    name: facility.officialName,
    ...facilityAccessText(facility.access.visitor, facility.access.permit),
    visitorPark:
      facility.access.visitor === "none" ? undefined : "Visitor parking",
    link: facility.officialUrl,
  };
}

const statusPriority: Readonly<Record<ParkingAccessDecision["status"], number>> = {
  included: 0,
  "visitor-paid": 1,
  later: 2,
  unavailable: 3,
};

function addTargetSource(
  decision: ParkingAccessDecision,
  target: ParkingAccessTarget,
): ParkingAccessDecision {
  return target.link
    ? {
        ...decision,
        sourceUrls: Array.from(
          new Set([...decision.sourceUrls, target.link]),
        ),
      }
    : decision;
}

function resolveSurfaceAggregate(
  location: ParkingLocation,
  aggregate: SurfaceAggregate,
  context: ParkingAccessContext,
): ParkingAccessDecision {
  const decisions = aggregate.zones.map((zone) => {
    const target: ParkingAccessTarget = {
      name: location.GarageName,
      kind: "surface",
      permit: zone,
      visitorPark: aggregate.visitorPark,
      link: aggregate.link,
    };
    return {
      zone,
      decision: addTargetSource(resolveParkingAccess(target, context), target),
    };
  });
  const chosen = [...decisions].sort(
    (left, right) =>
      statusPriority[left.decision.status] -
      statusPriority[right.decision.status],
  )[0];
  const matchingZones = decisions
    .filter((entry) => entry.decision.status === chosen.decision.status)
    .map((entry) => entry.zone)
    .join(" / ");
  const aggregateNote = `实时空位数覆盖整个聚合场地，不代表 ${matchingZones} 子区域各自的独立空位。`;

  if (chosen.decision.status === "included") {
    return {
      ...chosen.decision,
      detail: `你的停车证当前包含 ${matchingZones} 普通未保留位；${aggregateNote}`,
    };
  }
  if (chosen.decision.status === "visitor-paid") {
    const later = decisions.find(
      (entry) => entry.decision.nextAccessLabel,
    )?.decision;
    return {
      ...chosen.decision,
      detail: `你的停车证当前不包含此聚合场地内的对应分区；仅可使用明确标出的按小时/ParkMobile 访客位。${aggregateNote}`,
      nextAllowedAt: later?.nextAllowedAt ?? chosen.decision.nextAllowedAt,
      nextAccessLabel:
        later?.nextAccessLabel ?? chosen.decision.nextAccessLabel,
    };
  }
  return {
    ...chosen.decision,
    detail: `${chosen.decision.detail} ${aggregateNote}`,
  };
}

function fallbackGarageTarget(location: ParkingLocation): ParkingAccessTarget {
  if (location.GarageType === 3) {
    return {
      name: location.GarageName,
      kind: "garage",
      permit: "Garage: Visitor- All Times; No Permit Access",
      visitorPark: "Visitor parking",
    };
  }
  if (location.GarageType === 2) {
    return {
      name: location.GarageName,
      kind: "garage",
      permit: "Garage: Permit- All Times; No Visitor Access",
    };
  }
  return {
    name: location.GarageName,
    kind: "garage",
    permit: "Garage: Visitor and Permit- All Times",
    visitorPark: "Visitor parking",
  };
}

function withVisitorPrice(
  decision: ParkingAccessDecision,
  location: ParkingLocation,
): ParkingAccessDecision {
  if (decision.status !== "visitor-paid") return decision;
  const priceLead =
    location.kind === "surface"
      ? `$${VISITOR_PARKING_RATES_2026_27.surfaceHourlyUsd.toFixed(2)}/小时`
      : location.region === "medical-center"
        ? `$${VISITOR_PARKING_RATES_2026_27.medicalCenterGarage.halfHourUsd.toFixed(2)}/30 分钟`
        : `$${VISITOR_PARKING_RATES_2026_27.academicGarage.halfHourUsd.toFixed(2)}/30 分钟`;
  const dailyMaximum =
    location.kind === "surface"
      ? undefined
      : location.region === "medical-center"
        ? VISITOR_PARKING_RATES_2026_27.medicalCenterGarage.dailyMaximumUsd
        : VISITOR_PARKING_RATES_2026_27.academicGarage.dailyMaximumUsd;
  const price = `${priceLead}${dailyMaximum ? `，日上限 $${dailyMaximum.toFixed(2)}` : ""}`;
  return {
    ...decision,
    title: `当前需付费 · ${priceLead}`,
    detail: `${decision.detail} 2026–27 参考费率：${price}；活动、医院验证与入口显示优先。`,
    sourceUrls: Array.from(
      new Set([
        ...decision.sourceUrls,
        VISITOR_PARKING_RATES_2026_27.sourceUrl,
      ]),
    ),
  };
}

/**
 * Adapts CampusParc's 20 aggregate live-feed rows to the centralized permit
 * model without inventing a zone from the user's identity. GarageType is only
 * used for future/unknown locations; known garages use their official page or
 * OSU GIS access classification.
 */
export function resolveParkingLocationAccess(
  location: ParkingLocation,
  context: ParkingAccessContext,
): ParkingAccessDecision {
  const facility = getParkingFacilityDetails(location.GarageId);
  if (facility?.surfaceZones?.length) {
    const aggregate: SurfaceAggregate = {
      zones: facility.surfaceZones,
      visitorPark: "ParkMobile paid hourly",
      link: facility.officialUrl,
    };
    return withVisitorPrice(
      resolveSurfaceAggregate(location, aggregate, context),
      location,
    );
  }

  if (facility) {
    const target: ParkingAccessTarget = {
      ...facilityGarageTarget(facility),
      kind: "garage",
    };
    return withVisitorPrice(
      addTargetSource(resolveParkingAccess(target, context), target),
      location,
    );
  }

  const target = fallbackGarageTarget(location);
  const resolved = resolveParkingAccess(target, context);
  return withVisitorPrice({
    ...resolved,
    detail: `${resolved.detail} 此地点仅有实时 feed 的粗粒度入口分类，请在出发前核对官方车库页。`,
    certainty: "needs-check",
  }, location);
}
