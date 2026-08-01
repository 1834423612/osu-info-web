"use client";

import { Icon } from "@iconify/react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";

import { getPermitZoneMeta } from "@/lib/permit-map";
import {
  getParkingMapGroups,
  type ParkingMapGroupId,
} from "@/lib/parking-map-groups";
import { cn } from "@/lib/utils";
import type { ParkingAccessPresentation } from "@/components/parking-card";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type { TransitFeed } from "@/types/transit";
import type {
  CampusMapProps,
  CampusMapVariant,
} from "./campus-map";

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
  selectedEvStationId?: string;
  onSelectEvStation?: (id: string) => void;
  parkingAccessById?: Readonly<Record<number, ParkingAccessPresentation>>;
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
  const [expandedParkingGroup, setExpandedParkingGroup] =
    useState<ParkingMapGroupId>();
  const expandedZones = expansion.layerKey === layerKey ? expansion.zones : [];

  const expandedSet = new Set(expandedZones);
  const allExpanded =
    zones.length > 0 && zones.every((zone) => expandedSet.has(zone));
  const primaryMeta = getPermitZoneMeta(zones[0]);
  const parkingGroups = useMemo(
    () => getParkingMapGroups(mapProps.locations ?? []),
    [mapProps.locations],
  );

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
        expandedParkingGroup={expandedParkingGroup}
        className="h-full w-full"
      />

      {variant === "default" && parkingGroups.length > 0 && (
        <aside className="parking-category-dock" aria-label="地图停车分类">
          <div className="parking-category-dock__heading">
            <span>
              <Icon icon="solar:layers-bold-duotone" />
            </span>
            <div>
              <small>地图停车分类</small>
              <strong>选择后显示具体地点</strong>
            </div>
          </div>
          <div className="parking-category-dock__tickets">
            {parkingGroups.map((group) => {
              const expanded = expandedParkingGroup === group.id;
              return (
                <button
                  type="button"
                  key={group.id}
                  className={cn(
                    "parking-category-ticket",
                    expanded && "is-active",
                  )}
                  style={
                    {
                      "--parking-category-color": group.color,
                    } as React.CSSProperties
                  }
                  onClick={() =>
                    setExpandedParkingGroup((current) =>
                      current === group.id ? undefined : group.id,
                    )
                  }
                  aria-pressed={expanded}
                >
                  <span className="parking-category-ticket__code">
                    <Icon icon="solar:ticket-bold-duotone" />
                    <b>{group.code}</b>
                  </span>
                  <span className="parking-category-ticket__copy">
                    <strong>{group.nameZh}</strong>
                    <small>
                      {group.count} 处 · {expanded ? "已展开" : "点击细分"}
                    </small>
                  </span>
                  <Icon
                    className="parking-category-ticket__chevron"
                    icon={
                      expanded
                        ? "solar:alt-arrow-down-linear"
                        : "solar:alt-arrow-right-linear"
                    }
                  />
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {variant === "permit-preview" && permitLayer.visible && zones.length > 0 && (
        <aside className="permit-zone-dock" aria-label="停车证区域分类">
          {zones.map((zone) => {
            const meta = getPermitZoneMeta(zone);
            if (!meta) return null;
            const expanded = expandedSet.has(zone);
            return (
              <button
                type="button"
                key={zone}
                className={cn("permit-zone-dock__ticket", expanded && "is-active")}
                style={
                  { "--permit-zone-color": meta.color } as React.CSSProperties
                }
                onClick={() => toggleZone(zone)}
                aria-pressed={expanded}
              >
                <b>{meta.code}</b>
                <span>
                  <strong>{meta.shortNameZh}</strong>
                  <small>
                    {meta.audienceZh} · {expanded ? "已展开" : "点击细分"}
                  </small>
                </span>
                <Icon icon="solar:alt-arrow-right-linear" />
              </button>
            );
          })}
        </aside>
      )}

      {permitLayer.visible && permitLayer.permitCode && zones.length > 0 && (
        <div
          className="permit-map-summary"
          style={
            {
              "--permit-zone-color": primaryMeta?.color ?? "#ba0c2f",
            } as React.CSSProperties
          }
        >
          <button
            type="button"
            className="permit-map-summary__overview"
            onClick={() =>
              setExpansion({ layerKey, zones: allExpanded ? [] : zones })
            }
            aria-pressed={allExpanded}
            title={allExpanded ? "收起具体停车区域" : "展开全部具体停车区域"}
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
          </button>
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
