import type { Feature, FeatureCollection, Geometry } from "geojson";

import {
  classifyCampusParkingTime,
  getCurrentAccessSummary,
  getIdentityDefinition,
  getPermitByCode,
  isPermitCode,
  isPermitEligibleForIdentity,
  type InstantInput,
  type PermitCode,
  type ParkingTimeClassification,
  type SurfaceZone,
  type UserParkingIdentity,
} from "@/data/permits";
import { resolvePermitZones } from "@/lib/permit-map";

/**
 * Conservative access model for OSU's public parking GIS attributes.
 *
 * Sources checked 2026-08-01:
 * - CampusParc surface access table (PY26)
 * - CampusParc parking definitions and permit-specific pages
 * - CampusParc academic visitor parking
 *
 * Posted signs, event plans and specific garage keycard tables always win.
 */
export const PERMIT_ACCESS_MODEL_SOURCES = {
  surfaceAccess:
    "https://osu.campusparc.com/media/ytziyyvm/surfacelotaccesstablepy26250520.pdf",
  garageAccess:
    "https://osu.campusparc.com/media/wnhdw3z5/garageaccesstablepy261027.pdf",
  definitions: "https://osu.campusparc.com/parking-definitions/",
  offPeak:
    "https://osu.campusparc.com/find-parking/off-peak-permit-parking/",
  visitor:
    "https://osu.campusparc.com/find-parking/academic-visitor-parking/",
} as const;

export type ParkingAccessStatus =
  | "included"
  | "later"
  | "visitor-paid"
  | "unavailable";

export type ParkingAccessTargetKind = "surface" | "garage" | "unknown";

export interface ParkingAccessTarget {
  readonly name?: string | null;
  /** OSU GIS Permit property, for example A, WC or a Garage: … sentence. */
  readonly permit?: string | null;
  readonly usage?: string | null;
  readonly visitorPark?: string | null;
  readonly link?: string | null;
  readonly kind?: ParkingAccessTargetKind;
}

export interface ParkingAccessContext {
  readonly permitCode: PermitCode | "visitor" | "none";
  readonly identity: UserParkingIdentity;
  readonly at: InstantInput;
}

export interface ParkingAccessDecision {
  readonly status: ParkingAccessStatus;
  readonly kind: ParkingAccessTargetKind;
  readonly zone: SurfaceZone | null;
  readonly title: string;
  readonly detail: string;
  readonly nextAllowedAt?: number;
  readonly nextAccessLabel?: string;
  readonly identityRestriction?: string;
  /** Distinguishes a hard restriction from incomplete official data. */
  readonly certainty: "confirmed" | "needs-check";
  readonly requiresPayment: boolean;
  readonly sourceUrls: readonly string[];
}

export type PermitAreaProperties = {
  OBJECTID?: number;
  Name?: string | null;
  CPNAME?: string | null;
  Permit?: string | null;
  Usage?: string | null;
  VisitorPark?: string | null;
  Link?: string | null;
  [key: string]: unknown;
};

export type AnnotatedPermitAreaProperties = PermitAreaProperties & {
  accessStatus: ParkingAccessStatus;
  accessTitle: string;
  accessDetail: string;
  accessNextAllowedAt?: number;
  accessNextAccessLabel?: string;
  accessIdentityRestriction?: string;
  accessCertainty: ParkingAccessDecision["certainty"];
};

const surfaceZones = new Set<SurfaceZone>([
  "A",
  "B",
  "C",
  "CX",
  "WA",
  "WB",
  "WC",
  "WCO",
]);

const restrictedSurfaceCodes = new Set([
  "D",
  "DV",
  "L",
  "M",
  "R",
  "RD",
  "S",
  "STATE",
  "LEASED",
  "CPBV",
]);

const unknownSurfaceCodes = new Set([
  "",
  "TBD",
  "N/A",
  "NA",
  "OFF CAMPUS",
  "NOT PERMITED",
  "NOT PERMITTED",
]);

