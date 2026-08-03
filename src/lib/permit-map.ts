import type {
  CurrentAccessSummary,
  InstantInput,
  PermitCode,
  PermitDefinition,
  SurfaceScope,
  SurfaceZone,
} from "@/data/permits";
import {
  getCurrentAccessSummary,
  getPermitByCode,
} from "@/data/permits";

export type PermitZoneMeta = {
  readonly code: SurfaceZone;
  readonly shortNameZh: string;
  readonly audienceZh: string;
  readonly descriptionZh: string;
  readonly color: string;
  readonly outlineColor: string;
};

export const PERMIT_ZONE_META: Readonly<Record<SurfaceZone, PermitZoneMeta>> = {
  A: {
    code: "A",
    shortNameZh: "教师 / A&P 区",
    audienceZh: "教师与行政专业岗位",
    descriptionZh: "A 是中校区 Faculty / A&P 地面区域；学生证通常仅在离峰时段进入未受限车位。",
    color: "#ba0c2f",
    outlineColor: "#8f0824",
  },
  B: {
    code: "B",
    shortNameZh: "员工区",
    audienceZh: "Staff / CCS",
    descriptionZh: "B 是中校区 Staff / CCS 地面区域；学生证通常仅在离峰时段进入未受限车位。",
    color: "#d97706",
    outlineColor: "#9a4f04",
  },
  C: {
    code: "C",
    shortNameZh: "学生中校区",
    audienceZh: "学生",
    descriptionZh: "C 是学生在中校区最常见的地面停车区域，仍须核对具体停车证和现场限制。",
    color: "#2e7d32",
    outlineColor: "#1b5e20",
  },
  CX: {
    code: "CX",
    shortNameZh: "Buckeye 接驳区",
    audienceZh: "学生通勤 / 远端停车",
    descriptionZh: "CX 位于 Buckeye Lots，通常搭乘 Buckeye Express 接驳前往中校区。",
    color: "#7c3aed",
    outlineColor: "#5b21b6",
  },
  WA: {
    code: "WA",
    shortNameZh: "西区教师 / A&P",
    audienceZh: "教师与行政专业岗位",
    descriptionZh: "WA 是西校区 Faculty / A&P 地面区域。",
    color: "#2563eb",
    outlineColor: "#1d4ed8",
  },
  WB: {
    code: "WB",
    shortNameZh: "西区员工",
    audienceZh: "Staff / CCS",
    descriptionZh: "WB 是西校区 Staff / CCS 地面区域。",
    color: "#0891b2",
    outlineColor: "#0e7490",
  },
  WC: {
    code: "WC",
    shortNameZh: "西区学生",
    audienceZh: "学生",
    descriptionZh: "WC 是西校区学生地面区域，适合希望比 Buckeye Lots 更靠近校园的通勤者。",
    color: "#475569",
    outlineColor: "#334155",
  },
  WCO: {
    code: "WCO",
    shortNameZh: "西区夜间存车",
    audienceZh: "持 Overnight 权限者",
    descriptionZh: "WCO 是指定的西校区 overnight 存车区域；普通日间或离峰权限不等于可在此过夜。",
    color: "#0f766e",
    outlineColor: "#115e59",
  },
};

export const PERMIT_MAP_ALL_ZONES: readonly SurfaceZone[] = [
  "A",
  "B",
  "C",
  "CX",
  "WA",
  "WB",
  "WC",
  "WCO",
];

export type PermitMapPeriodId =
  | "current"
  | "weekday-peak"
  | "weekday-evening"
  | "weekend"
  | "holiday"
  | "overnight";

export type PermitMapPeriod = {
  readonly id: PermitMapPeriodId;
  readonly labelZh: string;
  readonly rangeZh: string;
  readonly detailZh: string;
  readonly zones: readonly SurfaceZone[];
  readonly isCurrent?: boolean;
};

const HOLIDAY_REMOTE_PERMITS = new Set([
  "WA",
  "WAE",
  "CX",
  "WB",
  "CXC",
  "WC",
  "WCE",
  "WCO",
]);

