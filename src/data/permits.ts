import {
  PARKING_FACILITY_DATA_SOURCES,
  PARKING_RATE_PROFILES,
} from "@/data/parking-facilities";

/**
 * CampusParc permit facts and general time rules.
 *
 * This module intentionally models only rules that can be stated without
 * knowing the sign at a particular space. Posted signs, barricades, event
 * plans, construction notices and instructions from CampusParc always win.
 *
 * Permit-specific sources were checked on 2026-07-30. Prices are for permit
 * year 2026–27; shared facility and visitor-rate facts carry their own later
 * verification date in `parking-facilities.ts`.
 */

export const CAMPUS_TIME_ZONE = "America/New_York" as const;

export const PERMIT_YEAR_2026_27 = {
  label: "2026–27",
  startsOn: "2026-08-01",
  endsOn: "2027-07-31",
  lastVerifiedOn: "2026-07-30",
} as const;

export const OFFICIAL_PARKING_URLS = {
  browsePermits:
    "https://osu.campusparc.com/get-a-permit/permit-comparison-toolbrowse-permits/",
  prices2026_27: PARKING_FACILITY_DATA_SOURCES.rateTable,
  surfaceAccess:
    "https://osu.campusparc.com/media/ytziyyvm/surfacelotaccesstablepy26250520.pdf",
  garageAccess:
    "https://osu.campusparc.com/media/wnhdw3z5/garageaccesstablepy261027.pdf",
  offPeakRules:
    "https://osu.campusparc.com/find-parking/off-peak-permit-parking/",
  parkingDefinitions: "https://osu.campusparc.com/parking-definitions/",
  eventParking:
    "https://osu.campusparc.com/find-parking/ohio-state-event-parking/",
  longTermLateNight: PARKING_FACILITY_DATA_SOURCES.lateNight,
  visitorRates: PARKING_FACILITY_DATA_SOURCES.visitorParking,
  parkingPolicies: PARKING_FACILITY_DATA_SOURCES.parkingPolicies,
  parkingNews: "https://osu.campusparc.com/about-us/news/",
  holidayCalendar:
    "https://hr.osu.edu/wp-content/uploads/policy620-future-holiday-calendars.pdf",
  accessiblePermits:
    "https://osu.campusparc.com/get-a-permit/ada-accessible-permits/",
} as const;

export const VISITOR_PARKING_RATES_2026_27 = {
  verifiedOn: PARKING_FACILITY_DATA_SOURCES.verifiedOn,
  sourceUrl: PARKING_FACILITY_DATA_SOURCES.visitorParking,
  rateTableUrl: PARKING_FACILITY_DATA_SOURCES.rateTable,
  surfaceHourlyUsd: PARKING_RATE_PROFILES["surface-hourly"].hourlyUsd,
  academicGarage: {
    halfHourUsd: PARKING_RATE_PROFILES["academic-garage"].halfHourUsd,
    oneHourUsd: PARKING_RATE_PROFILES["academic-garage"].oneHourUsd,
    twoHoursUsd: PARKING_RATE_PROFILES["academic-garage"].twoHoursUsd,
    threeHoursUsd: PARKING_RATE_PROFILES["academic-garage"].threeHoursUsd,
    fourHoursUsd: PARKING_RATE_PROFILES["academic-garage"].fourHoursUsd,
    dailyMaximumUsd:
      PARKING_RATE_PROFILES["academic-garage"].dailyMaximumUsd,
    offPeakMaximumUsd:
      PARKING_RATE_PROFILES["academic-garage"].offPeakMaximumUsd,
  },
  medicalCenterGarage: {
    halfHourUsd:
      PARKING_RATE_PROFILES["medical-center-garage"].halfHourUsd,
    oneHourUsd: PARKING_RATE_PROFILES["medical-center-garage"].oneHourUsd,
    twoHoursUsd: PARKING_RATE_PROFILES["medical-center-garage"].twoHoursUsd,
    threeHoursUsd:
      PARKING_RATE_PROFILES["medical-center-garage"].threeHoursUsd,
    fourHoursUsd:
      PARKING_RATE_PROFILES["medical-center-garage"].fourHoursUsd,
    dailyMaximumUsd:
      PARKING_RATE_PROFILES["medical-center-garage"].dailyMaximumUsd,
    offPeakMaximumUsd:
      PARKING_RATE_PROFILES["medical-center-garage"].offPeakMaximumUsd,
  },
  noteZh:
    "车库费率每日午夜重置；off-peak 最高价仅适用于工作日 6 p.m.–午夜及周末。活动、医院验证和现场入口价格可能不同。",
} as const;

export type VisitorParkingCostEstimate = {
  readonly hours: number;
  readonly surfaceUsd: number;
  readonly academicGarageUsd: number;
  readonly medicalCenterGarageUsd: number;
};

function garageVisitorCost(
  hours: number,
  rates: {
    readonly halfHourUsd: number;
    readonly oneHourUsd: number;
    readonly twoHoursUsd: number;
    readonly threeHoursUsd: number;
    readonly fourHoursUsd: number;
    readonly dailyMaximumUsd: number;
  },
) {
  if (hours <= 0.5) return rates.halfHourUsd;
  if (hours <= 1) return rates.oneHourUsd;
  if (hours <= 2) return rates.twoHoursUsd;
  if (hours <= 3) return rates.threeHoursUsd;
  if (hours <= 4) return rates.fourHoursUsd;
  return rates.dailyMaximumUsd;
}

/** Published visitor-rate estimate for one same-day parking session. */
export function estimateVisitorParkingCost(
  requestedHours: number,
): VisitorParkingCostEstimate {
  const hours = Math.min(24, Math.max(0.5, requestedHours));
  return {
    hours,
    surfaceUsd:
      Math.round(hours * VISITOR_PARKING_RATES_2026_27.surfaceHourlyUsd * 100) /
      100,
    academicGarageUsd: garageVisitorCost(
      hours,
      VISITOR_PARKING_RATES_2026_27.academicGarage,
    ),
    medicalCenterGarageUsd: garageVisitorCost(
      hours,
      VISITOR_PARKING_RATES_2026_27.medicalCenterGarage,
    ),
  };
}

export const PERMIT_FACTS_DISCLAIMER_ZH =
  "本页仅概括一般规则。现场标识、车库入口提示、封路路障、赛事/活动方案及 CampusParc 当日通知始终优先。";

export type PermitAudience = "faculty-ap" | "staff" | "student" | "other";

/**
 * Coarse local-only identity used to hide permit choices that plainly do not
 * apply. It is not an eligibility decision: CampusParc and Ohio State remain
 * the authority for job family, student rank and medical-center assignments.
 */
export type UserParkingIdentity =
  | PermitAudience
  | "medical-center"
  | "visitor";

export interface ParkingIdentityDefinition {
  readonly code: UserParkingIdentity;
  readonly labelZh: string;
  readonly descriptionZh: string;
  readonly permitAudiences: readonly PermitAudience[];
}

