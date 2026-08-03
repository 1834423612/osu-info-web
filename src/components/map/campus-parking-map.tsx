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
  selectedTransitRoute?: string;
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
  const [parkingToolsOpen, setParkingToolsOpen] = useState(false);
  const [parkingLocationsOpen, setParkingLocationsOpen] = useState(false);
  const [permitAccessOpen, setPermitAccessOpen] = useState(false);
  const expandedZones = expansion.layerKey === layerKey ? expansion.zones : [];

  const expandedSet = new Set(expandedZones);
  const allExpanded =
    zones.length > 0 && zones.every((zone) => expandedSet.has(zone));
  const primaryMeta = getPermitZoneMeta(zones[0]);
  const parkingGroups = useMemo(
    () => getParkingMapGroups(mapProps.locations ?? []),
    [mapProps.locations],
  );
  const parkingLocationCount = parkingGroups.reduce(
    (total, group) => total + group.count,
    0,
  );
  const showPermitAccess = Boolean(
    permitLayer.visible && permitLayer.permitCode && zones.length > 0,
  );
  const permitAreaCount = permitLayer.areas.features.length;

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

      {variant === "default" &&
        (parkingGroups.length > 0 || showPermitAccess) && (
          <aside className="parking-layer-dock" aria-label="停车地图图层">
            <button
              type="button"
              className="parking-layer-dock__toggle"
              onClick={() => setParkingToolsOpen((current) => !current)}
              aria-expanded={parkingToolsOpen}
            >
              <span>
                <Icon icon="solar:layers-bold-duotone" />
              </span>
              <span>
                <small>停车地图图层</small>
                <strong>
                  {parkingToolsOpen
                    ? "分别查看地点与停车证范围"
                    : `${parkingLocationCount} 个地点${showPermitAccess ? " · 含我的证区" : ""}`}
                </strong>
              </span>
              <Icon
                icon={
                  parkingToolsOpen
                    ? "solar:minimize-square-2-linear"
                    : "solar:maximize-square-3-linear"
                }
              />
            </button>

            {parkingToolsOpen && (
              <div className="parking-layer-dock__body">
                {parkingGroups.length > 0 && (
                  <section className="parking-layer-section">
                    <button
                      type="button"
                      className="parking-layer-section__toggle"
                      onClick={() =>
                        setParkingLocationsOpen((current) => !current)
                      }
                      aria-expanded={parkingLocationsOpen}
                    >
                      <span className="is-location">
                        <Icon icon="solar:garage-bold-duotone" />
                      </span>
                      <span>
                        <small>实时停车地点</small>
                        <strong>{parkingLocationCount} 个地点 · 按类型筛选</strong>
                      </span>
                      <Icon
                        icon={
                          parkingLocationsOpen
                            ? "solar:alt-arrow-up-linear"
                            : "solar:alt-arrow-down-linear"
                        }
                      />
                    </button>
                    {parkingLocationsOpen && (
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
                                <Icon icon="solar:map-point-bold-duotone" />
                                <b>{group.code}</b>
                              </span>
                              <span className="parking-category-ticket__copy">
                                <strong>{group.nameZh}</strong>
                                <small>
                                  {group.count} 个地点 · {expanded ? "地图已显示" : "点击显示"}
                                </small>
                              </span>
                              <Icon
                                className="parking-category-ticket__chevron"
                                icon={
                                  expanded
                                    ? "solar:eye-bold-duotone"
                                    : "solar:eye-closed-bold-duotone"
                                }
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                {showPermitAccess && (
                  <section className="parking-layer-section">
                    <button
                      type="button"
                      className="parking-layer-section__toggle"
                      onClick={() =>
                        setPermitAccessOpen((current) => !current)
                      }
                      aria-expanded={permitAccessOpen}
                    >
                      <span
                        className="is-permit"
                        style={
                          {
                            "--permit-zone-color":
                              primaryMeta?.color ?? "#ba0c2f",
                          } as React.CSSProperties
                        }
                      >
                        <Icon icon="solar:ticket-bold-duotone" />
                      </span>
                      <span>
                        <small>我的停车证准停范围</small>
                        <strong>
                          {permitLayer.permitCode} · {zones.join(" / ")} 证区
                        </strong>
                      </span>
                      <Icon
                        icon={
                          permitAccessOpen
                            ? "solar:alt-arrow-up-linear"
                            : "solar:alt-arrow-down-linear"
                        }
                      />
                    </button>
                    {permitAccessOpen && (
                      <div className="parking-permit-layer-detail">
                        <p>
                          {permitLayer.loading
                            ? "正在读取官方 GIS 地块…"
                            : permitLayer.error
                              ? "证区边界加载失败；可通过左上角停车证图层按钮重试。"
                              : "彩色边界表示当前时段的准停证区；下方可继续显示官方 GIS 的具体停车地块。"}
                        </p>
                        <div className="parking-permit-layer-detail__zones">
                          {zones.map((zone) => {
                            const meta = getPermitZoneMeta(zone);
                            if (!meta) return null;
                            const expanded = expandedSet.has(zone);
                            const unavailable = Boolean(
                              permitLayer.loading ||
                                permitLayer.error ||
                                permitAreaCount === 0,
                            );
                            return (
                              <button
                                type="button"
                                key={zone}
                                style={
                                  {
                                    "--permit-zone-color": meta.color,
                                  } as React.CSSProperties
                                }
                                className={expanded ? "is-active" : undefined}
                                onClick={() => toggleZone(zone)}
                                aria-pressed={expanded}
                                title={meta.descriptionZh}
                                disabled={unavailable}
                              >
                                <b>{zone}</b>
                                <span>
                                  {unavailable
                                    ? "地块不可用"
                                    : expanded
                                      ? "已显示地块"
                                      : "显示地块"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="parking-permit-layer-detail__all"
                          onClick={() =>
                            setExpansion({
                              layerKey,
                              zones: allExpanded ? [] : zones,
                            })
                          }
                          aria-pressed={allExpanded}
                          disabled={
                            Boolean(permitLayer.loading || permitLayer.error) ||
                            permitAreaCount === 0
                          }
                        >
                          <Icon
                            icon={
                              allExpanded
                                ? "solar:eye-closed-bold-duotone"
                                : "solar:map-point-wave-bold-duotone"
                            }
                          />
                          {permitLayer.loading
                            ? "正在读取具体地块"
                            : permitLayer.error
                              ? "具体地块暂不可用"
                              : permitAreaCount === 0
                                ? "暂无匹配的具体地块"
                                : allExpanded
                                  ? "隐藏全部具体地块"
                                  : `显示全部具体地块（${permitAreaCount} 个 GIS 边界）`}
                        </button>
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
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
                    {meta.audienceZh} · {expanded ? "已显示地块" : "显示具体地块"}
                  </small>
                </span>
                <Icon icon="solar:alt-arrow-right-linear" />
              </button>
            );
          })}
        </aside>
      )}

      {variant === "permit-preview" &&
        permitLayer.visible &&
        permitLayer.permitCode &&
        zones.length > 0 && (
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
            title={allExpanded ? "隐藏具体停车地块" : "显示全部具体停车地块"}
          >
            <span className="permit-map-summary__ticket">
              <Icon icon="solar:ticket-bold-duotone" />
              <b>{permitLayer.permitCode}</b>
            </span>
            <span className="permit-map-summary__copy">
              <small>当前时段准停证区</small>
              <strong>{zones.join(" / ")} · 点击查看地块</strong>
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
            title={allExpanded ? "隐藏具体停车地块" : "显示具体停车地块"}
          >
            <Icon
              icon={
                allExpanded
                  ? "solar:minimize-square-2-linear"
                  : "solar:map-point-wave-bold-duotone"
              }
            />
            {allExpanded ? "隐藏地块" : "具体地块"}
          </button>
        </div>
      )}
    </div>
  );
}
