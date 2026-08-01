"use client";

import { Icon } from "@iconify/react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";

import { getPermitZoneMeta } from "@/lib/permit-map";
import { cn } from "@/lib/utils";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type { TransitFeed } from "@/types/transit";
import type { CampusMapProps, CampusMapVariant } from "./campus-map";

const CampusMap = dynamic<CampusMapProps>(() => import("./campus-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading" role="status">
      <span />
      <p>正在准备校园地图…</p>
    </div>
  ),
});

export type PermitMapLayer = {
  areas: FeatureCollection;
  visible: boolean;
  permitCode?: string;
  zones?: readonly string[];
  loading?: boolean;
  error?: string;
};

export type CampusParkingMapProps = {
  variant?: CampusMapVariant;
  locations?: ParkingLocation[];
  selectedId?: number;
  onSelect?: (id: number) => void;
  transitFeed?: TransitFeed;
  activeRoutes?: string[];
  showTransit?: boolean;
  evStations?: EvStation[];
  showEv?: boolean;
  permitLayer: PermitMapLayer;
  className?: string;
};

/**
 * The single public campus-map component used by both the dashboard and the
 * permit picker. Permit overview/detail state lives here so both surfaces use
 * identical markers, labels, colors and drill-down behavior.
 */
export function CampusParkingMap({
  variant = "default",
  permitLayer,
  className,
  ...mapProps
}: CampusParkingMapProps) {
  const zones = useMemo(
    () => Array.from(new Set(permitLayer.zones ?? [])),
    [permitLayer.zones],
  );
  const zoneKey = zones.join(",");
  const layerKey = `${permitLayer.permitCode ?? "none"}:${zoneKey}`;
  const [expansion, setExpansion] = useState<{
    layerKey: string;
    zones: string[];
  }>({ layerKey, zones: [] });
  const expandedZones = expansion.layerKey === layerKey ? expansion.zones : [];

  const expandedSet = new Set(expandedZones);
  const allExpanded =
    zones.length > 0 && zones.every((zone) => expandedSet.has(zone));
  const primaryMeta = getPermitZoneMeta(zones[0]);

  const toggleZone = useCallback((zone: string) => {
    setExpansion((current) => {
      const currentZones = current.layerKey === layerKey ? current.zones : [];
      return {
        layerKey,
        zones: currentZones.includes(zone)
          ? currentZones.filter((candidate) => candidate !== zone)
          : [...currentZones, zone],
      };
    });
  }, [layerKey]);

  return (
    <div
      className={cn(
        "campus-parking-map",
        variant === "permit-preview" && "campus-parking-map--preview",
        className,
      )}
    >
      <CampusMap
        {...mapProps}
        variant={variant}
        permitAreas={permitLayer.areas}
        showPermitAreas={permitLayer.visible}
        expandedPermitZones={expandedZones}
        onTogglePermitZone={toggleZone}
        className="h-full w-full"
      />

      {permitLayer.visible && permitLayer.permitCode && zones.length > 0 && (
        <div
          className="permit-map-summary"
          style={
            {
              "--permit-zone-color": primaryMeta?.color ?? "#ba0c2f",
            } as React.CSSProperties
          }
        >
          <span className="permit-map-summary__ticket">
            <Icon icon="solar:ticket-bold-duotone" />
            <b>{permitLayer.permitCode}</b>
          </span>
          <span className="permit-map-summary__copy">
            <small>当前可用地面区域</small>
            <strong>{zones.join(" / ")}</strong>
            <span className="permit-map-summary__colors" aria-hidden="true">
              {zones.map((zone) => (
                <i
                  key={zone}
                  style={{ background: getPermitZoneMeta(zone)?.color }}
                />
              ))}
            </span>
          </span>
          <button
            type="button"
            onClick={() =>
              setExpansion({ layerKey, zones: allExpanded ? [] : zones })
            }
            aria-pressed={allExpanded}
            title={allExpanded ? "收起具体停车区域" : "查看具体停车区域"}
          >
            <Icon
              icon={
                allExpanded
                  ? "solar:minimize-square-2-linear"
                  : "solar:map-point-wave-bold-duotone"
              }
            />
            {allExpanded ? "收起" : "细分"}
          </button>
        </div>
      )}
    </div>
  );
}
