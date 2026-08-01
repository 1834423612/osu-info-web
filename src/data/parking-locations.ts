/**
 * Static map metadata for the locations returned by
 * https://garageapi.campusparc.com/status.
 *
 * Garage coordinates and addresses come from Ohio State's FITS ArcGIS
 * Buildings layer. Coordinates for the three surface-lot records are map
 * centroids because those lots are not represented as buildings.
 *
 * `coordinates` intentionally follows the GeoJSON/MapLibre order:
 * [longitude, latitude].
 */

export type ParkingLocationKind = "garage" | "lot";

export type ParkingRegion =
  | "medical-center"
  | "south-campus"
  | "academic-core"
  | "west-campus"
  | "north-campus";

export type CabsRouteCode =
  | "BE"
  | "CC"
  | "CLS"
  | "ER"
  | "MC"
  | "NWC"
  | "ACK"
  | "JPS"
  | "MM"
  | "WMC";

export interface CabsRouteHint {
  readonly route: CabsRouteCode;
  readonly stop: string;
  /** True when the route stops at the lot/garage rather than a short walk away. */
  readonly direct?: boolean;
}

export interface CampusEvCharging {
  readonly level: 2;
  readonly network: "ChargePoint";
  readonly configuration: "dual-head";
}

export interface ParkingLocation {
  /** CampusParc's GarageId from the live status response. */
  readonly garageId: number;
  /** OSU building/location identifier exposed by the live status response. */
  readonly osuId: string;
  /** Exact GarageName used by the CampusParc status API. */
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly kind: ParkingLocationKind;
  readonly coordinates: readonly [longitude: number, latitude: number];
  readonly address: string;
  readonly region: ParkingRegion;
  /** Convenience flag for filters and map marker styling. */
  readonly hasEvCharging: boolean;
  /** Official on-campus Level 2 equipment; null means none is listed at the site. */
  readonly evCharging: CampusEvCharging | null;
  /** Nearby fixed-route CABS or medical-center shuttle stops. */
  readonly nearbyCabs: readonly CabsRouteHint[];
  readonly notes: string;
}

export const PARKING_REGION_LABELS: Readonly<Record<ParkingRegion, string>> = {
  "medical-center": "Wexner Medical Center",
  "south-campus": "South Campus",
  "academic-core": "Academic Core",
  "west-campus": "West Campus",
  "north-campus": "North Campus",
};

export const CABS_ROUTE_LABELS: Readonly<Record<CabsRouteCode, string>> = {
  BE: "Buckeye Express",
  CC: "Campus Connector",
  CLS: "Campus Loop South",
  ER: "East Residential",
  MC: "Med Center Express",
  NWC: "Northwest Connector",
  ACK: "Ackerman Shuttle",
  JPS: "James Parking Shuttle",
  MM: "Morehouse to Med Center",
  WMC: "Wexner Medical Center Shuttle",
};

export const OSU_EV_CHARGING_SOURCE =
  "https://ttm.osu.edu/other-transit-and-services/electric-charging-stations";

export const CABS_STOP_LIST_SOURCE = "https://ttm.osu.edu/cabs-bus-stop-list";

const CAMPUS_EV_LEVEL_2: CampusEvCharging = {
  level: 2,
  network: "ChargePoint",
  configuration: "dual-head",
};

