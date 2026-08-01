"use client";

import type { FeatureCollection } from "geojson";

import { MapPanel } from "@/components/map/map-panel";
import type { TransitFeed } from "@/types/transit";

const emptyTransitFeed: TransitFeed = {
  routes: [],
  details: {},
  vehicles: [],
};

type PermitPreviewPanelProps = {
  permitAreas: FeatureCollection;
  showPermitAreas: boolean;
};

/**
 * A deliberately quiet reuse of the campus map for the permit picker.
 * The preview only needs the official surface-area layer, so live parking,
 * transit, and EV data stay out of this second map instance.
 */
export function PermitPreviewPanel({
  permitAreas,
  showPermitAreas,
}: PermitPreviewPanelProps) {
  return (
    <div className="permit-preview-panel">
      <MapPanel
        variant="permit-preview"
        locations={[]}
        onSelect={() => undefined}
        transitFeed={emptyTransitFeed}
        activeRoutes={[]}
        showTransit={false}
        evStations={[]}
        showEv={false}
        permitAreas={permitAreas}
        showPermitAreas={showPermitAreas}
      />
    </div>
  );
}
