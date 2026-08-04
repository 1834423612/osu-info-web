"use client";

import { Icon } from "@iconify/react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";

import {
  getPermitZoneMeta,
  type PermitMapPeriod,
  type PermitMapPeriodId,
} from "@/lib/permit-map";
import {
  getParkingMapGroups,
  type ParkingMapGroupId,
} from "@/lib/parking-map-groups";
import { cn } from "@/lib/utils";
import type { ParkingAccessPresentation } from "@/components/parking-card";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";
import type { TransitFeed } from "@/types/transit";
import type { CampusImpactCollection } from "@/types/campus-gis";
import {
  MapLayerSettingsDock,
  type MapLayerSettingItem,
  type MapLayerSettingKey,
  type MapLayerVisibility,
} from "./map-layer-settings";
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
  /** Every GIS zone kept on the map, including zones unavailable in a period. */
  zones?: readonly string[];
  /** Used when no period model is provided. */
  availableZones?: readonly string[];
  periods?: readonly PermitMapPeriod[];
  selectedPeriod?: PermitMapPeriodId;
  onSelectedPeriodChange?: (period: PermitMapPeriodId) => void;
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
  selectedTransitFocusRequest?: number;
  showTransit?: boolean;
  evStations?: EvStation[];
  showEv?: boolean;
  selectedEvStationId?: string;
  selectedEvFocusRequest?: number;
  onSelectEvStation?: (id: string) => void;
  parkingAccessById?: Readonly<Record<number, ParkingAccessPresentation>>;
  campusImpacts?: CampusImpactCollection;
  campusImpactsLoading?: boolean;
  campusImpactsError?: string;
  permitLayer: PermitMapLayer;
  mapLayerVisibility?: Partial<MapLayerVisibility>;
  onMapLayerVisibilityChange?: (
    layer: MapLayerSettingKey,
    visible: boolean,
  ) => void;
  onMapLayerVisibilityBatchChange?: (
    layers: readonly MapLayerSettingKey[],
    visible: boolean,
  ) => void;
  className?: string;
};

function PermitPeriodSwitcher({
  periods,
  selected,
  onSelect,
  compact = false,
}: {
  periods: readonly PermitMapPeriod[];
  selected: PermitMapPeriodId;
  onSelect: (period: PermitMapPeriodId) => void;
  compact?: boolean;
}) {
  const active = periods.find((period) => period.id === selected) ?? periods[0];
  if (!active || periods.length < 2) return null;

  return (
    <div
      className={cn(
        "permit-period-switcher",
        compact && "permit-period-switcher--compact",
      )}
    >
      <div className="permit-period-switcher__heading">
        <span>
          <Icon icon="solar:calendar-date-bold-duotone" />
        </span>
        <span>
          <small>{active.labelZh}</small>
          <strong>{active.rangeZh}</strong>
        </span>
        <b>{active.zones.length} 个可用证区</b>
      </div>
      <div className="permit-period-switcher__options" role="group" aria-label="停车证规则时段">
        {periods.map((period) => (
          <button
            type="button"
            key={period.id}
            className={period.id === active.id ? "is-active" : undefined}
            onClick={() => onSelect(period.id)}
            aria-pressed={period.id === active.id}
            title={`${period.rangeZh}：${period.detailZh}`}
          >
            {period.isCurrent && <i aria-hidden="true" />}
            <span>{period.labelZh}</span>
            <small>{period.rangeZh}</small>
          </button>
        ))}
      </div>
      <p>{active.detailZh}</p>
      <div className="permit-period-switcher__legend" aria-label="证区颜色说明">
        <span className="is-available"><i />彩色：该时段可用</span>
        <span className="is-unavailable"><i />灰红：该时段不可用</span>
      </div>
    </div>
  );
}

/**
 * The single public campus-map component used by both the dashboard and the
 * permit picker. Permit overview/detail state lives here so both surfaces use
 * identical markers, labels, colors and drill-down behavior.
 */