const decisionTitles: Readonly<Record<ParkingAccessStatus, string>> = {
  included: "当前停车证已包含",
  later: "稍后可使用",
  "visitor-paid": "当前需按访客规则付费",
  unavailable: "当前不可使用",
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function surfaceZoneOf(value: string | null | undefined): SurfaceZone | null {
  const normalized = normalize(value).toUpperCase();
  return surfaceZones.has(normalized as SurfaceZone)
    ? (normalized as SurfaceZone)
    : null;
}

function inferKind(target: ParkingAccessTarget): ParkingAccessTargetKind {
  if (target.kind) return target.kind;
  const text = `${normalize(target.name)} ${normalize(target.permit)} ${normalize(target.usage)}`;
  if (/garage/i.test(text)) return "garage";
  if (surfaceZoneOf(target.permit)) return "surface";
  if (normalize(target.permit)) return "surface";
  return "unknown";
}

function hasVisitorAccess(target: ParkingAccessTarget): boolean {
  const text = `${normalize(target.permit)} ${normalize(target.usage)} ${normalize(target.visitorPark)}`;
  const permitCode = normalize(target.permit).toUpperCase();
  const usageCode = normalize(target.usage).toUpperCase();
  return (
    ((/visitor/i.test(text) &&
      !/no visitor|visitor\s*[-:]?\s*no access/i.test(text)) ||
      permitCode === "V" ||
      usageCode === "PHP")
  );
}

function visitorAccessIsOffPeakOnly(target: ParkingAccessTarget): boolean {
  return /visitor\s*[-:]?\s*off[- ]?peak/i.test(
    `${normalize(target.permit)} ${normalize(target.usage)}`,
  );
}

function isExplicitPaidHourly(target: ParkingAccessTarget): boolean {
  const text = `${normalize(target.permit)} ${normalize(target.usage)} ${normalize(target.visitorPark)}`;
  return /paid hourly|parkmobile|pay[- ]?by[- ]?plate|meter/i.test(text);
}

function isPermitGarage(target: ParkingAccessTarget): boolean {
  const text = `${normalize(target.permit)} ${normalize(target.usage)}`;
  return /permit/i.test(text) && !/no permit access|visitor only/i.test(text);
}

function permitAccessIsOffPeakOnly(target: ParkingAccessTarget): boolean {
  return /permit\s*[-:]?\s*off[- ]?peak/i.test(
    `${normalize(target.permit)} ${normalize(target.usage)}`,
  );
}

function decision(
  status: ParkingAccessStatus,
  kind: ParkingAccessTargetKind,
  zone: SurfaceZone | null,
  detail: string,
  extra: Partial<Omit<ParkingAccessDecision, "status" | "kind" | "zone" | "title" | "detail">> = {},
): ParkingAccessDecision {
  return {
    status,
    kind,
    zone,
    title: decisionTitles[status],
    detail,
    certainty: "confirmed",
    requiresPayment: status === "visitor-paid",
    sourceUrls: [
      PERMIT_ACCESS_MODEL_SOURCES.surfaceAccess,
      PERMIT_ACCESS_MODEL_SOURCES.definitions,
    ],
    ...extra,
  };
}

function currentSurfaceZones(
  permitCode: PermitCode,
  at: InstantInput,
): readonly SurfaceZone[] {
  return resolvePermitZones(getCurrentAccessSummary(permitCode, at));
}

function futureWindowLabel(time: ParkingTimeClassification): string {
  if (time.isHoliday) return "大学假日非高峰窗口";
  if (time.isWeekend) return "周末全天非高峰窗口";
  if (time.isOvernight) return "工作日 3–5 a.m. 夜间权限窗口";
  if (time.isOffPeak) return "工作日 4 p.m.–3 a.m. 非高峰窗口";
  return "工作日 5 a.m.–4 p.m. 高峰窗口";
}

function findNextSurfaceWindow(
  permitCode: PermitCode,
  zone: SurfaceZone,
  at: InstantInput,
): { at: number; labelZh: string } | null {
  const start = at instanceof Date ? at.getTime() : at;
  const firstProbe = Math.floor(start / 60_000) * 60_000 + 60_000;
  const end = firstProbe + 8 * 24 * 60 * 60_000;
  const step = 15 * 60_000;

  for (let probe = firstProbe; probe <= end; probe += step) {
    if (!currentSurfaceZones(permitCode, probe).includes(zone)) continue;

    let boundary = probe;
    for (
      let finer = Math.max(firstProbe, probe - step + 60_000);
      finer <= probe;
      finer += 60_000
    ) {
      if (currentSurfaceZones(permitCode, finer).includes(zone)) {
        boundary = finer;
        break;
      }
    }
    return {
      at: boundary,
      labelZh: futureWindowLabel(classifyCampusParkingTime(boundary)),
    };
  }
  return null;
}

function visitorDecision(
  target: ParkingAccessTarget,
  kind: ParkingAccessTargetKind,
  zone: SurfaceZone | null,
  time: ParkingTimeClassification,
): ParkingAccessDecision | null {
  const visitorAccess = hasVisitorAccess(target) || isExplicitPaidHourly(target);
  if (!visitorAccess) return null;

  if (visitorAccessIsOffPeakOnly(target) && !time.isOffPeak) {
    return decision(
      "later",
      kind,
      zone,
      "此处只在非高峰时段开放访客入口，届时仍需按入口或 ParkMobile 费率付费。",
      {
        nextAccessLabel: "工作日 4 p.m. 后或周末",
        requiresPayment: true,
        sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.visitor],
      },
    );
  }

  return decision(
    "visitor-paid",
    kind,
    zone,
    "此处明确提供访客或按小时停车；停车证不抵扣访客费用时，须按入口、机器或 ParkMobile 显示价格付费。",
    { sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.visitor] },
  );
}