export const PARKING_LOCATIONS = [
  {
    garageId: 294,
    osuId: "387",
    name: "12th Avenue",
    aliases: ["12th Avenue Garage", "Twelfth Avenue Garage"],
    kind: "garage",
    coordinates: [-83.01740631, 39.99650726],
    address: "340 W 12th Ave, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [{ route: "MC", stop: "Doan Hall" }],
    notes: "Closest to Doan and Rhodes halls, the James and the dental clinics.",
  },
  {
    garageId: 63,
    osuId: "875",
    name: "9th Avenue East",
    aliases: [
      "9th Avenue East Garage",
      "Ninth Avenue East Garage",
      "Ninth East Parking Garage",
    ],
    kind: "garage",
    coordinates: [-83.01557041, 39.99297309],
    address: "345 W 9th Ave, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [{ route: "ACK", stop: "Meiling Hall" }],
    notes: "Near Meiling and Graves halls; official Level 2 charging is on site.",
  },
  {
    garageId: 107,
    osuId: "359",
    name: "9th Avenue West",
    aliases: ["9th Avenue West Garage", "Ninth Avenue West Garage"],
    kind: "garage",
    coordinates: [-83.01666659, 39.99273798],
    address: "355 W 9th Ave, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [{ route: "ACK", stop: "Meiling Hall" }],
    notes: "West-side medical-center garage near Meiling and Graves halls.",
  },
  {
    garageId: 158,
    osuId: "170",
    name: "SAFEAUTO",
    aliases: ["SAFEAUTO Garage", "SafeAuto Hospitals Garage"],
    kind: "garage",
    coordinates: [-83.01824208, 39.99345837],
    address: "1585 Westpark St, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "ACK", stop: "Doan Hall" },
      { route: "WMC", stop: "Ross Heart Hospital" },
    ],
    notes: "Visitor-focused garage with convenient access to Rhodes and Ross.",
  },
  {
    garageId: 347,
    osuId: "1028",
    name: "Medical Center",
    aliases: ["Wexner Medical Center Garage", "Medical Center Garage"],
    kind: "garage",
    coordinates: [-83.0213822513, 39.993151393],
    address: "527 W 10th Ave, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [
      {
        route: "WMC",
        stop: "Wexner Medical Center Garage Gray / Scarlet entrances",
        direct: true,
      },
      {
        route: "JPS",
        stop: "Wexner Medical Center Garage Gray / Scarlet entrances",
        direct: true,
      },
    ],
    notes: "Serves the James, Harding Hospital and McCampbell Hall.",
  },
  {
    garageId: 348,
    osuId: "1059",
    name: "Old Cannon",
    aliases: ["Old Cannon Garage", "Dodd Hall Garage"],
    kind: "garage",
    coordinates: [-83.0198295016, 39.9917219234],
    address: "1512 Old Cannon Dr, Columbus, OH 43210",
    region: "medical-center",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [
      { route: "WMC", stop: "University Hospital / Rhodes Hall" },
    ],
    notes: "Near Dodd Rehabilitation Hospital and Evans Hall.",
  },
  {
    garageId: 40,
    osuId: "287",
    name: "Neil Avenue",
    aliases: ["Neil Avenue Garage"],
    kind: "garage",
    coordinates: [-83.01742797, 39.99762339],
    address: "1801 Neil Ave, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "CC", stop: "Herrick Drive Transit Hub" },
      { route: "CLS", stop: "Herrick Drive Transit Hub" },
    ],
    notes: "Central option for RPAC, Cunz Hall and Thompson Library.",
  },
  {
    garageId: 3000,
    osuId: "352",
    name: "11th Avenue",
    aliases: ["11th Avenue Garage", "Eleventh Avenue Garage"],
    kind: "garage",
    coordinates: [-83.01301546, 39.9951312],
    address: "229 W 11th Ave, Columbus, OH 43210",
    region: "south-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "CC", stop: "11th and Worthington", direct: true },
      { route: "CLS", stop: "11th and Worthington", direct: true },
    ],
    notes: "Near Jesse Owens Recreation Center South and Younkin Success Center.",
  },
  {
    garageId: 137,
    osuId: "288",
    name: "Ohio Union North",
    aliases: ["Ohio Union North Garage"],
    kind: "garage",
    coordinates: [-83.00893335, 39.99888119],
    address: "1780 College Rd, Columbus, OH 43210",
    region: "south-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "Ohio Union Northbound", direct: true },
      { route: "CC", stop: "Ohio Union Northbound", direct: true },
      { route: "CLS", stop: "Ohio Union Northbound", direct: true },
      { route: "ER", stop: "Ohio Union Northbound", direct: true },
    ],
    notes: "North side of the Ohio Union, close to the Oval and arts venues.",
  },
  {
    garageId: 181,
    osuId: "162",
    name: "Ohio Union South",
    aliases: ["Ohio Union South Garage"],
    kind: "garage",
    coordinates: [-83.0088335, 39.99835062],
    address: "1759 N High St, Columbus, OH 43210",
    region: "south-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "CC", stop: "Ohio Union Southbound", direct: true },
      { route: "BE", stop: "Ohio Union Northbound" },
      { route: "CLS", stop: "Ohio Union Northbound" },
      { route: "ER", stop: "Ohio Union Northbound" },
    ],
    notes: "South side of the Ohio Union with direct access from High Street.",
  },
  {
    garageId: 346,
    osuId: "866",
    name: "Gateway",
    aliases: ["Gateway Garage", "South Campus Gateway"],
    kind: "garage",
    coordinates: [-83.00520016, 39.99405868],
    address: "75 E 11th Ave, Columbus, OH 43201",
    region: "south-campus",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [
      { route: "ER", stop: "11th and High Street Westbound" },
    ],
    notes: "Serves the Gateway district; official Level 2 charging is on site.",
  },
  {
    garageId: 93,
    osuId: "88",
    name: "Tuttle",
    aliases: ["Tuttle Garage", "Tuttle Park Place Garage"],
    kind: "garage",
    coordinates: [-83.0171453, 40.00285342],
    address: "2050 Tuttle Park Pl, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "St. John Arena" },
      { route: "CC", stop: "St. John Arena" },
      { route: "CLS", stop: "St. John Arena" },
    ],
    notes: "Convenient for Ohio Stadium, RPAC, St. John Arena and the Blackwell.",
  },
  {
    garageId: 70,
    osuId: "83",
    name: "Northwest",
    aliases: ["Northwest Garage"],
    kind: "garage",
    coordinates: [-83.01618113, 40.00295087],
    address: "271 Ives Dr, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "Knowlton Hall" },
      { route: "CC", stop: "Fontana Lab" },
      { route: "CLS", stop: "Fontana Lab" },
    ],
    notes: "Best suited to Knowlton Hall and the northwest engineering area.",
  },
  {
    garageId: 3,
    osuId: "278",
    name: "Arps",
    aliases: ["Arps Garage", "Arps Hall Garage"],
    kind: "garage",
    coordinates: [-83.00996725, 40.00276967],
    address: "1990 College Rd, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "Arps Hall", direct: true },
      { route: "CC", stop: "Arps Hall", direct: true },
      { route: "CLS", stop: "Arps Hall", direct: true },
      { route: "ER", stop: "Arps Hall", direct: true },
    ],
    notes: "Central-north garage near Ramseyer, Wexner Center and Mershon.",
  },
  {
    garageId: 255,
    osuId: "159",
    name: "Lane Avenue",
    aliases: ["Lane Avenue Garage"],
    kind: "garage",
    coordinates: [-83.01617021, 40.00561224],
    address: "2105 Neil Ave, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [
      { route: "BE", stop: "Mason Hall" },
      { route: "CC", stop: "Mason Hall" },
      { route: "CLS", stop: "Mason Hall" },
    ],
    notes: "Near Fisher, the Blackwell and north-campus athletics facilities.",
  },
  {
    garageId: 239,
    osuId: "892",
    name: "West Lane Avenue",
    aliases: ["West Lane Avenue Garage", "West Lane Garage"],
    kind: "garage",
    coordinates: [-83.01796821, 40.00720963],
    address: "322 W Lane Ave, Columbus, OH 43210",
    region: "academic-core",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "St. John Arena" },
      { route: "CC", stop: "St. John Arena" },
      { route: "CLS", stop: "St. John Arena" },
    ],
    notes: "Compact garage near SASB, Fisher and Jesse Owens North.",
  },
  {
    garageId: 1,
    osuId: "1051",
    name: "James Outpatient Care",
    aliases: ["James Outpatient Care Garage", "JOC Garage"],
    kind: "garage",
    coordinates: [-83.0352887184, 40.0011071459],
    address: "2061 Kenny Rd, Columbus, OH 43221",
    region: "west-campus",
    hasEvCharging: true,
    evCharging: CAMPUS_EV_LEVEL_2,
    nearbyCabs: [
      {
        route: "MM",
        stop: "The James Outpatient Care",
        direct: true,
      },
    ],
    notes: "Dedicated access for James Outpatient Care and Pelotonia Research.",
  },
  {
    garageId: 3002,
    osuId: "101",
    name: "Carmack Lot - 2/3",
    aliases: ["Carmack 2/3", "Carmack Lots 2 and 3"],
    kind: "lot",
    coordinates: [-83.0387, 40.001],
    address: "999–1049 Carmack Rd, Columbus, OH 43210",
    region: "west-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "MC", stop: "Carmack 2", direct: true },
      { route: "MC", stop: "Carmack 3", direct: true },
    ],
    notes: "Large west-campus park-and-ride area with direct Med Center Express stops.",
  },
  {
    garageId: 3003,
    osuId: "102",
    name: "Carmack Lot - 4",
    aliases: ["Carmack 4", "Carmack Lot 4"],
    kind: "lot",
    coordinates: [-83.040969, 40.001023],
    address: "999–1049 Carmack Rd, Columbus, OH 43210",
    region: "west-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "MC", stop: "Carmack 3" },
      { route: "CC", stop: "Carmack 5" },
    ],
    notes: "Western Carmack lot; verify temporary road and stop changes before travel.",
  },
  {
    garageId: 3005,
    osuId: "104",
    name: "Buckeye Lot",
    aliases: ["Buckeye Parking Lot"],
    kind: "lot",
    coordinates: [-83.031, 40.0156],
    address: "2701 Fred Taylor Dr, Columbus, OH 43210",
    region: "north-campus",
    hasEvCharging: false,
    evCharging: null,
    nearbyCabs: [
      { route: "BE", stop: "Buckeye Lot", direct: true },
      { route: "CLS", stop: "Buckeye Lot", direct: true },
    ],
    notes: "Large north-campus lot with direct service to the academic core.",
  },
] as const satisfies readonly ParkingLocation[];

