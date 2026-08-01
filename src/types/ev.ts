export type EvStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  operator?: string;
  capacity?: number;
  openingHours?: string;
  power?: string;
  website?: string;
  isTesla: boolean;
  source: "osm" | "campus";
};