export function CampusParkingMap({
  variant = "default",
  permitLayer,
  mapLayerVisibility,
  onMapLayerVisibilityChange,
  onMapLayerVisibilityBatchChange,
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
  const [parkingLocationsOpen, setParkingLocationsOpen] = useState(false);
  const [permitAccessOpen, setPermitAccessOpen] = useState(false);
  const [localLayerVisibility, setLocalLayerVisibility] = useState<
    Partial<MapLayerVisibility>
  >({});
  const permitPeriodKey = permitLayer.permitCode ?? "none";
  const [localPeriodState, setLocalPeriodState] = useState<{
    permitKey: string;
    period: PermitMapPeriodId;
  }>({ permitKey: permitPeriodKey, period: "current" });
  const localPeriod =
    localPeriodState.permitKey === permitPeriodKey
      ? localPeriodState.period
      : "current";
  const selectedPeriod = permitLayer.selectedPeriod ?? localPeriod;
  const activePeriod =
    permitLayer.periods?.find((period) => period.id === selectedPeriod) ??
    permitLayer.periods?.[0];
  const activeZones = useMemo(
    () =>
      Array.from(
        new Set(
          activePeriod?.zones ?? permitLayer.availableZones ?? zones,
        ),
      ),
    [activePeriod?.zones, permitLayer.availableZones, zones],
  );
  const activeZoneSet = useMemo(() => new Set(activeZones), [activeZones]);
  const selectPeriod = useCallback(
    (period: PermitMapPeriodId) => {
      if (permitLayer.selectedPeriod === undefined) {
        setLocalPeriodState({ permitKey: permitPeriodKey, period });
      }
      permitLayer.onSelectedPeriodChange?.(period);
    },
    [permitLayer, permitPeriodKey],
  );
  const expandedZones = expansion.layerKey === layerKey ? expansion.zones : [];

  const expandedSet = new Set(expandedZones);
  const allExpanded =
    zones.length > 0 && zones.every((zone) => expandedSet.has(zone));
  const primaryMeta = getPermitZoneMeta(activeZones[0] ?? zones[0]);
  const parkingGroups = useMemo(
    () => getParkingMapGroups(mapProps.locations ?? []),
    [mapProps.locations],
  );
  const parkingLocationCount = parkingGroups.reduce(
    (total, group) => total + group.count,
    0,
  );
  const layerVisible = useCallback(
    (layer: MapLayerSettingKey, fallback: boolean) =>
      mapLayerVisibility?.[layer] ??
      localLayerVisibility[layer] ??
      fallback,
    [localLayerVisibility, mapLayerVisibility],
  );
  const chargingStationsVisible = layerVisible(
    "chargingStations",
    mapProps.showEv ?? false,
  );
  const permitAreasVisible = layerVisible("permitAreas", permitLayer.visible);
  const parkingLocationsVisible = layerVisible("parkingLocations", true);
  const transitVehiclesVisible = layerVisible(
    "transitVehicles",
    mapProps.showTransit ?? false,
  );
  const transitRoutesVisible = layerVisible(
    "transitRoutes",
    mapProps.showTransit ?? false,
  );
  const transitEndpointsVisible = layerVisible(
    "transitEndpoints",
    mapProps.showTransit ?? false,
  );
  const constructionImpactsVisible = layerVisible(
    "constructionImpacts",
    false,
  );
  const transitLayersVisible =
    transitVehiclesVisible || transitRoutesVisible || transitEndpointsVisible;
  const setLayerVisible = useCallback(
    (layer: MapLayerSettingKey, visible: boolean) => {
      if (!mapLayerVisibility || mapLayerVisibility[layer] === undefined) {
        setLocalLayerVisibility((current) => ({ ...current, [layer]: visible }));
      }
      onMapLayerVisibilityChange?.(layer, visible);
    },
    [mapLayerVisibility, onMapLayerVisibilityChange],
  );
  const showPermitAccess = Boolean(
    permitAreasVisible && permitLayer.permitCode && zones.length > 0,
  );
  const permitAreaCount = permitLayer.areas.features.length;
  const mapLayerItems = useMemo<readonly MapLayerSettingItem[]>(
    () => [
      {
        id: "chargingStations",
        group: "parking",
        label: "充电站",
        detail: `${mapProps.evStations?.length ?? 0} 个站点`,
        icon: "solar:bolt-circle-bold-duotone",
        tone: "green",
        visible: chargingStationsVisible,
      },
      {
        id: "permitAreas",
        group: "parking",
        label: "停车证区域",
        detail: permitLayer.permitCode
          ? `${permitLayer.permitCode} · ${activeZones.length} 个当前可用证区`
          : "设置停车证后可用",
        icon: "solar:ticket-bold-duotone",
        tone: "scarlet",
        visible: permitAreasVisible,
        disabled: !permitLayer.permitCode,
      },
      {
        id: "parkingLocations",
        group: "parking",
        label: "具体停车地点",
        detail: `${parkingLocationCount} 个地点 · 按类型筛选`,
        icon: "solar:garage-bold-duotone",
        tone: "blue",
        visible: parkingLocationsVisible,
      },
      {
        id: "transitVehicles",
        group: "transit",
        label: "实时车辆",
        detail: `${mapProps.transitFeed?.vehicles.length ?? 0} 辆在线`,
        icon: "solar:bus-bold-duotone",
        tone: "orange",
        visible: transitVehiclesVisible,
      },
      {
        id: "transitRoutes",
        group: "transit",
        label: "完整线路",
        detail: `${mapProps.activeRoutes?.length ?? 0} / ${mapProps.transitFeed?.routes.length ?? 0} 条已选`,
        icon: "solar:route-bold-duotone",
        tone: "navy",
        visible: transitRoutesVisible,
      },
      {
        id: "transitEndpoints",
        group: "transit",
        label: "线路起终点",
        detail: mapProps.selectedTransitRoute
          ? `${mapProps.selectedTransitRoute} · 极简标识`
          : "选择一条线路后显示",
        icon: "solar:flag-2-bold-duotone",
        tone: "violet",
        visible: transitEndpointsVisible,
      },
      {
        id: "constructionImpacts",
        group: "campus",
        label: "施工与通行影响",
        detail: mapProps.campusImpactsLoading
          ? "正在读取 OSU 官方 GIS"
          : mapProps.campusImpactsError
            ? "读取失败 · 关闭后重试"
            : !constructionImpactsVisible &&
                !mapProps.campusImpacts?.features.length
              ? "开启后读取 OSU 官方影响"
              : `${mapProps.campusImpacts?.features.length ?? 0} 个当前/即将发生`,
        icon: "solar:danger-triangle-bold-duotone",
        tone: "amber",
        visible: constructionImpactsVisible,
      },
    ],
    [
      activeZones.length,
      chargingStationsVisible,
      mapProps.activeRoutes?.length,
      mapProps.campusImpacts?.features.length,
      mapProps.campusImpactsError,
      mapProps.campusImpactsLoading,
      mapProps.evStations?.length,
      mapProps.selectedTransitRoute,
      mapProps.transitFeed?.routes.length,
      mapProps.transitFeed?.vehicles.length,
      parkingLocationCount,
      parkingLocationsVisible,
      permitAreasVisible,
      permitLayer.permitCode,
      transitEndpointsVisible,
      transitRoutesVisible,
      transitVehiclesVisible,
      constructionImpactsVisible,
    ],
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

  const setAllMapLayersVisible = useCallback(
    (visible: boolean) => {
      const layers = mapLayerItems
        .filter((item) => !item.disabled)
        .map((item) => item.id);
      setLocalLayerVisibility((current) =>
        layers.reduce<Partial<MapLayerVisibility>>(
          (next, layer) =>
            mapLayerVisibility?.[layer] === undefined
              ? { ...next, [layer]: visible }
              : next,
          current,
        ),
      );
      if (onMapLayerVisibilityBatchChange) {
        onMapLayerVisibilityBatchChange(layers, visible);
        return;
      }
      layers.forEach((layer) => onMapLayerVisibilityChange?.(layer, visible));
    },
    [
      mapLayerItems,
      mapLayerVisibility,
      onMapLayerVisibilityBatchChange,
      onMapLayerVisibilityChange,
    ],
  );

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
        showPermitAreas={permitAreasVisible}
        showParkingLocations={parkingLocationsVisible}
        showTransit={transitLayersVisible}
        showTransitVehicles={transitVehiclesVisible}
        showTransitRoutes={transitRoutesVisible}
        showTransitEndpoints={transitEndpointsVisible}
        showEv={chargingStationsVisible}
        campusImpacts={mapProps.campusImpacts}
        showCampusImpacts={constructionImpactsVisible}
        expandedPermitZones={expandedZones}
        availablePermitZones={activeZones}
        expandedParkingGroup={expandedParkingGroup}
        className="h-full w-full"
      />

      {variant === "default" && (
        <MapLayerSettingsDock
          items={mapLayerItems}
          onChange={setLayerVisible}
          onChangeAll={setAllMapLayersVisible}
        >
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
                              onClick={() => {
                                const opening =
                                  expandedParkingGroup !== group.id;
                                setExpandedParkingGroup(
                                  opening ? group.id : undefined,
                                );
                                if (opening && !parkingLocationsVisible) {
                                  setLayerVisible("parkingLocations", true);
                                }
                              }}
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
                          {permitLayer.permitCode} · {activeZones.length} / {zones.length} 个可用证区
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
                              : "切换规则时段进行规划；彩色为可用证区，灰红为该时段不可用。现场标牌与活动安排始终优先。"}
                        </p>
                        {!!permitLayer.periods?.length && (
                          <PermitPeriodSwitcher
                            periods={permitLayer.periods}
                            selected={activePeriod?.id ?? "current"}
                            onSelect={selectPeriod}
                            compact
                          />
                        )}
                        <div className="parking-permit-layer-detail__zones">
                          {zones.map((zone) => {
                            const meta = getPermitZoneMeta(zone);
                            if (!meta) return null;
                            const expanded = expandedSet.has(zone);
                            const dataUnavailable = Boolean(
                              permitLayer.loading ||
                                permitLayer.error ||
                                permitAreaCount === 0,
                            );
                            const periodUnavailable = !activeZoneSet.has(zone);
                            return (
                              <button
                                type="button"
                                key={zone}
                                style={
                                  {
                                    "--permit-zone-color": meta.color,
                                  } as React.CSSProperties
                                }
                                className={cn(
                                  expanded && "is-active",
                                  periodUnavailable && "is-unavailable",
                                )}
                                onClick={() => toggleZone(zone)}
                                aria-pressed={expanded}
                                title={
                                  periodUnavailable
                                    ? `${meta.descriptionZh} 当前预览时段不可用。`
                                    : meta.descriptionZh
                                }
                                disabled={dataUnavailable}
                              >
                                <b>{zone}</b>
                                <span>
                                  {dataUnavailable
                                    ? "地块未加载"
                                    : periodUnavailable
                                      ? "此时段不可用"
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
        </MapLayerSettingsDock>
      )}

      {variant === "permit-preview" && permitLayer.visible && zones.length > 0 && (
        <aside className="permit-zone-dock" aria-label="停车证区域分类">
          {zones.map((zone) => {
            const meta = getPermitZoneMeta(zone);
            if (!meta) return null;
            const expanded = expandedSet.has(zone);
            const periodUnavailable = !activeZoneSet.has(zone);
            return (
              <button
                type="button"
                key={zone}
                className={cn(
                  "permit-zone-dock__ticket",
                  expanded && "is-active",
                  periodUnavailable && "is-unavailable",
                )}
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
                    {periodUnavailable
                      ? "当前预览时段不可用"
                      : `${meta.audienceZh} · ${expanded ? "已显示地块" : "显示具体地块"}`}
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
        !!permitLayer.periods?.length && (
          <div className="permit-period-switcher-wrap">
            <PermitPeriodSwitcher
              periods={permitLayer.periods}
              selected={activePeriod?.id ?? "current"}
              onSelect={selectPeriod}
              compact
            />
          </div>
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
              <small>{activePeriod?.labelZh ?? "当前时段"}准停证区</small>
              <strong>
                {activeZones.length > 0
                  ? `${activeZones.join(" / ")} · 点击查看地块`
                  : "无通用地面准停区"}
              </strong>
              <span className="permit-map-summary__colors" aria-hidden="true">
                {activeZones.map((zone) => (
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