export function resolveSurfaceScopeZones(scope: SurfaceScope): SurfaceZone[] {
  return scope === "all-unrestricted"
    ? [...PERMIT_MAP_ALL_ZONES]
    : Array.from(new Set(scope));
}

export function getPermitZoneMeta(
  code: string | null | undefined,
): PermitZoneMeta | undefined {
  if (!code) return undefined;
  return PERMIT_ZONE_META[code.trim().toUpperCase() as SurfaceZone];
}

/**
 * Resolves the official surface-zone codes that should be visualized for the
 * selected permit at the summary's Eastern-time instant.
 */
export function resolvePermitZones(
  summary: CurrentAccessSummary,
): SurfaceZone[] {
  const { permit, time } = summary;

  if (time.primary === "overnight") {
    const overnightScope = permit.access.overnight.surface;
    if (overnightScope === "none") return [];
    return resolveSurfaceScopeZones(overnightScope);
  }

  if (time.isHoliday && HOLIDAY_REMOTE_PERMITS.has(permit.code)) {
    return ["A", "B", "C", "CX"];
  }

  const scope = time.isOffPeak
    ? permit.access.offPeakSurface
    : permit.access.peakSurface;

  return resolveSurfaceScopeZones(scope);
}

function resolveHolidayPreviewZones(permit: PermitDefinition): SurfaceZone[] {
  return HOLIDAY_REMOTE_PERMITS.has(permit.code)
    ? ["A", "B", "C", "CX"]
    : resolveSurfaceScopeZones(permit.access.offPeakSurface);
}

function resolveOvernightPreviewZones(permit: PermitDefinition): SurfaceZone[] {
  const surface = permit.access.overnight.surface;
  return surface === "none" ? [] : resolveSurfaceScopeZones(surface);
}

/**
 * Shared rule-preview model used by the dashboard and permit picker maps.
 * These are policy windows, not a prediction that a future holiday/event day
 * will be free of closures; the map UI keeps that distinction visible.
 */
export function getPermitMapPeriods(
  permitCode: PermitCode,
  at: InstantInput,
): readonly PermitMapPeriod[] {
  const permit = getPermitByCode(permitCode);
  const current = getCurrentAccessSummary(permitCode, at);
  const offPeakZones = resolveSurfaceScopeZones(permit.access.offPeakSurface);

  return [
    {
      id: "current",
      labelZh: "当前",
      rangeZh: current.time.labelZh,
      detailZh: `按当前 Columbus 美东时间判断：${current.surfaceZh}`,
      zones: resolvePermitZones(current),
      isCurrent: true,
    },
    {
      id: "weekday-peak",
      labelZh: "工作日白天",
      rangeZh: "5 a.m.–4 p.m.",
      detailZh:
        "规则预览：工作日白天按停车证原始等级使用一般非保留地面位。",
      zones: resolveSurfaceScopeZones(permit.access.peakSurface),
    },
    {
      id: "weekday-evening",
      labelZh: "工作日晚间",
      rangeZh: "周一至周四 4 p.m.–次日 3 a.m.",
      detailZh:
        "规则预览：非高峰扩展只适用于一般非保留车位；现场标识和活动安排优先。",
      zones: offPeakZones,
    },
    {
      id: "weekend",
      labelZh: "周末",
      rangeZh: "周五 4 p.m.–周一 3 a.m.",
      detailZh:
        "规则预览：周末非高峰连续开放；赛事、封路和特殊活动可能临时覆盖。",
      zones: offPeakZones,
    },
    {
      id: "holiday",
      labelZh: "校方假日",
      rangeZh: "12:01 a.m.–次日 3 a.m.",
      detailZh:
        "规则预览：仅表示校方公布假日的一般规则，不预测某个未来日期或活动状态。",
      zones: resolveHolidayPreviewZones(permit),
    },
    {
      id: "overnight",
      labelZh: "工作日夜间",
      rangeZh: "3–5 a.m.",
      detailZh:
        permit.access.overnight.mode === "not-included"
          ? "此停车证不含工作日 3–5 a.m. 通用地面存放权限；灰红区域表示不可据此停车。"
          : permit.access.overnight.detailZh,
      zones: resolveOvernightPreviewZones(permit),
    },
  ];
}
