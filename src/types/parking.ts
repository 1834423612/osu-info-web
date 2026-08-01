export type GarageApiItem = {
  GarageId: number;
  GarageName: string;
  GarageCount: number;
  GarageCapacity: number;
  UsePercentage: number;
  GarageType: number;
  GarageUrl: string;
  OSUID: string;
  Modified: string;
  Closed: boolean;
};

export type GarageApiResponse = {
  Garages: GarageApiItem[];
};

export type ParkingFeedState = "loading" | "live" | "cached" | "error";

export type ParkingKind = "garage" | "surface";

export type ParkingRegion =
  | "academic-core"
  | "medical-center"
  | "north-campus"
  | "west-campus"
  | "south-campus";

export type ParkingMetadata = {
  id: number;
  name: string;
  kind: ParkingKind;
  latitude: number;
  longitude: number;
  address: string;
  region: ParkingRegion;
  evCharging: boolean;
  evNote?: string;
  routeHints: string[];
  note?: string;
};

export type ParkingLocation = GarageApiItem &
  ParkingMetadata & {
    available: number;
    isFavorite: boolean;
  };

export type ParkingFilters = {
  query: string;
  access: "all" | "visitor" | "permit";
  availability: "all" | "open" | "plenty";
  kind: "all" | ParkingKind;
  evOnly: boolean;
};

export type UserPreferences = {
  permitCode: string;
  /** Coarse, local-only filter; never sent to an account or backend. */
  parkingIdentity: UserParkingIdentity;
  favorites: number[];
  evMode: boolean;
  mapTransitVisible: boolean;
  dismissedWelcome: boolean;
};
import type { UserParkingIdentity } from "@/data/permits";
