"use client";

import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";

import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type { TransitFeed } from "@/types/transit";
import type { CampusMapProps } from "./campus-map";

const CampusMap = dynamic<CampusMapProps>(() => import("./campus-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading" role="status">
      <span />
      <p>正在准备校园地图…</p>
    </div>
  ),
});

export type MapPanelProps = {
  variant?: "default" | "permit-preview";
  locations?: ParkingLocation[];
  selectedId?: number;
  onSelect?: (id: number) => void;
  transitFeed?: TransitFeed;
  activeRoutes?: string[];
  showTransit?: boolean;
  evStations?: EvStation[];
  showEv?: boolean;
  permitAreas: FeatureCollection;
  showPermitAreas?: boolean;
};

export function MapPanel(props: MapPanelProps) {
  return <CampusMap {...props} className="h-full w-full" />;
}
