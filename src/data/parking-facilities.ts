/**
 * Structured CampusParc facility facts for the 20 aggregate locations shown by
 * the live parking feed. All facility pages and the PY26-27 rate table were
 * checked against the official CampusParc site on 2026-08-04.
 *
 * This data deliberately keeps published facility facts separate from live
 * occupancy. Capacity in this file is CampusParc's public facility capacity;
 * the live feed remains the authority for the current count and operational
 * status. Posted signs, event controls and entrance messages always take
 * precedence.
 */

export const PARKING_FACILITY_DATA_SOURCES = {
  verifiedOn: "2026-08-04",
  finder: "https://osu.campusparc.com/find-parking/",
  visitorParking:
    "https://osu.campusparc.com/find-parking/academic-visitor-parking/",
  rateTable:
    "https://osu.campusparc.com/media/nrwpruj1/py26-27-rate-table.pdf",
  lateNight:
    "https://osu.campusparc.com/find-parking/long-term-and-late-night-parking/",
  parkingPolicies:
    "https://osu.campusparc.com/resources/parking-policies/",
} as const;

export type FacilityAccessWindow = "all-times" | "off-peak" | "none";

export type ParkingRateProfileId =
  | "academic-garage"
  | "medical-center-garage"
  | "surface-hourly";

export type ParkingPaymentProfileId =
  | "pay-on-foot"
  | "pay-in-lane"
  | "exit-card"
  | "medical-posted"
  | "surface-mobile-or-kiosk"
  | "permit-only";

export interface ParkingFacilityCapacity {
  readonly total: number;
  readonly accessible: number;
  readonly valet?: number;
}

export interface ParkingFacilityDetails {
  /** CampusParc GarageId from the live status feed. */
  readonly garageId: number;
  readonly officialName: string;
  /** Direct facility page, never a generic homepage or API endpoint. */
  readonly officialUrl: string;
  readonly address: string;
  /** Human-readable published clearance; null for surface lots. */
  readonly clearance: string | null;
  readonly capacity: ParkingFacilityCapacity;
  readonly access: {
    readonly visitor: FacilityAccessWindow;
    readonly permit: FacilityAccessWindow;
    /** Facility access remains subject to the holder's specific permit table. */
    readonly permitSpecific: boolean;
  };
  /** Present only for the aggregate surface rows represented in this app. */
  readonly surfaceZones?: readonly ("CX" | "WA" | "WB")[];
  readonly rateProfile: ParkingRateProfileId | null;
  readonly paymentProfile: ParkingPaymentProfileId;
  readonly nearbyPoints: readonly string[];
  readonly services: readonly string[];
}

type ParkingRateProfile = {
  readonly labelZh: string;
  readonly startingRateZh: string;
  readonly hourlyUsd?: number;
  readonly halfHourUsd?: number;
  readonly oneHourUsd?: number;
  readonly twoHoursUsd?: number;
  readonly threeHoursUsd?: number;
  readonly fourHoursUsd?: number;
  readonly dailyMaximumUsd?: number;
  readonly offPeakMaximumUsd: number;
  readonly detailZh: string;
};

export const PARKING_RATE_PROFILES = {
  "academic-garage": {
    labelZh: "Academic 访客车库",
    startingRateZh: "$3.00 / 30 分钟",
    halfHourUsd: 3,
    oneHourUsd: 6,
    twoHoursUsd: 10,
    threeHoursUsd: 14,
    fourHoursUsd: 18,
    dailyMaximumUsd: 20,
    offPeakMaximumUsd: 12,
    detailZh: "1/2/3/4 小时分别为 $6 / $10 / $14 / $18",
  },
  "medical-center-garage": {
    labelZh: "医学中心访客车库",
    startingRateZh: "$2.25 / 30 分钟",
    halfHourUsd: 2.25,
    oneHourUsd: 4.75,
    twoHoursUsd: 8,
    threeHoursUsd: 11,
    fourHoursUsd: 14.25,
    dailyMaximumUsd: 15.75,
    offPeakMaximumUsd: 9.5,
    detailZh: "1/2/3/4 小时分别为 $4.75 / $8 / $11 / $14.25",
  },
  "surface-hourly": {
    labelZh: "按小时地面位",
    startingRateZh: "$3.00 / 小时",
    hourlyUsd: 3,
    offPeakMaximumUsd: 12,
    detailZh: "只可使用现场明确标出的按小时付款位置",
  },
} as const satisfies Readonly<Record<ParkingRateProfileId, ParkingRateProfile>>;

