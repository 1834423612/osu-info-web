export type TransitRoute = {
  code: string;
  service?: string;
  name: string;
  color: string;
  darkColor?: string;
  showByDefault?: boolean;
};

export type TransitStop = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
};

export type TransitPattern = {
  id: string;
  direction?: string;
  length?: number;
  encodedPolyline: string;
};

export type TransitRouteDetail = {
  code: string;
  patterns: TransitPattern[];
  stops: TransitStop[];
  lastModified?: string;
};

export type TransitPrediction = {
  routeCode?: string;
  routeColor?: string;
  darkColor?: string;
  predictionCountdown?: string | number;
  predictionTime?: string;
  systemTime?: string;
  timeToArrivalInSeconds?: number | string;
  destination?: string;
  stopId?: string;
  stopName?: string;
  type?: string;
  isDelayed?: boolean;
  vehicleId?: string | number;
  vehicleDistanceInFeet?: number;
};

export type TransitVehicle = {
  id: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  routeCode: string;
  destination?: string;
  delayed?: boolean;
  updated?: string;
  patternId?: string;
  predictions?: TransitPrediction[];
  lastStop?: string | null;
  service?: string;
  bus_id?: string | number;
};

export type TransitFeed = {
  routes: TransitRoute[];
  details: Record<string, TransitRouteDetail>;
  vehicles: TransitVehicle[];
  lastUpdated?: string;
  error?: string;
};