export const PARKING_LOCATION_COUNT = PARKING_LOCATIONS.length;

export const PARKING_LOCATION_BY_GARAGE_ID: ReadonlyMap<
  number,
  ParkingLocation
> = new Map(
  PARKING_LOCATIONS.map((location) => [location.garageId, location]),
);

export const PARKING_LOCATION_BY_OSU_ID: ReadonlyMap<string, ParkingLocation> =
  new Map(PARKING_LOCATIONS.map((location) => [location.osuId, location]));

function normalizeParkingName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PARKING_LOCATION_BY_NORMALIZED_NAME: ReadonlyMap<
  string,
  ParkingLocation
> = new Map(
  PARKING_LOCATIONS.flatMap((location) =>
    [location.name, ...(location.aliases ?? [])].map((name) => [
      normalizeParkingName(name),
      location,
    ]),
  ),
);

export function getParkingLocationByGarageId(
  garageId: number,
): ParkingLocation | undefined {
  return PARKING_LOCATION_BY_GARAGE_ID.get(garageId);
}

export function getParkingLocationByOsuId(
  osuId: string,
): ParkingLocation | undefined {
  return PARKING_LOCATION_BY_OSU_ID.get(osuId);
}

export function getParkingLocationByName(
  name: string,
): ParkingLocation | undefined {
  return PARKING_LOCATION_BY_NORMALIZED_NAME.get(normalizeParkingName(name));
}

export function getParkingLocationsByRegion(
  region: ParkingRegion,
): readonly ParkingLocation[] {
  return PARKING_LOCATIONS.filter((location) => location.region === region);
}

export function getParkingLocationsWithEvCharging(): readonly ParkingLocation[] {
  return PARKING_LOCATIONS.filter((location) => location.hasEvCharging);
}