export const PARKING_PAYMENT_PROFILES: Readonly<
  Record<
    ParkingPaymentProfileId,
    { readonly labelZh: string; readonly detailZh: string }
  >
> = {
  "pay-on-foot": {
    labelZh: "离场前在步行付款机支付",
    detailZh: "付款机接受现金、银行卡和 validation；出口车道不收现金。",
  },
  "pay-in-lane": {
    labelZh: "出口 Pay-in-Lane 支付",
    detailZh: "接受现金、硬币、voucher、借记卡与信用卡；现金找零仅为硬币。",
  },
  "exit-card": {
    labelZh: "出口车道支付",
    detailZh: "接受信用卡和借记卡，不接受现金。",
  },
  "medical-posted": {
    labelZh: "按医学中心入口与付款设备支付",
    detailZh: "官网列出主流信用卡；患者验证优惠及具体付款流程以现场为准。",
  },
  "surface-mobile-or-kiosk": {
    labelZh: "ParkMobile 或 Pay-by-Plate",
    detailZh: "ParkMobile 可续时；Pay-by-Plate 机器只收信用卡且不退款。",
  },
  "permit-only": {
    labelZh: "不提供访客付费入口",
    detailZh: "此设施官方页面标为无访客通行，不能用付款代替停车证权限。",
  },
};

