import {
  VISITOR_PARKING_RATES_2026_27,
  type SurfaceZone,
} from "@/data/permits";
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

const SURFACE_AGGREGATES: Readonly<
  Partial<Record<number, SurfaceAggregate>>
> = {
  3002: {
    zones: ["WA", "WB"],
    visitorPark: "ParkMobile paid hourly",
    link: "https://osu.campusparc.com/find-parking/carmack-lot-23/",
  },
  3003: {
    zones: ["WB"],
    visitorPark: "ParkMobile paid hourly",
    link: "https://osu.campusparc.com/find-parking/carmack-lot-4/",
  },
  3005: {
    zones: ["CX"],
    visitorPark: "ParkMobile paid hourly",
    link: "https://osu.campusparc.com/find-parking/buckeye-lot/",
  },
};

const GARAGE_ACCESS: Readonly<
  Partial<Record<number, Omit<ParkingAccessTarget, "kind">>>
> = {
  294: {
    name: "12th Avenue Garage",
    permit: "Garage: Permit- Off-Peak; Visitor- All Times",
    usage: "PERMIT OFF PEAK; VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/12th-avenue-garage/",
  },
  63: {
    name: "9th Avenue East Garage",
    permit: "Garage: Permit- All Times; Visitor- Off-Peak",
    usage: "PERMIT ALL TIMES; VISITOR OFF-PEAK",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/9th-avenue-east-garage/",
  },
  107: {
    name: "9th Avenue West Garage",
    permit: "Garage: Permit- All Times; No Visitor Access",
    usage: "PERMIT ONLY-NO VISITOR",
    link: "https://osu.campusparc.com/find-parking/9th-avenue-west-garage/",
  },
  158: {
    name: "SAFEAUTO Garage",
    permit: "Garage: Visitor- All Times; No Permit Access",
    usage: "VISITOR ALL TIMES; NO PERMIT ACCESS",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/safeauto-garage/",
  },
  347: {
    name: "Wexner Medical Center Garage",
    permit: "Garage: Permit- Off-Peak; Visitor- All Times",
    usage: "PERMIT OFF PEAK; VISITOR ALL TIMES",
    visitorPark: "Patient and visitor parking",
    link: "https://osu.campusparc.com/find-parking/wexner-medical-center-garage/",
  },
  348: {
    name: "Old Cannon Garage",
    permit: "Garage: Permit- All Times; No Visitor Access",
    usage: "PERMIT ONLY-NO VISITOR",
    link: "https://osu.campusparc.com/find-parking/old-cannon-garage/",
  },
  40: {
    name: "Neil Avenue Garage",
    permit: "Garage: Permit- All Times; Visitor- Off-Peak",
    usage: "PERMIT ALL TIMES; VISITOR OFF-PEAK",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/neil-avenue-garage/",
  },
  3000: {
    name: "11th Avenue Garage",
    permit: "Garage: Permit- Off-Peak; Visitor- All Times",
    usage: "PERMIT OFF PEAK; VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/11th-avenue-garage/",
  },
  137: {
    name: "Ohio Union North Garage",
    permit: "Garage: Permit- All Times; Visitor- Off-Peak",
    usage: "PERMIT ALL TIMES; VISITOR OFF-PEAK",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/ohio-union-north-garage/",
  },
  181: {
    name: "Ohio Union South Garage",
    permit: "Garage: Permit- Off-Peak; Visitor- All Times",
    usage: "LIMITED PERMIT; VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/ohio-union-south-garage/",
  },
  346: {
    name: "Gateway Garage",
    permit: "Garage: Visitor and Permit- All Times",
    usage: "PERMIT AND VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/gateway-garage/",
  },
  93: {
    name: "Tuttle Park Place Garage",
    permit: "Garage: Visitor and Permit- All Times",
    usage: "PERMIT AND VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/tuttle-garage/",
  },
  70: {
    name: "Northwest Garage",
    permit: "Garage: Permit- All Times; No Visitor Access",
    usage: "PERMIT ONLY-NO VISITOR",
    link: "https://osu.campusparc.com/find-parking/northwest-garage/",
  },
  3: {
    name: "Arps Garage",
    permit: "Garage: Visitor and Permit- All Times",
    usage: "PERMIT AND VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/arps-garage/",
  },
  255: {
    name: "Lane Avenue Garage",
    permit: "Garage: Visitor and Permit- All Times",
    usage: "PERMIT AND VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/lane-avenue-garage/",
  },
  239: {
    name: "West Lane Avenue Garage",
    permit: "Garage: Visitor and Permit- All Times",
    usage: "PERMIT AND VISITOR ALL TIMES",
    visitorPark: "Visitor parking",
    link: "https://osu.campusparc.com/find-parking/west-lane-avenue-garage/",
  },
  1: {
    name: "James Outpatient Care Garage",
    permit: "Garage: Visitor- All Times; No Permit Access",
    usage: "VISITOR ALL TIMES; NO PERMIT ACCESS",
    visitorPark: "Patient and visitor parking",
    link: "https://osu.campusparc.com/find-parking/james-outpatient-care-garage/",
  },
};

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
  const aggregate = SURFACE_AGGREGATES[location.GarageId];
  if (aggregate) {
    return withVisitorPrice(
      resolveSurfaceAggregate(location, aggregate, context),
      location,
    );
  }

  const official = GARAGE_ACCESS[location.GarageId];
  if (official) {
    const target: ParkingAccessTarget = { ...official, kind: "garage" };
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