function resolveGarageAccess(
  target: ParkingAccessTarget,
  context: ParkingAccessContext,
  time: ParkingTimeClassification,
): ParkingAccessDecision {
  const visitor = visitorDecision(target, "garage", null, time);

  if (context.permitCode === "visitor" || context.identity === "visitor") {
    return (
      visitor ??
      decision(
        "unavailable",
        "garage",
        null,
        "OSU GIS 未把该车库标为访客车库，请选择明确开放访客入口的车库。",
        { sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.visitor] },
      )
    );
  }

  if (!isPermitCode(context.permitCode)) {
    return (
      visitor ??
      decision(
        "unavailable",
        "garage",
        null,
        "尚未设置停车证，无法判断该车库的 keycard 权限。",
        { certainty: "needs-check" },
      )
    );
  }

  const permit = getPermitByCode(context.permitCode);
  if (!isPermitEligibleForIdentity(permit, context.identity)) {
    return decision(
      "unavailable",
      "garage",
      null,
      `所选身份“${getIdentityDefinition(context.identity).labelZh}”与 ${permit.officialCode} 的官方购买资格不匹配。`,
      { identityRestriction: permit.eligibilityZh },
    );
  }

  if (!isPermitGarage(target)) {
    return (
      visitor ??
      decision(
        "unavailable",
        "garage",
        null,
        "该车库未标为停车证入口，不能仅凭当前停车证进入。",
      )
    );
  }

  const garage = permit.access.garage;
  const name = normalize(target.name).toLowerCase();
  const isGatewayGarage = /gateway garage/.test(name);

  // The PY26 garage table limits Gateway permit entry to A, CG6 and a few
  // special-purpose credentials (D/E/GW). A-equivalent RET/Regional permits
  // are modeled here; a generic CG still falls through to the suffix check.
  if (
    isGatewayGarage &&
    !(["A", "CG", "REGIONAL", "RET"] as const).includes(
      permit.code as "A" | "CG" | "REGIONAL" | "RET",
    )
  ) {
    if (visitor) {
      return {
        ...visitor,
        detail: `${permit.officialCode} 不在 Gateway 官方停车证入口清单内；当前只能使用访客入口并按现场价格付费。`,
        sourceUrls: [
          ...visitor.sourceUrls,
          PERMIT_ACCESS_MODEL_SOURCES.garageAccess,
        ],
      };
    }
    return decision(
      "unavailable",
      "garage",
      null,
      `${permit.officialCode} 不在 Gateway 官方停车证入口清单内。`,
      { sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.garageAccess] },
    );
  }

  if (permit.code === "11G" && /11th avenue/.test(name)) {
    return decision(
      "included",
      "garage",
      null,
      "11G 包含 11th Avenue Garage 全天权限，仍须遵守指定夜间楼层。",
    );
  }

  if (permitAccessIsOffPeakOnly(target) && !time.isOffPeak) {
    if (visitor) {
      return {
        ...visitor,
        detail:
          "当前停车证在此处尚未生效；现在进入需按访客费率付费，工作日 4 p.m. 后或周末再按具体停车证权限判断。",
        nextAccessLabel: "工作日 4 p.m. 后或周末",
      };
    }
    return decision(
      "later",
      "garage",
      null,
      "此车库的普通停车证入口当前未开放，工作日 4 p.m. 后或周末再按具体停车证权限判断。",
      { nextAccessLabel: "工作日 4 p.m. 后或周末" },
    );
  }

  if (garage.mode === "none") {
    return (
      visitor ??
      decision(
        "unavailable",
        "garage",
        null,
        `${permit.officialCode} 不包含普通车库权限。`,
      )
    );
  }

  if (time.isOvernight && garage.mode === "all-permit-garages") {
    if (visitor) {
      return {
        ...visitor,
        detail: `${permit.officialCode} 的一般车库权限不能自动推定为凌晨 3–5 a.m. 的夜间存放权限；如不使用明确指定的车库楼层，现在只能按访客入口与现场价格使用。`,
        certainty: "needs-check",
        sourceUrls: [
          ...visitor.sourceUrls,
          PERMIT_ACCESS_MODEL_SOURCES.garageAccess,
        ],
      };
    }
    return decision(
      "unavailable",
      "garage",
      null,
      `${permit.officialCode} 的一般车库权限不能自动推定为凌晨 3–5 a.m. 的夜间存放权限；请核对官方指定车库与楼层。`,
      {
        certainty: "needs-check",
        sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.garageAccess],
      },
    );
  }

  if (garage.mode === "all-permit-garages") {
    return decision(
      "included",
      "garage",
      null,
      `${permit.officialCode} 包含一般 permit garage 权限；访客专用车库、预留层与现场限制除外。`,
    );
  }

  if (garage.mode === "selected-all-times") {
    if (visitor) {
      return {
        ...visitor,
        detail:
          `${permit.officialCode} 需要具体 BG/CG 后缀才能确认是否已含此车库；在无法确认后缀时，只能按访客入口与现场价格使用。`,
      };
    }
    return decision(
      "unavailable",
      "garage",
      null,
      `${permit.officialCode} 需要具体 BG/CG 后缀才能判断这座指定车库；当前设置未保存后缀。`,
      { certainty: "needs-check" },
    );
  }

  if (garage.mode === "off-peak" || permit.code === "11G") {
    if (time.isOffPeak && !time.isOvernight) {
      return decision(
        "included",
        "garage",
        null,
        `${permit.officialCode} 当前处于非高峰车库权限窗口；以该车库入口表为准。`,
      );
    }
    if (visitor) {
      return {
        ...visitor,
        detail: `${permit.officialCode} 当前尚未进入一般车库权限窗口；现在进入须按访客价格付费。`,
        nextAccessLabel: "工作日 4 p.m. 后或周末",
      };
    }
    return decision(
      "later",
      "garage",
      null,
      `${permit.officialCode} 只在非高峰时段包含一般许可车库权限。`,
      { nextAccessLabel: "工作日 4 p.m. 后或周末" },
    );
  }

  if (garage.mode === "weekend-ninth") {
    const isNinth = /9th avenue (east|west)/.test(name);
    const isWindow =
      time.isHoliday ||
      time.isWeekend ||
      (time.campus.weekday === 5 && time.campus.minuteOfDay >= 14 * 60);
    if (isNinth && isWindow) {
      return decision(
        "included",
        "garage",
        null,
        `${permit.officialCode} 当前包含 9th Avenue East/West 的周末或大学假日权限。`,
      );
    }
    if (isNinth) {
      return decision(
        "later",
        "garage",
        null,
        `${permit.officialCode} 仅在周末/大学假日包含该车库，周末窗口从周五 2 p.m. 开始。`,
        { nextAccessLabel: "周五 2 p.m. 后至周末结束" },
      );
    }
  }

  return (
    visitor ??
    decision(
      "unavailable",
      "garage",
      null,
      `${permit.officialCode} 不包含这座车库的当前权限。`,
    )
  );
}