export const PARKING_FACILITIES = [
  {
    garageId: 294,
    officialName: "12th Avenue Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/12th-avenue-garage/",
    address: "340 W 12th Ave, Columbus, OH 43210",
    clearance: "7′0″",
    capacity: { total: 642, accessible: 53 },
    access: { visitor: "all-times", permit: "off-peak", permitSpecific: true },
    rateProfile: "medical-center-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: [
      "Doan and Rhodes Halls",
      "The James Cancer Hospital",
      "Comprehensive Cancer Center",
      "Ohio State Dental Clinics",
    ],
    services: [],
  },
  {
    garageId: 63,
    officialName: "9th Avenue East Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/9th-avenue-east-garage/",
    address: "345 W 9th Ave, Columbus, OH 43210",
    clearance: "8′2″",
    capacity: { total: 991, accessible: 22 },
    access: { visitor: "off-peak", permit: "all-times", permitSpecific: true },
    rateProfile: "medical-center-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Meiling Hall", "Graves Hall", "OSU Medical Center"],
    services: ["EV chargers on Level One"],
  },
  {
    garageId: 107,
    officialName: "9th Avenue West Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/9th-avenue-west-garage/",
    address: "355 W 9th Ave, Columbus, OH 43210",
    clearance: "7′8″",
    capacity: { total: 1057, accessible: 34 },
    access: { visitor: "none", permit: "all-times", permitSpecific: true },
    rateProfile: null,
    paymentProfile: "permit-only",
    nearbyPoints: ["Meiling Hall", "Graves Hall", "Wexner Medical Center"],
    services: ["Self-service air pump near north exits"],
  },
  {
    garageId: 158,
    officialName: "SAFEAUTO Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/safeauto-garage/",
    address: "1585 Westpark St, Columbus, OH 43210",
    clearance: "8′2″",
    capacity: { total: 826, accessible: 24 },
    access: { visitor: "all-times", permit: "none", permitSpecific: false },
    rateProfile: "medical-center-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: [
      "Doan and Rhodes Halls",
      "Ross Heart Hospital",
      "Hospital Clinic",
      "Panera Bread",
    ],
    services: [],
  },
  {
    garageId: 347,
    officialName: "Wexner Medical Center Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/wexner-medical-center-garage/",
    address: "527 W 10th Ave, Columbus, OH 43210",
    clearance: "8′2″",
    capacity: { total: 1871, accessible: 116 },
    access: { visitor: "all-times", permit: "off-peak", permitSpecific: true },
    rateProfile: "medical-center-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["The James Cancer Hospital", "Harding Hospital", "McCampbell Hall"],
    services: ["EV chargers on Level One"],
  },
  {
    garageId: 348,
    officialName: "Old Cannon Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/old-cannon-garage/",
    address: "1512 Old Cannon Dr, Columbus, OH 43210",
    clearance: "8′2″",
    capacity: { total: 1128, accessible: 20 },
    access: { visitor: "none", permit: "all-times", permitSpecific: true },
    rateProfile: null,
    paymentProfile: "permit-only",
    nearbyPoints: ["Wexner Medical Center", "Dodd Rehabilitation Hospital", "Evans Hall"],
    services: ["EV chargers on Level One"],
  },
  {
    garageId: 40,
    officialName: "Neil Avenue Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/neil-avenue-garage/",
    address: "1801 Neil Ave, Columbus, OH 43210",
    clearance: "7′6″",
    capacity: { total: 978, accessible: 21 },
    access: { visitor: "off-peak", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-in-lane",
    nearbyPoints: ["Campbell Hall", "RPAC", "Cunz Hall", "Thompson Library"],
    services: ["Self-service air pump on ground floor"],
  },
  {
    garageId: 3000,
    officialName: "11th Avenue Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/11th-avenue-garage/",
    address: "229 W 11th Ave, Columbus, OH 43210",
    clearance: "7′0″",
    capacity: { total: 646, accessible: 19 },
    access: { visitor: "all-times", permit: "off-peak", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-in-lane",
    nearbyPoints: ["Jesse Owens Recreation Center South", "Younkin Success Center"],
    services: [],
  },
  {
    garageId: 137,
    officialName: "Ohio Union North Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/ohio-union-north-garage/",
    address: "1780 College Rd, Columbus, OH 43210",
    clearance: "6′10″",
    capacity: { total: 604, accessible: 15 },
    access: { visitor: "off-peak", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Ohio Union", "Sullivant Hall", "Page Hall", "The Oval"],
    services: [],
  },
  {
    garageId: 181,
    officialName: "Ohio Union South Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/ohio-union-south-garage/",
    address: "1759 N High St, Columbus, OH 43210",
    clearance: "7′6″",
    capacity: { total: 790, accessible: 17 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Ohio Union", "Sullivant Hall", "Page Hall", "The Oval"],
    services: [],
  },
  {
    garageId: 346,
    officialName: "Gateway Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/gateway-garage/",
    address: "75 E 11th Ave, Columbus, OH 43201",
    clearance: "8′2″",
    capacity: { total: 1176, accessible: 22 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Gateway Film Center", "Gateway shops and restaurants"],
    services: ["EV chargers on Level One"],
  },
  {
    garageId: 93,
    officialName: "Tuttle Park Place Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/tuttle-park-place-garage/",
    address: "2050 Tuttle Park Pl, Columbus, OH 43210",
    clearance: "8′2″ first floor; 7′0″ all other floors",
    capacity: { total: 965, accessible: 18 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Ohio Stadium", "The Blackwell Inn", "RPAC", "St. John Arena"],
    services: ["Self-service air pump near exit"],
  },
  {
    garageId: 70,
    officialName: "Northwest Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/northwest-garage/",
    address: "271 Ives Dr, Columbus, OH 43210",
    clearance: "6′10″",
    capacity: { total: 643, accessible: 17 },
    access: { visitor: "none", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Knowlton School of Architecture", "Engineering and Aviation"],
    services: [],
  },
  {
    garageId: 3,
    officialName: "Arps Garage",
    officialUrl: "https://osu.campusparc.com/find-parking/arps-garage/",
    address: "1990 College Rd, Columbus, OH 43210",
    clearance: "6′8″",
    capacity: { total: 892, accessible: 31 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Ramseyer Hall", "Wexner Center for the Arts", "Mershon Auditorium"],
    services: [],
  },
  {
    garageId: 255,
    officialName: "Lane Avenue Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/lane-avenue-garage/",
    address: "2105 Neil Ave, Columbus, OH 43210",
    clearance: "7′3″",
    capacity: { total: 1296, accessible: 18 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "pay-on-foot",
    nearbyPoints: ["Fisher College of Business", "Blackwell Hotel", "Ohio Stadium"],
    services: ["EV chargers on Level Two"],
  },
  {
    garageId: 239,
    officialName: "West Lane Avenue Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/west-lane-avenue-garage/",
    address: "322 W Lane Ave, Columbus, OH 43210",
    clearance: "6′10″",
    capacity: { total: 280, accessible: 5 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    rateProfile: "academic-garage",
    paymentProfile: "exit-card",
    nearbyPoints: [
      "Student Academic Services Building",
      "Jesse Owens North Recreation Center",
      "Fisher graduate programs",
    ],
    services: [],
  },
  {
    garageId: 1,
    officialName: "James Outpatient Care Garage",
    officialUrl:
      "https://osu.campusparc.com/find-parking/james-outpatient-care-garage/",
    address: "2061 Kenny Rd, Columbus, OH 43210",
    clearance: "8′2″",
    capacity: { total: 631, accessible: 55, valet: 79 },
    access: { visitor: "all-times", permit: "none", permitSpecific: false },
    rateProfile: "medical-center-garage",
    paymentProfile: "medical-posted",
    nearbyPoints: ["James Outpatient Care Facility", "Pelotonia Research Center"],
    services: ["EV chargers on Level Two"],
  },
  {
    garageId: 3002,
    officialName: "Carmack Lot 2 & 3",
    officialUrl:
      "https://osu.campusparc.com/find-parking/carmack-lot-23/",
    address: "999–1049 Carmack Rd, Columbus, OH 43210",
    clearance: null,
    capacity: { total: 1732, accessible: 13 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    surfaceZones: ["WA", "WB"],
    rateProfile: "surface-hourly",
    paymentProfile: "surface-mobile-or-kiosk",
    nearbyPoints: ["Ohio Supercomputer Center", "Bevis Hall", "Byrd Polar and Climate Research Center"],
    services: ["Self-service air pump at northwest corner of Carmack 3"],
  },
  {
    garageId: 3003,
    officialName: "Carmack Lot 4",
    officialUrl:
      "https://osu.campusparc.com/find-parking/carmack-lot-4/",
    address: "999–1049 Carmack Rd, Columbus, OH 43210",
    clearance: null,
    capacity: { total: 231, accessible: 0 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    surfaceZones: ["WB"],
    rateProfile: "surface-hourly",
    paymentProfile: "surface-mobile-or-kiosk",
    nearbyPoints: ["Byrd Polar and Climate Research Center", "Speech-Language Clinic", "Bevis Hall"],
    services: [],
  },
  {
    garageId: 3005,
    officialName: "Buckeye Lots",
    officialUrl:
      "https://osu.campusparc.com/find-parking/buckeye-lot/",
    address: "2701 Fred Taylor Dr, Columbus, OH 43210",
    clearance: null,
    capacity: { total: 2420, accessible: 24 },
    access: { visitor: "all-times", permit: "all-times", permitSpecific: true },
    surfaceZones: ["CX"],
    rateProfile: "surface-hourly",
    paymentProfile: "surface-mobile-or-kiosk",
    nearbyPoints: ["Jameson Crane Sports Medicine Institute", "Wexner Medical Center Training Center", "Covelli Center"],
    services: [],
  },
] as const satisfies readonly ParkingFacilityDetails[];

const PARKING_FACILITY_BY_GARAGE_ID: ReadonlyMap<
  number,
  ParkingFacilityDetails
> = new Map(PARKING_FACILITIES.map((facility) => [facility.garageId, facility]));

export function getParkingFacilityDetails(
  garageId: number,
): ParkingFacilityDetails | undefined {
  return PARKING_FACILITY_BY_GARAGE_ID.get(garageId);
}

export const FACILITY_ACCESS_LABELS_ZH: Readonly<
  Record<FacilityAccessWindow, string>
> = {
  "all-times": "全天开放",
  "off-peak": "仅非高峰开放",
  none: "不开放",
};

const ALL_TIMES_PAID_VISITOR_FACILITIES = PARKING_FACILITIES.filter(
  (facility) =>
    facility.access.visitor === "all-times" && facility.rateProfile !== null,
);

/**
 * Official paid fallback when a permit does not include weekday 3–5 a.m.
 * storage. These are not permit entitlements: the driver must use a marked
 * hourly space/visitor entrance and pay the posted visitor rate.
 */
export const PAID_OVERNIGHT_PARKING_GUIDANCE = {
  windowZh: "工作日 3–5 a.m.",
  sourceUrl: PARKING_FACILITY_DATA_SOURCES.visitorParking,
  verifiedOn: PARKING_FACILITY_DATA_SOURCES.verifiedOn,
  academicGarageIds: ALL_TIMES_PAID_VISITOR_FACILITIES.filter(
    (facility) => facility.rateProfile === "academic-garage",
  ).map((facility) => facility.garageId),
  medicalCenterGarageIds: ALL_TIMES_PAID_VISITOR_FACILITIES.filter(
    (facility) => facility.rateProfile === "medical-center-garage",
  ).map((facility) => facility.garageId),
  mappedSurfaceLotIds: ALL_TIMES_PAID_VISITOR_FACILITIES.filter(
    (facility) => facility.rateProfile === "surface-hourly",
  ).map((facility) => facility.garageId),
  surfaceScopeZh: "所有现场明确支持按小时付款的地面位",
  warningZh:
    "必须走访客入口或停入明确标出的按小时位置并完成付款；普通停车证、late-night 指定区和访客付费停车是三套不同规则。",
} as const;

export function getFacilityNamesByGarageIds(
  garageIds: readonly number[],
): readonly string[] {
  return garageIds.flatMap((garageId) => {
    const facility = getParkingFacilityDetails(garageId);
    return facility ? [facility.officialName] : [];
  });
}
