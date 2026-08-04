import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type CampusImpactProperties = {
  id: number;
  name: string;
  summary?: string;
  startDate?: string;
  endDate?: string;
  affectsParking: boolean;
  affectsVehicles: boolean;
  affectsPedestrians: boolean;
  affectsCyclists: boolean;
  isEvent: boolean;
  impactType: "construction" | "event" | "other";
  impactColor: string;
  officialMapUrl: string;
};

export type CampusImpactCollection = FeatureCollection<
  Polygon | MultiPolygon,
  CampusImpactProperties
>;

export type CampusImpactResponse = {
  data: CampusImpactCollection;
  count: number;
  updatedAt: string;
  source: {
    label: string;
    url: string;
    queryUrl: string;
  };
};