export function resolveParkingAccess(
  target: ParkingAccessTarget,
  context: ParkingAccessContext,
): ParkingAccessDecision {
  const kind = inferKind(target);
  const zone = surfaceZoneOf(target.permit);
  const time = classifyCampusParkingTime(context.at);

  if (kind === "garage") {
    return resolveGarageAccess(target, context, time);
  }

  const visitor = visitorDecision(target, kind, zone, time);
  if (context.permitCode === "visitor" || context.identity === "visitor") {
    return (
      visitor ??
      decision(
        "unavailable",
        kind,
        zone,
        "该区域没有明确的访客或按小时标记；普通 A/B/C/CX 字母位需要相应停车证。",
        { sourceUrls: [PERMIT_ACCESS_MODEL_SOURCES.visitor] },
      )
    );
  }

  if (!isPermitCode(context.permitCode)) {
    return (
      visitor ??
      decision(
        "unavailable",
        kind,
        zone,
        zone
          ? `这是 ${zone} 停车证区域；尚未设置停车证。`
          : "官方 GIS 没有提供可可靠判定的通行等级。",
      )
    );
  }

  const permit = getPermitByCode(context.permitCode);
  if (!isPermitEligibleForIdentity(permit, context.identity)) {
    return decision(
      "unavailable",
      kind,
      zone,
      `所选身份“${getIdentityDefinition(context.identity).labelZh}”与 ${permit.officialCode} 的官方购买资格不匹配。`,
      { identityRestriction: permit.eligibilityZh },
    );
  }

  if (zone) {
    if (currentSurfaceZones(permit.code, context.at).includes(zone)) {
      return decision(
        "included",
        "surface",
        zone,
        `${permit.officialCode} 在当前美东时段包含 ${zone} 非保留地面位；预留、ADA、装卸、按小时位和活动限制除外。`,
      );
    }

    const next = findNextSurfaceWindow(permit.code, zone, context.at);
    if (next) {
      if (visitor) {
        return {
          ...visitor,
          detail: `${permit.officialCode} 当前不包含此处；现在停车须按访客/ParkMobile 费率付费，后续权限窗口可使用普通未保留 ${zone} 位。`,
          nextAllowedAt: next.at,
          nextAccessLabel: next.labelZh,
        };
      }
      return decision(
        "later",
        "surface",
        zone,
        `${permit.officialCode} 当前不能停在 ${zone} 位，但在后续官方权限窗口可以使用。`,
        { nextAllowedAt: next.at, nextAccessLabel: next.labelZh },
      );
    }

    return (
      visitor ??
      decision(
        "unavailable",
        "surface",
        zone,
        `${permit.officialCode} 的一般权限不包含 ${zone} 区域。`,
      )
    );
  }

  const rawPermit = normalize(target.permit).toUpperCase();
  if (restrictedSurfaceCodes.has(rawPermit)) {
    return (
      visitor ??
      decision(
        "unavailable",
        "surface",
        null,
        "这是预留、部门、装卸、摩托车或其他专项区域，一般 A/B/C/CX 停车证不会自动开放。",
        { identityRestriction: normalize(target.usage) || undefined },
      )
    );
  }

  if (unknownSurfaceCodes.has(rawPermit) || kind === "unknown") {
    return (
      visitor ??
      decision(
        "unavailable",
        kind,
        null,
        "官方 GIS 将此处标为 TBD、校外或未分类，不能从当前数据可靠推断权限。",
        { certainty: "needs-check" },
      )
    );
  }

  return (
    visitor ??
    decision(
      "unavailable",
      kind,
      null,
      `无法把官方 GIS 标记“${normalize(target.permit)}”映射到一般停车证权限，请核对现场标牌。`,
      { certainty: "needs-check" },
    )
  );
}

