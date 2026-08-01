import type {
  CurrentAccessSummary,
  SurfaceScope,
  SurfaceZone,
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

const ALL_UNRESTRICTED_ZONES: readonly SurfaceZone[] = [
  "A",
  "B",
  "C",
  "CX",
  "WA",
  "WB",
  "WC",
  "WCO",
];

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
    ? [...ALL_UNRESTRICTED_ZONES]
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
