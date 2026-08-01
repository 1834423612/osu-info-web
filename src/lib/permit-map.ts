import type {
  CurrentAccessSummary,
  SurfaceZone,
} from "@/data/permits";

export type PermitZoneMeta = {
  readonly code: SurfaceZone;
  readonly shortNameZh: string;
  readonly color: string;
  readonly outlineColor: string;
};

export const PERMIT_ZONE_META: Readonly<Record<SurfaceZone, PermitZoneMeta>> = {
  A: {
    code: "A",
    shortNameZh: "中校区 A",
    color: "#ba0c2f",
    outlineColor: "#8f0824",
  },
  B: {
    code: "B",
    shortNameZh: "中校区 B",
    color: "#d97706",
    outlineColor: "#9a4f04",
  },
  C: {
    code: "C",
    shortNameZh: "中校区 C",
    color: "#2e7d32",
    outlineColor: "#1b5e20",
  },
  CX: {
    code: "CX",
    shortNameZh: "Buckeye 区",
    color: "#7c3aed",
    outlineColor: "#5b21b6",
  },
  WA: {
    code: "WA",
    shortNameZh: "西校区 A",
    color: "#2563eb",
    outlineColor: "#1d4ed8",
  },
  WB: {
    code: "WB",
    shortNameZh: "西校区 B",
    color: "#0891b2",
    outlineColor: "#0e7490",
  },
  WC: {
    code: "WC",
    shortNameZh: "西校区 C",
    color: "#475569",
    outlineColor: "#334155",
  },
  WCO: {
    code: "WCO",
    shortNameZh: "西校区夜间",
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
    return permit.code === "WCO" ? ["WCO"] : [];
  }

  if (time.isHoliday && HOLIDAY_REMOTE_PERMITS.has(permit.code)) {
    return ["A", "B", "C", "CX"];
  }

  const scope = time.isOffPeak
    ? permit.access.offPeakSurface
    : permit.access.peakSurface;

  return scope === "all-unrestricted"
    ? [...ALL_UNRESTRICTED_ZONES]
    : Array.from(new Set(scope));
}