export const PARKING_IDENTITIES: readonly ParkingIdentityDefinition[] = [
  {
    code: "student",
    labelZh: "学生",
    descriptionZh: "按 Rank、通勤或住校身份筛选学生证件",
    permitAudiences: ["student"],
  },
  {
    code: "faculty-ap",
    labelZh: "Faculty / A&P",
    descriptionZh: "教师、行政与专业岗位",
    permitAudiences: ["faculty-ap"],
  },
  {
    code: "staff",
    labelZh: "Staff / CCS",
    descriptionZh: "Classified Civil Service Staff 与符合条件的带薪研究生",
    permitAudiences: ["staff"],
  },
  {
    code: "medical-center",
    labelZh: "医学中心员工",
    descriptionZh: "仍需按实际 Faculty/A&P 或 CCS 岗位及分配区域确认",
    permitAudiences: ["faculty-ap", "staff"],
  },
  {
    code: "other",
    labelZh: "区域校区 / 退休",
    descriptionZh: "区域校区员工或 Ohio State 退休人员",
    permitAudiences: ["other"],
  },
  {
    code: "visitor",
    labelZh: "访客 / 患者",
    descriptionZh: "只查看明确开放的访客或按小时停车",
    permitAudiences: [],
  },
] as const;

const parkingIdentityCodes = new Set<UserParkingIdentity>(
  PARKING_IDENTITIES.map((identity) => identity.code),
);

export function isUserParkingIdentity(
  value: unknown,
): value is UserParkingIdentity {
  return typeof value === "string" && parkingIdentityCodes.has(value as UserParkingIdentity);
}

export type PermitCode =
  | "A"
  | "11G"
  | "WA"
  | "WAE"
  | "CX"
  | "B"
  | "BE"
  | "BG"
  | "WB"
  | "C"
  | "CE"
  | "CG"
  | "CXC"
  | "WC"
  | "WCE"
  | "WCO"
  | "REGIONAL"
  | "RET";

export type SurfaceZone = "A" | "B" | "C" | "CX" | "WA" | "WB" | "WC" | "WCO";

export type SurfaceScope = readonly SurfaceZone[] | "all-unrestricted";

export type GarageAccessMode =
  | "none"
  | "all-permit-garages"
  | "selected-all-times"
  | "selected-plus-off-peak"
  | "off-peak"
  | "weekend-ninth";

export type OvernightAccessMode =
  | "not-included"
  | "surface-permitted"
  | "designated-garage-levels"
  | "assigned-garage"
  | "kinnear-only"
  | "verify-garage-table";

export interface PermitPrice {
  readonly annualUsd: number;
  readonly monthlyUsd: number;
  readonly permitYear: typeof PERMIT_YEAR_2026_27.label;
}

export interface PermitAccessProfile {
  /** General weekday peak-period surface access; restricted spaces are excluded. */
  readonly peakSurface: SurfaceScope;
  /** General off-peak surface access; restricted spaces are excluded. */
  readonly offPeakSurface: SurfaceScope;
  readonly garage: {
    readonly mode: GarageAccessMode;
    readonly detailZh: string;
  };
  readonly overnight: {
    readonly mode: OvernightAccessMode;
    /** Formal weekday 3–5 a.m. surface access; garage rules remain separate. */
    readonly surface: SurfaceScope | "none";
    readonly detailZh: string;
  };
}

export interface PermitDefinition {
  readonly code: PermitCode;
  readonly officialCode: string;
  readonly audiences: readonly PermitAudience[];
  readonly nameZh: string;
  readonly nameEn: string;
  readonly eligibilityZh: string;
  readonly descriptionZh: string;
  readonly price: PermitPrice;
  readonly access: PermitAccessProfile;
  readonly officialUrl: string;
  readonly notesZh?: readonly string[];
}

const ALL_A_SURFACE: readonly SurfaceZone[] = [
  "A",
  "B",
  "C",
  "CX",
  "WA",
  "WB",
  "WC",
  "WCO",
];

const B_AND_LOWER_SURFACE: readonly SurfaceZone[] = [
  "B",
  "C",
  "CX",
  "WB",
  "WC",
  "WCO",
];

const C_AND_LOWER_SURFACE: readonly SurfaceZone[] = ["C", "CX", "WC", "WCO"];
const WA_AND_LOWER_SURFACE: readonly SurfaceZone[] = ["WA", "WB", "WC", "WCO"];
const CX_WEST_SURFACE: readonly SurfaceZone[] = ["CX", "WA", "WB", "WC", "WCO"];
const CXC_SURFACE: readonly SurfaceZone[] = ["CX", "WC", "WCO"];
const WB_AND_LOWER_SURFACE: readonly SurfaceZone[] = ["WB", "WC", "WCO"];
const WC_AND_LOWER_SURFACE: readonly SurfaceZone[] = ["WC", "WCO"];

const noGarage = {
  mode: "none",
  detailZh: "不含普通车库权限；进入访客车库须按访客规则付费。",
} as const;

const noOvernight = {
  mode: "not-included",
  surface: "none",
  detailZh:
    "不含停车证覆盖的工作日 3–5 a.m. 夜间存放。若必须继续停车，可按规定使用 commuter late-night 指定区，或改用 24/7 访客车库/明确支持按小时付款的地面位并另行付费；周末连续非高峰规则另计。",
} as const;

const employeeSurfaceOvernight = (surface: SurfaceScope, detailZh: string) =>
  ({ mode: "surface-permitted", surface, detailZh }) as const;

const remoteHolidayNote =
  "大学官方假日通常可按公告使用中校区 A、B、C、CX 非保留地面位；车库范围仍取决于证件权限与入口提示。";