function targetFromProperties(
  properties: PermitAreaProperties,
): ParkingAccessTarget {
  return {
    name: properties.CPNAME || properties.Name,
    permit: properties.Permit,
    usage: properties.Usage,
    visitorPark: properties.VisitorPark,
    link: properties.Link,
  };
}

export function annotatePermitAreaFeatures<G extends Geometry>(
  collection: FeatureCollection<G, PermitAreaProperties>,
  context: ParkingAccessContext,
): FeatureCollection<G, AnnotatedPermitAreaProperties> {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const properties = feature.properties ?? {};
      const access = resolveParkingAccess(
        targetFromProperties(properties),
        context,
      );
      return {
        ...feature,
        properties: {
          ...properties,
          accessStatus: access.status,
          accessTitle: access.title,
          accessDetail: access.detail,
          accessCertainty: access.certainty,
          ...(access.nextAllowedAt
            ? { accessNextAllowedAt: access.nextAllowedAt }
            : {}),
          ...(access.nextAccessLabel
            ? { accessNextAccessLabel: access.nextAccessLabel }
            : {}),
          ...(access.identityRestriction
            ? { accessIdentityRestriction: access.identityRestriction }
            : {}),
        },
      } satisfies Feature<G, AnnotatedPermitAreaProperties>;
    }),
  };
}

/**
 * Permit-picker detail map filter. Main maps should use annotations instead so
 * unavailable areas can remain visible in gray for comparison.
 */
export function filterPermitPreviewFeatures<G extends Geometry>(
  collection: FeatureCollection<G, PermitAreaProperties>,
  context: ParkingAccessContext,
): FeatureCollection<G, AnnotatedPermitAreaProperties> {
  const annotated = annotatePermitAreaFeatures(collection, context);
  return {
    ...annotated,
    features: annotated.features.filter(
      (feature) =>
        feature.properties.accessStatus === "included" ||
        feature.properties.accessStatus === "later" ||
        feature.properties.accessStatus === "visitor-paid",
    ),
  };
}