export const PARKING_PERMITS: readonly PermitDefinition[] = [
  {
    code: "A",
    officialCode: "A",
    audiences: ["faculty-ap"],
    nameZh: "中校区 + 许可车库",
    nameEn: "Central Campus with Garage Access",
    eligibilityZh: "Faculty、Administrative 或 Professional 职位；最终资格由学校判定。",
    descriptionZh: "可使用 A 及较低等级的非保留地面位，并可进入许可车库。",
    price: { annualUsd: 1518, monthlyUsd: 126.5, permitYear: "2026–27" },
    access: {
      peakSurface: ALL_A_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "all-permit-garages",
        detailZh:
          "可进入一般 permit garage；SAFEAUTO 与 James Outpatient Care 等访客专用车库不在此概括内。",
      },
      overnight: {
        mode: "designated-garage-levels",
        surface: ALL_A_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用一般非保留地面位；车库夜间/长期停车仅限官方指定高层，部分车库须 8 a.m. 前驶离。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/a-central-campus-with-garage-access/",
  },
  {
    code: "11G",
    officialCode: "11G",
    audiences: ["faculty-ap"],
    nameZh: "11th Avenue Garage 试点证",
    nameEn: "11th Avenue Garage Permit (Pilot)",
    eligibilityZh:
      "Faculty、Administrative 或 Professional 职位；数量有限，官方使用候补抽签管理销售。",
    descriptionZh:
      "11th Avenue Garage 全天权限，其他许可车库为非高峰权限；地面位权限相当于 A 层级。",
    price: { annualUsd: 1518, monthlyUsd: 126.5, permitYear: "2026–27" },
    access: {
      peakSurface: ALL_A_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "selected-plus-off-peak",
        detailZh:
          "11th Avenue Garage 全天可用；其他许可车库仅在非高峰时段按官方表格开放。",
      },
      overnight: {
        mode: "assigned-garage",
        surface: ALL_A_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用一般非保留地面位；11th Avenue Garage 仅使用指定夜间楼层，其他车库不可由非高峰权限推定。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/11g-11th-avenue-garage-permit-pilot/",
    notesZh: ["2026–27 继续作为限量试点证销售。"],
  },
  {
    code: "WA",
    officialCode: "WA",
    audiences: ["faculty-ap"],
    nameZh: "西校区地面停车",
    nameEn: "West Campus Surface Parking",
    eligibilityZh: "Faculty、Administrative 或 Professional 职位；最终资格由学校判定。",
    descriptionZh:
      "西校区 Park & Ride；周末及大学官方假日另含 9th Avenue East/West Garage 权限。",
    price: { annualUsd: 393.96, monthlyUsd: 32.83, permitYear: "2026–27" },
    access: {
      peakSurface: WA_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "weekend-ninth",
        detailZh:
          "周末及大学官方假日可进入 9th Avenue East/West Garage；周末窗口周五 2 p.m. 开始。",
      },
      overnight: employeeSurfaceOvernight(
        CX_WEST_SURFACE,
        "工作日 3–5 a.m. 可使用 CX / WA / WB / WC / WCO 非保留地面位；车库仅按周末/假日窗口开放。",
      ),
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/wa-west-campus/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "WAE",
    officialCode: "WAE",
    audiences: ["faculty-ap"],
    nameZh: "西校区 + 非高峰车库",
    nameEn: "West Campus with Off-Peak Garage Access",
    eligibilityZh: "Faculty、Administrative 或 Professional 职位；最终资格由学校判定。",
    descriptionZh: "西校区 Park & Ride，并在非高峰时段提供一般许可车库权限。",
    price: { annualUsd: 569.76, monthlyUsd: 47.48, permitYear: "2026–27" },
    access: {
      peakSurface: CX_WEST_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "off-peak",
        detailZh:
          "非高峰可进入官方车库表列出的 permit garage；9th Avenue East/West 的周末窗口周五 2 p.m. 开始。",
      },
      overnight: {
        mode: "verify-garage-table",
        surface: CX_WEST_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用 CX / WA / WB / WC / WCO 非保留地面位；车库为 exit-only 并须 8 a.m. 前驶离，具体入口以官方表格为准。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/wae-west-campus-woff-peak-garage-access/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "CX",
    officialCode: "CX",
    audiences: ["faculty-ap", "staff"],
    nameZh: "Buckeye Lot 地面停车",
    nameEn: "Buckeye Lot Surface Parking",
    eligibilityZh:
      "Faculty/A&P、Classified Civil Service Staff，或持有带薪任命的研究生；最终资格由学校判定。",
    descriptionZh:
      "Buckeye Lots Park & Ride；可接驳 Buckeye Express，非高峰可用更多非保留地面位。",
    price: { annualUsd: 393.96, monthlyUsd: 32.83, permitYear: "2026–27" },
    access: {
      peakSurface: CX_WEST_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "weekend-ninth",
        detailZh:
          "周末及大学官方假日可进入 9th Avenue East/West Garage；周末窗口周五 2 p.m. 开始。",
      },
      overnight: employeeSurfaceOvernight(
        CX_WEST_SURFACE,
        "工作日 3–5 a.m. 可使用 CX / WA / WB / WC / WCO 非保留地面位；车库仅按周末/假日窗口开放。",
      ),
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/cxs-buckeye-lot/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "B",
    officialCode: "B",
    audiences: ["staff"],
    nameZh: "中校区地面停车",
    nameEn: "Central Campus Surface Parking",
    eligibilityZh:
      "Classified Civil Service Staff，或持有带薪任命的研究生；最终资格由学校判定。",
    descriptionZh: "可使用 B、C 及相应较低等级的非保留地面位，不含普通车库。",
    price: { annualUsd: 783, monthlyUsd: 65.25, permitYear: "2026–27" },
    access: {
      peakSurface: B_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: noGarage,
      overnight: employeeSurfaceOvernight(
        B_AND_LOWER_SURFACE,
        "工作日 3–5 a.m. 可使用 B / C / CX / WB / WC / WCO 非保留地面位；不含普通车库夜间权限。",
      ),
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/b-central-campus/",
  },
  {
    code: "BE",
    officialCode: "BE",
    audiences: ["staff"],
    nameZh: "中校区 + 非高峰车库",
    nameEn: "Central Campus with Off-Peak Garage Access",
    eligibilityZh:
      "Classified Civil Service Staff，或持有带薪任命的研究生；最终资格由学校判定。",
    descriptionZh: "B 层级地面位，并在非高峰时段提供一般许可车库权限。",
    price: { annualUsd: 999.96, monthlyUsd: 83.33, permitYear: "2026–27" },
    access: {
      peakSurface: B_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "off-peak",
        detailZh: "非高峰可进入官方 garage access table 列出的许可车库。",
      },
      overnight: {
        mode: "verify-garage-table",
        surface: B_AND_LOWER_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用 B / C / CX / WB / WC / WCO 非保留地面位；车库为 exit-only 并须 8 a.m. 前驶离。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/be-central-campus-woff-peak-garage-access/",
  },
  {
    code: "BG",
    officialCode: "BG1–BG7",
    audiences: ["staff"],
    nameZh: "中校区 + 指定车库",
    nameEn: "Central Campus with Select Garage Access",
    eligibilityZh:
      "Classified Civil Service Staff，或持有带薪任命的研究生；具体版本可能需要候补。",
    descriptionZh:
      "B 层级地面位；BG1–BG7 各自对应一组全天车库，购买前须确认具体后缀。",
    price: { annualUsd: 1415.52, monthlyUsd: 117.96, permitYear: "2026–27" },
    access: {
      peakSurface: B_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "selected-all-times",
        detailZh:
          "仅限所购 BG 后缀对应的车库；不同版本覆盖 Tuttle/Northwest、9th East、11th/Union North、Lane/West Lane、Arps/Union South、Old Cannon 等组合。",
      },
      overnight: {
        mode: "assigned-garage",
        surface: B_AND_LOWER_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用 B / C / CX / WB / WC / WCO 非保留地面位；车库仅限所购 BG 后缀对应且官方允许的车库/楼层。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/bg-central-campus-wselect-garage-access/",
    notesZh: ["“BG”不是单一车库权限，界面应同时保存具体后缀（BG1–BG7）。"],
  },
  {
    code: "WB",
    officialCode: "WB",
    audiences: ["staff"],
    nameZh: "西校区地面停车",
    nameEn: "West Campus Surface Parking",
    eligibilityZh:
      "Classified Civil Service Staff，或持有带薪任命的研究生；最终资格由学校判定。",
    descriptionZh:
      "西校区 Park & Ride；周末及大学官方假日另含 9th Avenue East/West Garage 权限。",
    price: { annualUsd: 196.2, monthlyUsd: 16.35, permitYear: "2026–27" },
    access: {
      peakSurface: WB_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "weekend-ninth",
        detailZh:
          "周末及大学官方假日可进入 9th Avenue East/West Garage；周末窗口周五 2 p.m. 开始。",
      },
      overnight: employeeSurfaceOvernight(
        WB_AND_LOWER_SURFACE,
        "工作日 3–5 a.m. 可使用 WB / WC / WCO 非保留地面位；车库仅按周末/假日窗口开放。",
      ),
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/wb-west-campus/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "C",
    officialCode: "C",
    audiences: ["student"],
    nameZh: "学生中校区地面停车",
    nameEn: "Student Central Campus Surface Parking",
    eligibilityZh: "通勤学生 Rank 3+（至少 60 个已完成学分）；最终资格由学校判定。",
    descriptionZh: "C、WC、CX 非保留地面位；官方明确不含车库与夜间停车。",
    price: { annualUsd: 530.04, monthlyUsd: 44.17, permitYear: "2026–27" },
    access: {
      peakSurface: C_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: noGarage,
      overnight: noOvernight,
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/c-central-campus/",
  },
  {
    code: "CE",
    officialCode: "CE",
    audiences: ["student"],
    nameZh: "学生中校区 + 非高峰车库",
    nameEn: "Student Central Campus with Off-Peak Garage Access",
    eligibilityZh:
      "住校学生 Rank 3+（至少 60 个已完成学分）；最终资格由学校判定。",
    descriptionZh: "C 层级地面位，并在非高峰时段提供一般许可车库权限。",
    price: { annualUsd: 921.48, monthlyUsd: 76.79, permitYear: "2026–27" },
    access: {
      peakSurface: C_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "off-peak",
        detailZh: "非高峰可进入官方 garage access table 列出的许可车库。",
      },
      overnight: noOvernight,
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/ce-central-campus-with-off-peak-garage-access/",
  },
  {
    code: "CG",
    officialCode: "CG1–CG7",
    audiences: ["student"],
    nameZh: "学生中校区 + 指定车库",
    nameEn: "Student Central Campus with Select Garage",
    eligibilityZh:
      "通常为 Rank 3+ 学生；部分版本对较低 Rank 开放，首年学生除获批例外外不适用。",
    descriptionZh:
      "C 层级地面位；CG1–CG7 对应指定车库并含该车库的夜间指定楼层权限。",
    price: { annualUsd: 1335.96, monthlyUsd: 111.33, permitYear: "2026–27" },
    access: {
      peakSurface: C_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "selected-all-times",
        detailZh:
          "仅限所购 CG 后缀对应车库；CG1–CG7 的车库、Rank 要求及候补状态并不相同。",
      },
      overnight: {
        mode: "assigned-garage",
        surface: ["WCO"],
        detailZh:
          "地面仅可用 WCO；车库仅限对应 CG 后缀及指定夜间楼层，例如 11th Level 3+、Union North 4S+、Lane 5+、Arps/Gateway 4+。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/cg-central-campus-wselect-garage/",
    notesZh: ["“CG”不是单一车库权限，界面应同时保存具体后缀（CG1–CG7）。"],
  },
  {
    code: "CXC",
    officialCode: "CXC",
    audiences: ["student"],
    nameZh: "学生 Buckeye Lot",
    nameEn: "Student Buckeye Lot",
    eligibilityZh: "通勤学生 Rank 1+；最终资格由学校判定。",
    descriptionZh:
      "Buckeye Lots Park & Ride，可接驳 Buckeye Express；非高峰可用更多非保留地面位。",
    price: { annualUsd: 262.8, monthlyUsd: 21.9, permitYear: "2026–27" },
    access: {
      peakSurface: CXC_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: noGarage,
      overnight: noOvernight,
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/cxc-buckeye-lot/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "WC",
    officialCode: "WC",
    audiences: ["student"],
    nameZh: "学生西校区地面停车",
    nameEn: "Student West Campus Surface Parking",
    eligibilityZh: "通勤学生 Rank 1+；最终资格由学校判定。",
    descriptionZh:
      "西校区 Park & Ride，可接驳 Medical Center Express/Campus Connector；非高峰可用更多地面位。",
    price: { annualUsd: 186.72, monthlyUsd: 15.56, permitYear: "2026–27" },
    access: {
      peakSurface: WC_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: noGarage,
      overnight: noOvernight,
    },
    officialUrl: "https://osu.campusparc.com/get-a-permit/wc-west-campus/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "WCE",
    officialCode: "WCE",
    audiences: ["student"],
    nameZh: "学生西校区 + 非高峰车库",
    nameEn: "Student West Campus with Off-Peak Garage Access",
    eligibilityZh: "通勤学生 Rank 1+；最终资格由学校判定。",
    descriptionZh: "西校区 Park & Ride，并在非高峰时段提供一般许可车库权限。",
    price: { annualUsd: 540.24, monthlyUsd: 45.02, permitYear: "2026–27" },
    access: {
      peakSurface: WC_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "off-peak",
        detailZh: "非高峰可进入官方 garage access table 列出的许可车库。",
      },
      overnight: noOvernight,
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/wce-west-campus-woff-peak-garage-access/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "WCO",
    officialCode: "WCO",
    audiences: ["student"],
    nameZh: "学生西校区夜间存放",
    nameEn: "Student West Campus with Overnight Storage",
    eligibilityZh:
      "住校学生 Rank 1+，但首年学生除外；最终资格由学校判定。",
    descriptionZh: "包含 1121 Kinnear Road Lot 指定区域的夜间存放权限。",
    price: { annualUsd: 765, monthlyUsd: 63.75, permitYear: "2026–27" },
    access: {
      peakSurface: WC_AND_LOWER_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: noGarage,
      overnight: {
        mode: "kinnear-only",
        surface: ["WCO"],
        detailZh:
          "3–5 a.m. 夜间存放仅限 1121 Kinnear Road Lot 的 WCO 指定区域，不扩展到其他地面位或车库。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/wco-west-campus-with-overnight-storage/",
    notesZh: [remoteHolidayNote],
  },
  {
    code: "REGIONAL",
    officialCode: "R-A / Regional",
    audiences: ["other"],
    nameZh: "区域校区 A 等效证",
    nameEn: "Regional Central Campus with Garage Access",
    eligibilityZh:
      "Ohio State Lima、Mansfield、Marion、Newark 或 ATI Wooster 的 Faculty/A&P 员工。",
    descriptionZh: "折扣价 A 等效证，含中校区地面位及一般许可车库权限。",
    price: { annualUsd: 393.96, monthlyUsd: 32.83, permitYear: "2026–27" },
    access: {
      peakSurface: ALL_A_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "all-permit-garages",
        detailZh: "A 等效的一般许可车库权限；访客专用与受限区域除外。",
      },
      overnight: {
        mode: "designated-garage-levels",
        surface: ALL_A_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用一般非保留地面位；车库夜间/长期停车仅限官方指定楼层。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/regional-permit-central-campus-with-garage-access/",
  },
  {
    code: "RET",
    officialCode: "RET",
    audiences: ["other"],
    nameZh: "退休人员 A 等效证",
    nameEn: "Retiree Central Campus with Garage Access",
    eligibilityZh: "Ohio State 退休员工；最终资格由学校判定。",
    descriptionZh: "折扣价 A 等效证，含中校区地面位及一般许可车库权限。",
    price: { annualUsd: 542.28, monthlyUsd: 45.19, permitYear: "2026–27" },
    access: {
      peakSurface: ALL_A_SURFACE,
      offPeakSurface: "all-unrestricted",
      garage: {
        mode: "all-permit-garages",
        detailZh: "A 等效的一般许可车库权限；访客专用与受限区域除外。",
      },
      overnight: {
        mode: "designated-garage-levels",
        surface: ALL_A_SURFACE,
        detailZh:
          "工作日 3–5 a.m. 可使用一般非保留地面位；车库夜间/长期停车仅限官方指定楼层。",
      },
    },
    officialUrl:
      "https://osu.campusparc.com/get-a-permit/retiree-central-campus-wgarage-access/",
  },
] as const;

export interface PermitGroup {
  readonly audience: PermitAudience;
  readonly labelZh: string;
  readonly descriptionZh: string;
  readonly permitCodes: readonly PermitCode[];
}

export const PERMIT_GROUPS: readonly PermitGroup[] = [
  {
    audience: "faculty-ap",
    labelZh: "Faculty / A&P",
    descriptionZh: "教师、行政与专业岗位",
    permitCodes: ["A", "11G", "WA", "WAE", "CX"],
  },
  {
    audience: "staff",
    labelZh: "Staff / CCS",
    descriptionZh: "Classified Civil Service Staff 与符合条件的带薪任命研究生",
    permitCodes: ["B", "BE", "BG", "WB", "CX"],
  },
  {
    audience: "student",
    labelZh: "学生",
    descriptionZh: "通勤/住校、Rank 与首年身份会影响可购买种类",
    permitCodes: ["C", "CE", "CG", "CXC", "WC", "WCE", "WCO"],
  },
  {
    audience: "other",
    labelZh: "其他资格",
    descriptionZh: "区域校区员工与退休员工",
    permitCodes: ["REGIONAL", "RET"],
  },
] as const;

export const ACCESSIBLE_PERMIT_GUIDANCE = {
  titleZh: "无障碍停车权限",
  descriptionZh:
    "需向 CampusParc 提交州政府签发的 disability placard/plate 登记证明，并把无障碍权限关联到停车账户。普通证件本身不会自动开放 ADA 车位。",
  officialUrl: OFFICIAL_PARKING_URLS.accessiblePermits,
} as const;

const permitByCode = Object.fromEntries(
  PARKING_PERMITS.map((permit) => [permit.code, permit]),
) as Readonly<Record<PermitCode, PermitDefinition>>;

export const PERMITS_BY_CODE = permitByCode;

export function isPermitCode(value: string): value is PermitCode {
  return Object.prototype.hasOwnProperty.call(permitByCode, value);
}

export function getPermitByCode(code: PermitCode): PermitDefinition {
  return permitByCode[code];
}

export function getPermitsForAudience(
  audience: PermitAudience,
): readonly PermitDefinition[] {
  return PARKING_PERMITS.filter((permit) =>
    permit.audiences.includes(audience),
  );
}

export function getIdentityDefinition(
  identity: UserParkingIdentity,
): ParkingIdentityDefinition {
  return (
    PARKING_IDENTITIES.find((candidate) => candidate.code === identity) ??
    PARKING_IDENTITIES[0]
  );
}

export function isPermitEligibleForIdentity(
  permit: PermitDefinition,
  identity: UserParkingIdentity,
): boolean {
  return getIdentityDefinition(identity).permitAudiences.some((audience) =>
    permit.audiences.includes(audience),
  );
}

export function inferIdentityForPermitSelection(
  permitCode: string,
): UserParkingIdentity {
  if (permitCode === "visitor") return "visitor";
  if (!isPermitCode(permitCode)) return "student";
  return getPermitByCode(permitCode).audiences[0] ?? "student";
}

export interface UniversityHoliday {
  /** University-observed date in the campus time zone. */
  readonly date: string;
  readonly nameZh: string;
  readonly nameEn: string;
}

/**
 * University-observed dates published by Ohio State HR for calendar years
 * 2026 and 2027. CampusParc may publish a longer event-specific window.
 */
export const OSU_UNIVERSITY_HOLIDAYS_2026_2027: readonly UniversityHoliday[] = [
  { date: "2026-01-01", nameZh: "元旦", nameEn: "New Year's Day" },
  {
    date: "2026-01-19",
    nameZh: "马丁·路德·金纪念日",
    nameEn: "Martin Luther King Jr. Day",
  },
  { date: "2026-05-25", nameZh: "阵亡将士纪念日", nameEn: "Memorial Day" },
  { date: "2026-06-19", nameZh: "六月节", nameEn: "Juneteenth" },
  {
    date: "2026-07-03",
    nameZh: "独立日（校方补休）",
    nameEn: "Independence Day (observed)",
  },
  { date: "2026-09-07", nameZh: "劳动节", nameEn: "Labor Day" },
  { date: "2026-11-11", nameZh: "退伍军人节", nameEn: "Veterans Day" },
  { date: "2026-11-26", nameZh: "感恩节", nameEn: "Thanksgiving Day" },
  {
    date: "2026-11-27",
    nameZh: "原住民日／哥伦布日（校方安排）",
    nameEn: "Columbus Day (university observed)",
  },
  {
    date: "2026-12-24",
    nameZh: "总统日（校方安排）",
    nameEn: "Presidents' Day (university observed)",
  },
  { date: "2026-12-25", nameZh: "圣诞节", nameEn: "Christmas Day" },
  { date: "2027-01-01", nameZh: "元旦", nameEn: "New Year's Day" },
  {
    date: "2027-01-18",
    nameZh: "马丁·路德·金纪念日",
    nameEn: "Martin Luther King Jr. Day",
  },
  { date: "2027-05-31", nameZh: "阵亡将士纪念日", nameEn: "Memorial Day" },
  {
    date: "2027-06-18",
    nameZh: "六月节（校方补休）",
    nameEn: "Juneteenth (observed)",
  },
  {
    date: "2027-07-05",
    nameZh: "独立日（校方补休）",
    nameEn: "Independence Day (observed)",
  },
  { date: "2027-09-06", nameZh: "劳动节", nameEn: "Labor Day" },
  { date: "2027-11-11", nameZh: "退伍军人节", nameEn: "Veterans Day" },
  { date: "2027-11-25", nameZh: "感恩节", nameEn: "Thanksgiving Day" },
  {
    date: "2027-11-26",
    nameZh: "原住民日／哥伦布日（校方安排）",
    nameEn: "Columbus Day (university observed)",
  },
  {
    date: "2027-12-23",
    nameZh: "总统日（校方补休）",
    nameEn: "Presidents' Day (observed)",
  },
  {
    date: "2027-12-24",
    nameZh: "圣诞节（校方补休）",
    nameEn: "Christmas Day (observed)",
  },
] as const;

export type InstantInput = Date | number;
export type ParkingPeriod = "peak" | "off-peak" | "overnight" | "holiday";

export interface CampusDateTimeParts {
  readonly dateKey: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** Sunday = 0, Monday = 1, … Saturday = 6. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly minuteOfDay: number;
}

export interface ParkingTimeClassification {
  readonly primary: ParkingPeriod;
  readonly labelZh: string;
  readonly campus: CampusDateTimeParts;
  readonly isPeak: boolean;
  readonly isOffPeak: boolean;
  readonly isOvernight: boolean;
  readonly isWeekend: boolean;
  readonly isHoliday: boolean;
  readonly holiday: UniversityHoliday | null;
  /**
   * False means this module has no authoritative holiday dates for that
   * calendar year; callers should avoid presenting "not a holiday" as certain.
   */
  readonly holidayCalendarCovered: boolean;
}

/**
 * Official general-access windows used by the dashboard guide.
 *
 * Sources checked 2026-08-03:
 * - CampusParc Off-Peak Permit Parking
 * - CampusParc Parking Definitions
 * - CampusParc Ohio State Event Parking
 *
 * A posted sign, event map, closure or permit-specific access table can always
 * narrow these general windows.
 */
export const CAMPUS_PARKING_ACCESS_WINDOWS = [
  {
    id: "weekday-peak",
    titleZh: "常规工作日",
    timeZh: "周一至周五 05:00–16:00",
    tone: "peak",
    summaryZh:
      "按停车证等级使用相应非保留区域；西校区停车证高峰期通常须留在 SR-315 西侧，Blankenship Lot 除外。",
    restrictionsZh:
      "不能因持有较低等级或西校区停车证而停入更高等级的中校区字母位。",
  },
  {
    id: "weekday-off-peak",
    titleZh: "工作日晚间",
    timeZh: "周一至周四 16:00–次日 03:00",
    tone: "off-peak",
    summaryZh:
      "WA / WAE / WB / WC / WCO / CX 可使用中校区 A、B、C 一般非保留地面位；部分车库按证件详情开放。",
    restrictionsZh:
      "预留、ADA、按小时、州公务车与装卸位不会因非高峰时段自动开放。",
  },
  {
    id: "weekend",
    titleZh: "周末连续窗口",
    timeZh: "周五 16:00–周一 03:00",
    tone: "weekend",
    summaryZh:
      "一般非高峰扩展连续生效；部分车库可由访客或有效 keycard 使用，仍需核对证件页面和入口提示。",
    restrictionsZh:
      "周一 03:00 后周末窗口结束；工作日 03:00–05:00 的夜间存放规则另行适用。",
  },
  {
    id: "holiday",
    titleZh: "大学认可假日",
    timeZh: "假日 00:01–次日 03:00",
    tone: "holiday",
    summaryZh:
      "按官方假日非高峰规则扩大一般非保留地面位权限；部分证件另有 9th Avenue 车库窗口。",
    restrictionsZh:
      "仅适用于大学正式认可的假日，不等同于所有校历停课日或 academic break。",
  },
  {
    id: "overnight",
    titleZh: "工作日夜间存放",
    timeZh: "周一至周五 03:00–05:00",
    tone: "overnight",
    summaryZh:
      "这是独立的 overnight 权限窗口；只可使用证件明确允许的地面范围、指定车库楼层或 late-night 临停区。",
    restrictionsZh:
      "普通 commuter 证件通常不含车辆存放；非高峰权限不能自动延伸到这个窗口。",
  },
  {
    id: "event",
    titleZh: "活动日 / Global Event",
    timeZh: "没有统一时段 · 以当次活动地图为准",
    tone: "event",
    summaryZh:
      "活动可能改入口、费率、可用停车场和出场方式；global event 的 keycard 权限也与普通活动不同。",
    restrictionsZh:
      "日、数日和月度访客证不适用于活动停车；活动专用区域必须持对应活动证。",
  },
] as const;

export const CAMPUS_PARKING_ZONE_GUIDE = [
  {
    code: "A",
    titleZh: "Faculty / A&P",
    locationZh: "中校区",
    requirementZh: "高峰期需 A 等级权限；A 通常也可用较低等级非保留位。",
    tone: "a",
  },
  {
    code: "B",
    titleZh: "Staff / CCS",
    locationZh: "中校区",
    requirementZh: "高峰期需 B 或更高等级；C / CX 证不能停。",
    tone: "b",
  },
  {
    code: "C",
    titleZh: "学生",
    locationZh: "中校区",
    requirementZh: "高峰期需包含 C 的证件；西校证高峰期通常不能停。",
    tone: "c",
  },
  {
    code: "CX",
    titleZh: "Buckeye Lot",
    locationZh: "远端学生区",
    requirementZh: "高峰期按 CX/所选证件层级使用；可搭乘 CABS 接驳。",
    tone: "cx",
  },
  {
    code: "WA",
    titleZh: "Faculty / A&P",
    locationZh: "西校区",
    requirementZh: "高峰期使用 SR-315 西侧相应非保留区域。",
    tone: "wa",
  },
  {
    code: "WB",
    titleZh: "Staff / CCS",
    locationZh: "西校区",
    requirementZh: "高峰期使用西校区 WB 及证件所含较低等级区域。",
    tone: "wb",
  },
  {
    code: "WC",
    titleZh: "学生",
    locationZh: "西校区",
    requirementZh: "高峰期使用西校区 WC / WCO 一般非保留位。",
    tone: "wc",
  },
  {
    code: "WCO",
    titleZh: "Overnight",
    locationZh: "西校区指定区",
    requirementZh: "仅供明确含 overnight 权限的证件；日间权限不等于可过夜。",
    tone: "wco",
  },
] as const;

const campusPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const weekdayNumber: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const holidayByDate = new Map(
  OSU_UNIVERSITY_HOLIDAYS_2026_2027.map((holiday) => [
    holiday.date,
    holiday,
  ]),
);

function timestampOf(at: InstantInput): number {
  const timestamp = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(timestamp)) {
    throw new RangeError("A valid Date or finite Unix timestamp is required.");
  }
  return timestamp;
}

function partValue(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new RangeError(`Unable to read ${type} in ${CAMPUS_TIME_ZONE}.`);
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    shifted.getUTCFullYear(),
    pad2(shifted.getUTCMonth() + 1),
    pad2(shifted.getUTCDate()),
  ].join("-");
}

export function getCampusDateTimeParts(at: InstantInput): CampusDateTimeParts {
  const parts = campusPartsFormatter.formatToParts(timestampOf(at));
  const year = Number(partValue(parts, "year"));
  const month = Number(partValue(parts, "month"));
  const day = Number(partValue(parts, "day"));
  // Some Intl implementations can emit 24 for midnight; normalize it to 0.
  const hour = Number(partValue(parts, "hour")) % 24;
  const minute = Number(partValue(parts, "minute"));
  const second = Number(partValue(parts, "second"));
  const weekdayText = partValue(parts, "weekday");
  const weekday = weekdayNumber[weekdayText];

  if (weekday === undefined) {
    throw new RangeError(`Unknown weekday returned by Intl: ${weekdayText}`);
  }

  return {
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
  };
}

export function getUniversityHolidayAt(
  at: InstantInput,
): UniversityHoliday | null {
  return holidayByDate.get(getCampusDateTimeParts(at).dateKey) ?? null;
}

interface HolidayWindow {
  readonly holiday: UniversityHoliday;
  readonly phase: "observed-date" | "following-morning";
}

function getHolidayParkingWindow(
  campus: CampusDateTimeParts,
): HolidayWindow | null {
  const today = holidayByDate.get(campus.dateKey);

  // CampusParc defines a holiday window from 12:01 a.m.
  if (today && campus.minuteOfDay >= 1) {
    return { holiday: today, phase: "observed-date" };
  }

  // The window continues until (but not including) 3:00 a.m. the next day.
  const previousHoliday = holidayByDate.get(shiftDateKey(campus.dateKey, -1));
  if (previousHoliday && campus.minuteOfDay < 3 * 60) {
    return {
      holiday: previousHoliday,
      phase: "following-morning",
    };
  }

  return null;
}

/**
 * Classifies one instant using Columbus campus time, independently of the
 * browser or server time zone.
 *
 * Weekend off-peak is continuous from Friday 4 p.m. through Monday 3 a.m.;
 * Saturday/Sunday 3–5 a.m. therefore stays off-peak rather than becoming the
 * separate weekday overnight-storage period.
 */
export function classifyCampusParkingTime(
  at: InstantInput,
): ParkingTimeClassification {
  const campus = getCampusDateTimeParts(at);
  const isWeekend = campus.weekday === 0 || campus.weekday === 6;
  const isWeekendOffPeakWindow =
    (campus.weekday === 5 && campus.minuteOfDay >= 16 * 60) ||
    isWeekend ||
    (campus.weekday === 1 && campus.minuteOfDay < 3 * 60);
  const isOvernight =
    !isWeekend &&
    campus.minuteOfDay >= 3 * 60 &&
    campus.minuteOfDay < 5 * 60;
  const holidayWindow = getHolidayParkingWindow(campus);
  const isHoliday = holidayWindow !== null;
  const isOffPeak =
    isHoliday ||
    isWeekend ||
    campus.minuteOfDay < 3 * 60 ||
    campus.minuteOfDay >= 16 * 60;
  const isPeak =
    !isHoliday &&
    !isWeekend &&
    campus.minuteOfDay >= 5 * 60 &&
    campus.minuteOfDay < 16 * 60;

  const primary: ParkingPeriod = isHoliday
    ? "holiday"
    : isOvernight
      ? "overnight"
      : isOffPeak
        ? "off-peak"
        : "peak";

  const labels: Readonly<Record<ParkingPeriod, string>> = {
    peak: "工作日高峰时段",
    "off-peak": isWeekendOffPeakWindow
      ? "周末非高峰时段"
      : "工作日非高峰时段",
    overnight: "夜间停车时段（3–5 a.m.）",
    holiday: holidayWindow
      ? `${holidayWindow.holiday.nameZh}假日规则`
      : "大学假日规则",
  };

  return {
    primary,
    labelZh: labels[primary],
    campus,
    isPeak,
    isOffPeak,
    isOvernight,
    isWeekend,
    isHoliday,
    holiday: holidayWindow?.holiday ?? null,
    holidayCalendarCovered: campus.year === 2026 || campus.year === 2027,
  };
}

/** Visible official/general window for the current Columbus-time class. */
export function getParkingTimeRangeZh(
  time: ParkingTimeClassification,
  compact = false,
): string {
  if (time.primary === "peak") return compact ? "05–16" : "05:00–16:00";
  if (time.primary === "overnight") {
    return compact ? "03–05" : "03:00–05:00";
  }
  if (time.primary === "holiday") {
    return compact ? "假日–03" : "00:01–次日 03:00";
  }

  const isWeekendWindow =
    (time.campus.weekday === 5 && time.campus.minuteOfDay >= 16 * 60) ||
    time.campus.weekday === 0 ||
    time.campus.weekday === 6 ||
    (time.campus.weekday === 1 && time.campus.minuteOfDay < 3 * 60);
  if (isWeekendWindow) {
    return compact ? "五16–一03" : "周五 16:00–周一 03:00";
  }
  return compact ? "16–03" : "16:00–次日 03:00";
}

/** Short alias for UI code. */
export const classifyParkingTime = classifyCampusParkingTime;

export function isPeakParkingTime(at: InstantInput): boolean {
  return classifyCampusParkingTime(at).isPeak;
}

export function isOffPeakParkingTime(at: InstantInput): boolean {
  return classifyCampusParkingTime(at).isOffPeak;
}

export function isOvernightParkingTime(at: InstantInput): boolean {
  return classifyCampusParkingTime(at).isOvernight;
}

export function isHolidayParkingTime(at: InstantInput): boolean {
  return classifyCampusParkingTime(at).isHoliday;
}

export function isWithinPermitYear2026_27(at: InstantInput): boolean {
  const dateKey = getCampusDateTimeParts(at).dateKey;
  return (
    dateKey >= PERMIT_YEAR_2026_27.startsOn &&
    dateKey <= PERMIT_YEAR_2026_27.endsOn
  );
}

export interface PermitPlanningNotice {
  readonly tone: "info" | "warning" | "night";
  readonly titleZh: string;
  readonly detailZh: string;
  readonly minutesUntilChange?: number;
}

function scopeCoversEverySurfaceZone(scope: SurfaceScope) {
  return (
    scope === "all-unrestricted" ||
    new Set(scope).size >= ALL_A_SURFACE.length
  );
}

function formatCountdownZh(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} 分钟`;
  if (remainder === 0) return `${hours} 小时`;
  return `${hours} 小时 ${remainder} 分钟`;
}

/** A compact next-window hint shared by the dashboard and permit picker. */
export function getPermitPlanningNotice(
  permitCode: PermitCode,
  at: InstantInput,
): PermitPlanningNotice | undefined {
  const permit = getPermitByCode(permitCode);
  const time = classifyCampusParkingTime(at);

  if (time.primary === "overnight") {
    return permit.access.overnight.mode === "not-included"
      ? {
          tone: "warning",
          titleZh: "当前证件不含工作日夜间存放",
          detailZh:
            "证件图层显示无通用准停区是正常结果。仍可按规定使用 commuter late-night 指定区，或进入 24/7 访客车库、明确支持按小时付款的地面位并支付访客费用。",
        }
      : {
          tone: "night",
          titleZh: "当前处于工作日 3–5 a.m. 夜间窗口",
          detailZh: permit.access.overnight.detailZh,
        };
  }

  const expandsAtOffPeak =
    permit.access.offPeakSurface === "all-unrestricted" &&
    !scopeCoversEverySurfaceZone(permit.access.peakSurface);
  if (!expandsAtOffPeak) return undefined;

  if (time.isHoliday) {
    return {
      tone: "info",
      titleZh: "假日扩展权限已生效",
      detailZh:
        "一般非保留地面位按假日窗口开放至次日 3 a.m.；活动安排与现场标牌仍优先。",
    };
  }
  if (time.isWeekend) {
    return {
      tone: "info",
      titleZh: "周末扩展权限已生效",
      detailZh:
        "一般非保留地面位从周五 4 p.m. 连续开放至周一 3 a.m.，可提前选择中校区位置。",
    };
  }
  if (time.campus.minuteOfDay >= 16 * 60 || time.campus.minuteOfDay < 3 * 60) {
    return {
      tone: "info",
      titleZh: "4 p.m. 后扩展权限已生效",
      detailZh:
        "当前可使用 A / B / C / CX / WA / WB / WC / WCO 一般非保留地面位，工作日窗口至 3 a.m.。",
    };
  }

  const minutesUntilChange = 16 * 60 - time.campus.minuteOfDay;
  return {
    tone: minutesUntilChange <= 120 ? "warning" : "info",
    titleZh: `距地面权限扩展还有 ${formatCountdownZh(minutesUntilChange)}`,
    detailZh:
      "到 4 p.m. 后可使用所有一般非保留地面位；现在即可在地图查看 A / B / C / CX / WA / WB / WC / WCO 位置做规划。",
    minutesUntilChange,
  };
}

export interface ActiveParkingNotice {
  readonly titleZh: string;
  readonly detailZh: string;
  readonly officialUrl?: string;
}

export interface CurrentAccessSummary {
  readonly permit: PermitDefinition;
  readonly time: ParkingTimeClassification;
  readonly status: "allowed-with-conditions" | "check-required" | "not-included";
  readonly headlineZh: string;
  readonly surfaceZh: string;
  readonly garageZh: string;
  readonly detailZh: string;
  readonly warningsZh: readonly string[];
  readonly officialUrls: readonly string[];
}

function formatSurfaceScope(scope: SurfaceScope): string {
  if (scope === "all-unrestricted") {
    return "校园内一般非保留地面位";
  }
  return `${scope.join(" / ")} 非保留地面位`;
}

function isRemotePermit(code: PermitCode): boolean {
  return (
    code === "WA" ||
    code === "WAE" ||
    code === "CX" ||
    code === "WB" ||
    code === "CXC" ||
    code === "WC" ||
    code === "WCE" ||
    code === "WCO"
  );
}

function hasFridayNinthGarageWindow(
  time: ParkingTimeClassification,
): boolean {
  return (
    time.isHoliday ||
    time.isWeekend ||
    (time.campus.weekday === 5 && time.campus.minuteOfDay >= 14 * 60)
  );
}

function currentGarageSummary(
  permit: PermitDefinition,
  time: ParkingTimeClassification,
): string {
  const { garage } = permit.access;

  if (garage.mode === "none") {
    return garage.detailZh;
  }

  if (garage.mode === "weekend-ninth") {
    return hasFridayNinthGarageWindow(time)
      ? garage.detailZh
      : "当前不在该证件的 9th Avenue East/West Garage 周末/假日开放窗口。";
  }

  if (garage.mode === "off-peak") {
    return time.isOffPeak && !time.isOvernight
      ? garage.detailZh
      : time.isOvernight
        ? permit.access.overnight.detailZh
        : "当前高峰时段不含一般车库权限。";
  }

  return garage.detailZh;
}

/**
 * Builds conservative user-facing guidance for a permit at one instant.
 * Pass a live CampusParc event notice when the application has one; doing so
 * intentionally downgrades the result to "check-required".
 */
export function getCurrentAccessSummary(
  permitCode: PermitCode,
  at: InstantInput,
  activeNotice?: ActiveParkingNotice,
): CurrentAccessSummary {
  const permit = getPermitByCode(permitCode);
  const time = classifyCampusParkingTime(at);
  const overnightIncluded =
    permit.access.overnight.mode !== "not-included";

  let surfaceZh: string;
  if (time.isHoliday && isRemotePermit(permit.code)) {
    surfaceZh =
      "按大学假日的一般规则，可使用中校区 A / B / C / CX 非保留地面位。";
  } else if (time.primary === "overnight") {
    surfaceZh = permit.access.overnight.detailZh;
  } else {
    const scope = time.isOffPeak
      ? permit.access.offPeakSurface
      : permit.access.peakSurface;
    surfaceZh = `一般可使用 ${formatSurfaceScope(scope)}。`;
  }

  const garageZh =
    time.primary === "overnight"
      ? permit.access.overnight.detailZh
      : currentGarageSummary(permit, time);

  const warningsZh = [
    PERMIT_FACTS_DISCLAIMER_ZH,
    "ADA、预留、州公务车、装卸区、按小时收费位等受限车位不会因一般停车证或非高峰规则自动开放。",
    "把车辆停在同一地点超过 72 小时前，应先联系 CampusParc 获得确认。",
  ];

  if (!time.holidayCalendarCovered) {
    warningsZh.push(
      "当前日期超出内置的 2026–2027 假日日历，不能据此排除当日为大学假日。",
    );
  }

  if (!isWithinPermitYear2026_27(at)) {
    warningsZh.push("当前日期不在 2026–27 证件年度内，价格与权限可能已经变更。");
  }

  if (activeNotice) {
    warningsZh.unshift(`${activeNotice.titleZh}：${activeNotice.detailZh}`);
  }

  const status: CurrentAccessSummary["status"] = activeNotice
    ? "check-required"
    : time.primary === "overnight" && !overnightIncluded
      ? "not-included"
      : time.primary === "holiday" ||
          (time.primary === "overnight" &&
            permit.access.overnight.mode === "verify-garage-table")
        ? "check-required"
        : "allowed-with-conditions";

  const officialUrls = [
    permit.officialUrl,
    OFFICIAL_PARKING_URLS.parkingPolicies,
    OFFICIAL_PARKING_URLS.parkingNews,
    ...(activeNotice?.officialUrl ? [activeNotice.officialUrl] : []),
  ];

  return {
    permit,
    time,
    status,
    headlineZh: `${permit.officialCode} · ${time.labelZh}`,
    surfaceZh,
    garageZh,
    detailZh: `${surfaceZh} ${garageZh}`,
    warningsZh,
    officialUrls,
  };
}
