"use client";

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { EvControl } from "@/components/ev-control";
import { EvStationPanel } from "@/components/ev-station-panel";
import { CampusParkingMap } from "@/components/map/campus-parking-map";
import { ParkingAccessGuide } from "@/components/parking-access-guide";
import {
  ParkingCard,
  type ParkingAccessPresentation,
} from "@/components/parking-card";
import { ParkingDetailSheet } from "@/components/parking-detail-sheet";
import {
  getSelectedPermitLabel,
  PermitSettings,
} from "@/components/permit-settings";
import { TimeDisplay } from "@/components/time-display";
import { TransitControl } from "@/components/transit-control";
import { TransitRoutePanel } from "@/components/transit-route-panel";
import {
  classifyCampusParkingTime,
  estimateVisitorParkingCost,
  getCurrentAccessSummary,
  getParkingTimeRangeZh,
  getPermitPlanningNotice,
  isPermitCode,
  OFFICIAL_PARKING_URLS,
  type UserParkingIdentity,
} from "@/data/permits";
import {
  getParkingLocationByGarageId,
  PARKING_LOCATIONS,
} from "@/data/parking-locations";
import { useEvStations } from "@/hooks/use-ev-stations";
import { useLocalPreferences } from "@/hooks/use-local-preferences";
import { useParkingStatus } from "@/hooks/use-parking-status";
import { usePermitAreas } from "@/hooks/use-permit-areas";
import { useTransit } from "@/hooks/use-transit";
import { formatCampusModified } from "@/lib/parking-feed";
import { resolveParkingLocationAccess } from "@/lib/parking-location-access";
import {
  getPermitMapPeriods,
  PERMIT_MAP_ALL_ZONES,
  resolvePermitZones,
} from "@/lib/permit-map";
import {
  cn,
  formatNumber,
  haversineMeters,
} from "@/lib/utils";
import type {
  ParkingFilters,
  ParkingLocation,
} from "@/types/parking";

const initialFilters: ParkingFilters = {
  query: "",
  access: "all",
  availability: "all",
  kind: "all",
  evOnly: false,
};

type SortMode = "recommended" | "available" | "quiet" | "name";
type MobileView = "list" | "map";
type SidebarTab = "parking" | "transit" | "charging";

function feedLabel(state: ReturnType<typeof useParkingStatus>["state"]) {
  if (state === "live") return "实时数据";
  if (state === "cached") return "上次快照";
  if (state === "error") return "示例快照";
  return "正在同步";
}

function feedIcon(state: ReturnType<typeof useParkingStatus>["state"]) {
  if (state === "live") return "solar:cloud-check-bold";
  if (state === "cached") return "solar:cloud-check-bold";
  if (state === "error") return "solar:cloud-cross-bold";
  return "solar:refresh-circle-bold";
}

export function ParkingDashboard() {
  const feed = useParkingStatus();
  const { preferences, update, toggleFavorite } = useLocalPreferences();
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<SortMode>("recommended");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number>();
  const [permitOpen, setPermitOpen] = useState(false);
  const [accessGuideOpen, setAccessGuideOpen] = useState(false);
  const [permitAreaLayerEnabled, setPermitAreaLayerEnabled] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("parking");
  const [selectedTransitRoute, setSelectedTransitRoute] = useState<string>();
  const [selectedEvStationId, setSelectedEvStationId] = useState<string>();
  const [transitPanelExpanded, setTransitPanelExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const transit = useTransit(preferences.mapTransitVisible);
  const ev = useEvStations();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const locations = useMemo<ParkingLocation[]>(() => {
    return feed.data.Garages.flatMap((garage) => {
      const metadata = getParkingLocationByGarageId(garage.GarageId);
      if (!metadata) return [];
      return [
        {
          ...garage,
          id: metadata.garageId,
          name: metadata.name,
          kind: metadata.kind === "lot" ? "surface" : "garage",
          latitude: metadata.coordinates[1],
          longitude: metadata.coordinates[0],
          address: metadata.address,
          region: metadata.region,
          evCharging: metadata.hasEvCharging,
          evNote: metadata.evCharging
            ? "官方 Level 2 · ChargePoint 双枪"
            : undefined,
          routeHints: Array.from(
            new Set(metadata.nearbyCabs.map((hint) => hint.route)),
          ),
          note: metadata.notes,
          available: Math.max(
            0,
            garage.GarageCapacity - garage.GarageCount,
          ),
          isFavorite: preferences.favorites.includes(garage.GarageId),
        },
      ];
    });
  }, [feed.data.Garages, preferences.favorites]);

  const parkingAccessById = useMemo<
    Readonly<Record<number, ParkingAccessPresentation>>
  >(() => {
    const permitCode =
      preferences.permitCode === "visitor"
        ? "visitor"
        : isPermitCode(preferences.permitCode)
          ? preferences.permitCode
          : "none";
    return Object.fromEntries(
      locations.map((location) => {
        const access = resolveParkingLocationAccess(location, {
          permitCode,
          identity: preferences.parkingIdentity,
          at: now,
        });
        return [
          location.GarageId,
          location.Closed
            ? {
                status: "unavailable" as const,
                title: "停车点当前关闭",
                detail:
                  "CampusParc 实时 feed 已将此地点标为关闭；无论停车证或访客入口状态如何，都请改用其他地点。",
                requiresPayment: false,
              }
            : access,
        ];
      }),
    );
  }, [locations, now, preferences.parkingIdentity, preferences.permitCode]);

  const filteredLocations = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase();
    return locations
      .filter((location) => {
        if (favoritesOnly && !location.isFavorite) return false;
        if (
          query &&
          !`${location.GarageName} ${location.address}`
            .toLocaleLowerCase()
            .includes(query)
        ) {
          return false;
        }
        if (filters.evOnly && !location.evCharging) return false;
        if (filters.kind !== "all" && location.kind !== filters.kind) {
          return false;
        }
        const access = parkingAccessById[location.GarageId];
        if (filters.access === "visitor" && access.status !== "visitor-paid") {
          return false;
        }
        if (
          filters.access === "permit" &&
          access.status !== "included" &&
          access.status !== "later"
        ) {
          return false;
        }
        if (filters.availability === "open" && location.available <= 0) {
          return false;
        }
        if (
          filters.availability === "plenty" &&
          (location.Closed || location.UsePercentage >= 70)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "available") return b.available - a.available;
        if (sort === "quiet") return a.UsePercentage - b.UsePercentage;
        if (sort === "name") {
          return a.GarageName.localeCompare(b.GarageName, "en");
        }
        if (a.Closed !== b.Closed) return a.Closed ? 1 : -1;
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        const accessRank = {
          included: 0,
          "visitor-paid": 1,
          later: 2,
          unavailable: 3,
        } as const;
        const accessDifference =
          accessRank[parkingAccessById[a.GarageId].status] -
          accessRank[parkingAccessById[b.GarageId].status];
        if (accessDifference) return accessDifference;
        const levelDifference =
          Number(a.UsePercentage >= 70) - Number(b.UsePercentage >= 70);
        if (levelDifference) return levelDifference;
        return b.available - a.available;
      });
  }, [favoritesOnly, filters, locations, parkingAccessById, sort]);

  const selectedLocation = locations.find(
    (location) => location.GarageId === selectedId,
  );

  const totals = useMemo(() => {
    const capacity = locations.reduce(
      (total, location) => total + location.GarageCapacity,
      0,
    );
    const occupied = locations.reduce(
      (total, location) => total + location.GarageCount,
      0,
    );
    return {
      capacity,
      occupied,
      available: Math.max(0, capacity - occupied),
      quiet: locations.filter(
        (location) => !location.Closed && location.UsePercentage < 45,
      ).length,
      percent: capacity ? Math.ceil((occupied / capacity) * 100) : 0,
    };
  }, [locations]);

  const lastModified = useMemo(
    () =>
      locations
        .map((location) => location.Modified)
        .filter(Boolean)
        .sort()
        .at(-1),
    [locations],
  );

  const permitSummary = useMemo(
    () =>
      isPermitCode(preferences.permitCode)
        ? getCurrentAccessSummary(preferences.permitCode, now)
        : undefined,
    [now, preferences.permitCode],
  );
  const parkingTime = useMemo(
    () => classifyCampusParkingTime(now),
    [now],
  );

  const permitLabel = getSelectedPermitLabel(preferences.permitCode);
  const permitPlanningNotice = useMemo(
    () =>
      isPermitCode(preferences.permitCode)
        ? getPermitPlanningNotice(preferences.permitCode, now)
        : undefined,
    [now, preferences.permitCode],
  );
  const twoHourNightCost = useMemo(
    () => estimateVisitorParkingCost(2),
    [],
  );

  const permitZones = useMemo(
    () => (permitSummary ? resolvePermitZones(permitSummary) : []),
    [permitSummary],
  );
  const permitMapPeriods = useMemo(
    () =>
      isPermitCode(preferences.permitCode)
        ? getPermitMapPeriods(preferences.permitCode, now)
        : [],
    [now, preferences.permitCode],
  );
  const hasPermitZones = permitZones.length > 0;
  const permitAreas = usePermitAreas(
    permitSummary ? PERMIT_MAP_ALL_ZONES : [],
    Boolean(permitSummary),
  );
  const showPermitAreas =
    permitAreaLayerEnabled && Boolean(permitSummary) && !permitAreas.error;

  const selectedPermitMessage = useMemo(() => {
    if (!selectedLocation) return "";
    if (preferences.permitCode === "visitor") {
      return selectedLocation.GarageType === 2
        ? "此地点当前未显示访客入口，通常需要相应停车证。"
        : "可按访客入口或现场按小时规则使用；活动日和医院验证费率可能不同。";
    }
    if (!permitSummary) {
      return "尚未选择停车证；请按当前入口提示、现场标牌或访客规则判断。";
    }
    if (selectedLocation.GarageType === 3) {
      return "此地点以访客/患者停车为主，不能仅凭所选停车证推定可免费通行。";
    }
    return selectedLocation.kind === "surface"
      ? permitSummary.surfaceZh
      : permitSummary.garageZh;
  }, [permitSummary, preferences.permitCode, selectedLocation]);

  const nearestFastCharger = useMemo(() => {
    const fastChargers = ev.stations.filter((station) =>
      station.chargingSpeeds?.includes("dc-fast"),
    );
    if (!selectedLocation) return fastChargers.at(0);
    return fastChargers
      .sort(
        (a, b) =>
          haversineMeters(selectedLocation, a) -
          haversineMeters(selectedLocation, b),
      )
      .at(0);
  }, [ev.stations, selectedLocation]);

  const advancedFilterCount =
    Number(filters.kind !== "all") +
    Number(filters.access !== "all") +
    Number(sort !== "recommended");
  const filtersAreDefault =
    !filters.query &&
    filters.kind === "all" &&
    filters.access === "all" &&
    filters.availability === "all" &&
    !filters.evOnly &&
    !favoritesOnly &&
    sort === "recommended";

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setFavoritesOnly(false);
    setSort("recommended");
    setFilterMenuOpen(false);
  }, []);

  const selectLocation = useCallback((id: number) => {
    setSelectedId(id);
  }, []);

  const handlePermitSave = useCallback(
    (code: string, identity: UserParkingIdentity) => {
      update({ permitCode: code, parkingIdentity: identity });
      setPermitAreaLayerEnabled(true);
      setPermitOpen(false);
    },
    [update],
  );

  const handlePermitClose = useCallback(() => {
    setPermitOpen(false);
  }, []);

  const handleAccessGuideClose = useCallback(() => {
    setAccessGuideOpen(false);
  }, []);

  const handleEditPermitFromGuide = useCallback(() => {
    setAccessGuideOpen(false);
    setPermitOpen(true);
  }, []);

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="topbar__inner">
          <button
            type="button"
            className="brand"
            onClick={() => {
              setMobileView("list");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-label="回到停车总览"
          >
            <span className="brand__mark">
              <Icon icon="solar:garage-bold" />
            </span>
            <span>
              <strong>Buckeye Parking</strong>
              <small>OSU PARKING VIEW</small>
            </span>
          </button>

          <nav className="desktop-nav" aria-label="主导航">
            <button
              type="button"
              className={mobileView === "list" ? "is-active" : ""}
              onClick={() => setMobileView("list")}
            >
              总览
            </button>
            <button
              type="button"
              className={mobileView === "map" ? "is-active" : ""}
              onClick={() => setMobileView("map")}
            >
              实时地图
            </button>
            <button type="button" onClick={() => setPermitOpen(true)}>
              停车证
            </button>
            <a
              href="https://ttm.osu.edu/cabs"
              target="_blank"
              rel="noreferrer"
            >
              CABS
            </a>
          </nav>

          <div className="topbar__actions">
            <TimeDisplay compact />
            <button
              type="button"
              className="permit-quick-button"
              onClick={() => setPermitOpen(true)}
            >
              <span>
                <Icon icon="solar:key-square-2-bold" />
              </span>
              <span>
                <small>我的停车证</small>
                <strong>{permitLabel}</strong>
              </span>
              <Icon icon="solar:alt-arrow-down-linear" />
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-shell">
        <section className="dashboard-heading">
          <div>
            <span className="eyebrow">COLUMBUS CAMPUS · LIVE</span>
            <h1>
              先找空位，<span>再决定往哪开。</span>
            </h1>
            <p>
              20 个停车点、CampusParc 每分钟状态，以及校园公交与充电位置。
            </p>
          </div>
          <div className="dashboard-heading__right">
            <TimeDisplay />
            <button
              type="button"
              className={cn("feed-status", `is-${feed.state}`)}
              onClick={feed.refresh}
              disabled={feed.refreshing}
              title={feed.error}
            >
              <Icon
                className={feed.refreshing ? "animate-spin" : ""}
                icon={feed.refreshing ? "solar:refresh-linear" : feedIcon(feed.state)}
              />
              <span>
                <strong>{feedLabel(feed.state)}</strong>
                <small>
                  {formatCampusModified(lastModified)}
                  {feed.state === "live" ? " · 60 秒刷新" : ""}
                </small>
              </span>
            </button>
          </div>
        </section>

        <section className="metric-strip" aria-label="停车概况">
          <div className="metric-card metric-card--scarlet">
            <span className="metric-card__icon">
              <Icon icon="solar:garage-bold-duotone" />
            </span>
            <span>
              <small>
                <span className="metric-label metric-label--desktop">
                  全校预计空位
                </span>
                <span className="metric-label metric-label--mobile">空位</span>
              </small>
              <strong>{formatNumber(totals.available)}</strong>
            </span>
            <i>20 个停车点</i>
          </div>
          <div className="metric-card">
            <span className="metric-card__icon metric-card__icon--dark">
              <Icon icon="solar:chart-2-bold-duotone" />
            </span>
            <span>
              <small>
                <span className="metric-label metric-label--desktop">
                  整体占用
                </span>
                <span className="metric-label metric-label--mobile">占用</span>
              </small>
              <strong>{totals.percent}%</strong>
            </span>
            <div className="metric-progress">
              <i style={{ width: `${totals.percent}%` }} />
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-card__icon metric-card__icon--green">
              <Icon icon="solar:leaf-bold-duotone" />
            </span>
            <span>
              <small>
                <span className="metric-label metric-label--desktop">
                  空位充足
                </span>
                <span className="metric-label metric-label--mobile">充足</span>
              </small>
              <strong>{totals.quiet}</strong>
            </span>
            <i>占用低于 45%</i>
          </div>
          <button
            type="button"
            className="metric-card metric-card--permit"
            onClick={() => setAccessGuideOpen(true)}
          >
            <span className="metric-card__icon metric-card__icon--blue">
              <Icon icon="solar:key-square-2-bold-duotone" />
            </span>
            <span>
              <small>
                <span className="metric-label metric-label--desktop">
                  当前通行提示
                </span>
                <span className="metric-label metric-label--mobile">权限</span>
              </small>
              <strong>
                <span className="metric-period--desktop">
                  {getParkingTimeRangeZh(parkingTime)}
                </span>
                <span className="metric-period--mobile">
                  {getParkingTimeRangeZh(parkingTime, true)}
                </span>
              </strong>
              <em className="metric-card__period-label">
                {parkingTime.labelZh}
              </em>
            </span>
            <Icon icon="solar:alt-arrow-right-linear" />
          </button>
        </section>

        <section className="workspace-grid">
          {selectedLocation ? (
            <ParkingDetailSheet
              location={selectedLocation}
              access={parkingAccessById[selectedLocation.GarageId]}
              permitName={permitLabel}
              permitMessage={selectedPermitMessage}
              nearestFastCharger={nearestFastCharger}
              escapeEnabled={!permitOpen && !accessGuideOpen}
              onClose={() => setSelectedId(undefined)}
              onToggleFavorite={() =>
                toggleFavorite(selectedLocation.GarageId)
              }
            />
          ) : (
            <div
              className={cn(
                "parking-panel",
                mobileView === "map" && "mobile-hidden",
              )}
            >
            <div className="sidebar-tabs" role="tablist" aria-label="信息列表">
              <button
                type="button"
                role="tab"
                className={sidebarTab === "parking" ? "is-active" : ""}
                aria-selected={sidebarTab === "parking"}
                onClick={() => setSidebarTab("parking")}
              >
                <Icon icon="solar:garage-bold-duotone" />
                <span>
                  <strong>全部停车场</strong>
                  <small>{locations.length} 个地点</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                className={sidebarTab === "transit" ? "is-active" : ""}
                aria-selected={sidebarTab === "transit"}
                onClick={() => setSidebarTab("transit")}
              >
                <Icon icon="solar:bus-bold-duotone" />
                <span>
                  <strong>CABS 公交</strong>
                  <small>{transit.routeOverviews.length || 6} 条线路</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                className={sidebarTab === "charging" ? "is-active" : ""}
                aria-selected={sidebarTab === "charging"}
                onClick={() => setSidebarTab("charging")}
              >
                <Icon icon="solar:bolt-circle-bold-duotone" />
                <span>
                  <strong>充电站</strong>
                  <small>{ev.stations.length || "—"} 个地点</small>
                </span>
              </button>
            </div>
            {sidebarTab === "parking" ? (
              <>
            <div className="parking-panel__header">
              <div>
                <span className="eyebrow">PARKING STATUS</span>
                <h2>全部停车点</h2>
              </div>
              <span className="result-count">
                {filteredLocations.length} / {locations.length}
              </span>
            </div>

            <div className="search-field">
              <Icon icon="solar:magnifer-linear" />
              <input
                value={filters.query}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
                placeholder="搜索停车楼、停车场或地址"
                aria-label="搜索停车点"
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() =>
                    setFilters((current) => ({ ...current, query: "" }))
                  }
                  aria-label="清除搜索"
                >
                  <Icon icon="solar:close-circle-bold" />
                </button>
              )}
            </div>

            <div className="filter-toolbar">
              <div className="filter-row filter-row--quick">
                <button
                  type="button"
                  className={cn("filter-chip", filtersAreDefault && "is-active")}
                  onClick={resetFilters}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={cn("filter-chip", favoritesOnly && "is-active")}
                  onClick={() => setFavoritesOnly((current) => !current)}
                  aria-pressed={favoritesOnly}
                >
                  <Icon icon="solar:star-bold" />
                  收藏
                </button>
                <button
                  type="button"
                  className={cn(
                    "filter-chip",
                    filters.availability === "plenty" && "is-active",
                  )}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      availability:
                        current.availability === "plenty" ? "all" : "plenty",
                    }))
                  }
                  aria-pressed={filters.availability === "plenty"}
                >
                  <Icon icon="solar:leaf-bold" />
                  空位充足
                </button>
                <button
                  type="button"
                  className={cn("filter-chip", filters.evOnly && "is-active")}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      evOnly: !current.evOnly,
                    }))
                  }
                  aria-pressed={filters.evOnly}
                >
                  <Icon icon="solar:bolt-circle-bold" />
                  EV
                </button>
                <button
                  type="button"
                  className={cn(
                    "filter-chip",
                    "filter-chip--advanced",
                    (filterMenuOpen || advancedFilterCount > 0) && "is-active",
                  )}
                  onClick={() => setFilterMenuOpen((current) => !current)}
                  aria-expanded={filterMenuOpen}
                  aria-controls="parking-filter-advanced"
                >
                  <Icon icon="solar:filter-linear" />
                  筛选
                  {advancedFilterCount > 0 && (
                    <span className="filter-chip__count">
                      {advancedFilterCount}
                    </span>
                  )}
                  <Icon
                    className="filter-chip__chevron"
                    icon={
                      filterMenuOpen
                        ? "solar:alt-arrow-up-linear"
                        : "solar:alt-arrow-down-linear"
                    }
                  />
                </button>
              </div>

              {filterMenuOpen && (
                <div
                  className="filter-advanced"
                  id="parking-filter-advanced"
                >
                  <label className="filter-advanced__field">
                    <span>停车点类型</span>
                    <select
                      value={filters.kind}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          kind: event.target.value as ParkingFilters["kind"],
                        }))
                      }
                    >
                      <option value="all">全部类型</option>
                      <option value="garage">停车楼</option>
                      <option value="surface">露天停车场</option>
                    </select>
                  </label>

                  <label className="filter-advanced__field">
                    <span>入口类型</span>
                    <select
                      value={filters.access}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          access: event.target.value as ParkingFilters["access"],
                        }))
                      }
                    >
                      <option value="all">全部入口</option>
                      <option value="visitor">当前需按访客付费</option>
                      <option value="permit">证件当前或稍后可用</option>
                    </select>
                  </label>

                  <label className="filter-advanced__field">
                    <span>排序方式</span>
                    <select
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as SortMode)
                      }
                    >
                      <option value="recommended">推荐</option>
                      <option value="available">空位最多</option>
                      <option value="quiet">占用最低</option>
                      <option value="name">名称</option>
                    </select>
                  </label>

                  {advancedFilterCount > 0 && (
                    <button
                      type="button"
                      className="filter-advanced__reset"
                      onClick={() => {
                        setFilters((current) => ({
                          ...current,
                          access: "all",
                          kind: "all",
                        }));
                        setSort("recommended");
                      }}
                    >
                      <Icon icon="solar:restart-linear" />
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="parking-list">
              {filteredLocations.length ? (
                filteredLocations.map((location) => (
                  <ParkingCard
                    key={location.GarageId}
                    location={location}
                    selected={location.GarageId === selectedId}
                    access={parkingAccessById[location.GarageId]}
                    onSelect={() => selectLocation(location.GarageId)}
                    onToggleFavorite={() =>
                      toggleFavorite(location.GarageId)
                    }
                  />
                ))
              ) : (
                <EmptyState onReset={resetFilters} />
              )}
            </div>
              </>
            ) : sidebarTab === "transit" ? (
              <TransitRoutePanel
                routes={transit.routeOverviews}
                activeRoutes={transit.activeRoutes}
                selectedRoute={selectedTransitRoute}
                loading={transit.loading}
                error={transit.feed.error}
                onSelectRoute={(code) => {
                  const opening = selectedTransitRoute !== code;
                  setSelectedTransitRoute(opening ? code : undefined);
                  if (opening && !transit.activeRoutes.includes(code)) {
                    transit.toggleRoute(code);
                  }
                  if (opening && !preferences.mapTransitVisible) {
                    update({ mapTransitVisible: true });
                  }
                }}
                onToggleRoute={transit.toggleRoute}
              />
            ) : (
              <div className="ev-panel-scroll">
                <EvStationPanel
                  stations={ev.stations}
                  loading={ev.loading}
                  error={ev.error}
                  warning={ev.warning}
                  updatedAt={ev.updatedAt}
                  upstreams={ev.upstreams}
                  selectedId={selectedEvStationId}
                  onSelectStation={(station) => {
                    setSelectedEvStationId(station.id);
                    if (!preferences.evMode) update({ evMode: true });
                  }}
                  mapVisible={preferences.evMode}
                  onToggleMap={() => {
                    const visible = !preferences.evMode;
                    update({ evMode: visible });
                    if (visible && window.innerWidth <= 820) {
                      setMobileView("map");
                    }
                  }}
                />
              </div>
            )}
            </div>
          )}

          <div
            className={cn(
              "map-workspace",
              mobileView === "list" && "mobile-hidden-map",
            )}
          >
            <div className="map-workspace__toolbar">
              <div className="map-title">
                <span className="live-dot" />
                <span>
                  <small>LIVE CAMPUS MAP</small>
                  <strong>数字为预计空位</strong>
                </span>
              </div>
              <div className="map-legend">
                <span className="access-key access-key--included">
                  <i />
                  证件已含
                </span>
                <span className="access-key access-key--paid">
                  <i />
                  访客付费
                </span>
                <span className="access-key access-key--later">
                  <i />
                  稍后可停
                </span>
                <span className="access-key access-key--unavailable">
                  <i />
                  当前不可停
                </span>
                <span className="level-open">
                  <i />
                  &lt; 45%
                </span>
                <span className="level-steady">
                  <i />
                  45–69%
                </span>
                <span className="level-busy">
                  <i />
                  70–89%
                </span>
                <span className="level-critical">
                  <i />
                  ≥ 90%
                </span>
              </div>
            </div>

            <div className="map-canvas">
              <CampusParkingMap
                locations={locations}
                selectedId={selectedId}
                onSelect={selectLocation}
                transitFeed={transit.feed}
                activeRoutes={transit.activeRoutes}
                selectedTransitRoute={selectedTransitRoute}
                showTransit={preferences.mapTransitVisible}
                evStations={ev.stations}
                showEv={preferences.evMode}
                selectedEvStationId={selectedEvStationId}
                onSelectEvStation={(stationId) => {
                  setSelectedEvStationId(stationId);
                  setSidebarTab("charging");
                  if (window.innerWidth <= 820) setMobileView("list");
                }}
                parkingAccessById={parkingAccessById}
                permitLayer={{
                  areas: permitAreas.data,
                  visible: showPermitAreas,
                  permitCode: permitSummary?.permit.officialCode,
                  zones: PERMIT_MAP_ALL_ZONES,
                  availableZones: permitZones,
                  periods: permitMapPeriods,
                  loading: permitAreas.loading,
                  error: permitAreas.error,
                }}
              />

              <div className="map-controls map-controls--top">
                <EvControl
                  enabled={preferences.evMode}
                  stationCount={ev.stations.length}
                  loading={ev.loading}
                  onToggle={() => update({ evMode: !preferences.evMode })}
                />
                <button
                  type="button"
                  className={cn(
                    "map-layer-button map-layer-button--permit",
                    showPermitAreas && "is-active",
                    permitAreas.error && "is-error",
                    permitSummary && !hasPermitZones && "is-unavailable",
                  )}
                  onClick={() => {
                    if (!permitSummary) {
                      setPermitOpen(true);
                    } else if (permitAreas.error) {
                      permitAreas.reload();
                    } else {
                      setPermitAreaLayerEnabled((current) => !current);
                    }
                  }}
                  aria-pressed={showPermitAreas}
                  title={permitAreas.error}
                >
                  <Icon
                    icon={
                      permitAreas.error
                        ? "solar:danger-triangle-bold-duotone"
                        : "solar:ticket-bold-duotone"
                    }
                  />
                  <span>
                    <small>我的停车证图层</small>
                    <strong>
                      {!permitSummary
                        ? "先设置停车证"
                        : !hasPermitZones
                          ? showPermitAreas
                            ? "当前无地面区 · 可在地图切换时段"
                            : "当前无地面区 · 点击规划其他时段"
                        : permitAreas.loading
                          ? "读取官方 GIS"
                          : permitAreas.error
                            ? "加载失败 · 点击重试"
                          : showPermitAreas
                            ? `${permitZones.join(" / ")} 准停证区 · 已显示`
                            : "证区边界已隐藏 · 点击显示"}
                    </strong>
                  </span>
                  <i />
                </button>
              </div>

              <div className="map-controls map-controls--bottom">
                <TransitControl
                  routes={transit.feed.routes}
                  activeRoutes={transit.activeRoutes}
                  vehicles={transit.feed.vehicles.length}
                  expanded={transitPanelExpanded}
                  visible={preferences.mapTransitVisible}
                  loading={transit.loading}
                  error={transit.feed.error}
                  onToggleExpanded={() =>
                    setTransitPanelExpanded((current) => !current)
                  }
                  onToggleVisible={() =>
                    update({
                      mapTransitVisible: !preferences.mapTransitVisible,
                    })
                  }
                  onToggleRoute={transit.toggleRoute}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="insight-grid">
          <article className="insight-card insight-card--permit">
            <div className="insight-card__heading">
              <span>
                <Icon icon="solar:key-square-2-bold-duotone" />
              </span>
              <div>
                <small>你的停车证</small>
                <h3>{permitLabel}</h3>
              </div>
              <button type="button" onClick={() => setPermitOpen(true)}>
                修改
              </button>
            </div>
            {permitSummary ? (
              <>
                <div className="current-window">
                  <span className="live-dot" />
                  <strong>{permitSummary.time.labelZh}</strong>
                  <small>以 Columbus 美东时间判断</small>
                </div>
                <p>{permitSummary.surfaceZh}</p>
                <p>{permitSummary.garageZh}</p>
                {permitPlanningNotice && (
                  <button
                    type="button"
                    className={cn(
                      "insight-planning-notice",
                      `is-${permitPlanningNotice.tone}`,
                    )}
                    onClick={() => setAccessGuideOpen(true)}
                  >
                    <Icon
                      icon={
                        permitPlanningNotice.tone === "night"
                          ? "solar:moon-stars-bold-duotone"
                          : "solar:clock-circle-bold-duotone"
                      }
                    />
                    <span>
                      <strong>{permitPlanningNotice.titleZh}</strong>
                      <small>{permitPlanningNotice.detailZh}</small>
                    </span>
                    <Icon icon="solar:alt-arrow-right-linear" />
                  </button>
                )}
                {permitSummary.status === "not-included" && (
                  <div className="insight-night-cost">
                    <span>工作日 3–5 a.m. · 2 小时参考</span>
                    <b>地面 ${twoHourNightCost.surfaceUsd.toFixed(0)}</b>
                    <b>
                      Academic ${twoHourNightCost.academicGarageUsd.toFixed(0)}
                    </b>
                  </div>
                )}
              </>
            ) : (
              <div className="insight-empty">
                <p>
                  设置停车证后，这里会按高峰、非高峰、周末与夜间显示当前权限摘要。
                </p>
                <button type="button" onClick={() => setPermitOpen(true)}>
                  设置停车证
                  <Icon icon="solar:alt-arrow-right-linear" />
                </button>
              </div>
            )}
            <div className="insight-card__fine-print">
              <Icon icon="solar:danger-triangle-linear" />
              现场标识、活动地图、封闭通知始终优先于此摘要。
            </div>
          </article>

          <article className="insight-card insight-card--ev">
            <div className="insight-card__heading">
              <span>
                <Icon icon="solar:bolt-circle-bold-duotone" />
              </span>
              <div>
                <small>EV 出行</small>
                <h3>校内慢充，校外快充</h3>
              </div>
              <button
                type="button"
                onClick={() => update({ evMode: !preferences.evMode })}
              >
                {preferences.evMode ? "隐藏图层" : "显示图层"}
              </button>
            </div>
            <div className="ev-stats">
              <div>
                <strong>
                  {
                    PARKING_LOCATIONS.filter(
                      (location) => location.hasEvCharging,
                    ).length
                  }
                </strong>
                <span>个停车点标注有 Level 2</span>
              </div>
              <div>
                <strong>
                  {
                    ev.stations.filter(
                      (station) =>
                        station.networkKind === "tesla-supercharger",
                    ).length
                  }
                </strong>
                <span>个周边 Tesla 超充站</span>
              </div>
            </div>
            {nearestFastCharger && (
              <a
                className="charger-row"
                href={
                  nearestFastCharger.website ??
                  `https://www.google.com/maps/search/?api=1&query=${nearestFastCharger.latitude},${nearestFastCharger.longitude}`
                }
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <Icon
                    icon={
                      nearestFastCharger.networkKind === "tesla-supercharger"
                        ? "simple-icons:tesla"
                        : "solar:bolt-circle-bold-duotone"
                    }
                  />
                </span>
                <span>
                  <small>附近快充</small>
                  <strong>{nearestFastCharger.name}</strong>
                  <em>
                    {[
                      nearestFastCharger.capacity
                        ? `${nearestFastCharger.capacity} 个快充端口`
                        : undefined,
                      nearestFastCharger.power,
                      nearestFastCharger.connectors
                        .map((connector) =>
                          connector.type === "other"
                            ? "接口未公开"
                            : connector.type,
                        )
                        .join(" / "),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "查看位置"}
                  </em>
                </span>
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            )}
            <p className="source-note">
              {ev.isFallback
                ? (ev.warning ??
                  "NLR/AFDC 暂不可用，当前显示经官方页面核对的非实时备用站点。")
                : ev.warning
                  ? ev.warning
                  : ev.error
                    ? `充电站刷新失败：${ev.error}。当前内容可能来自浏览器缓存。`
                    : "站点来自美国能源部 AFDC；运营状态不等于实时空闲端口，价格和占用以运营商应用为准。"}
            </p>
          </article>

          <article className="insight-card insight-card--event">
            <div className="insight-card__heading">
              <span>
                <Icon icon="solar:calendar-mark-bold-duotone" />
              </span>
              <div>
                <small>出发前检查</small>
                <h3>活动与临时调整</h3>
              </div>
            </div>
            <div className="event-callout">
              <span>
                <Icon icon="solar:flag-2-bold" />
              </span>
              <div>
                <strong>大型活动会覆盖日常停车权限</strong>
                <p>
                  足球比赛、演唱会、封路和恶劣天气都可能临时清空或关闭区域。
                </p>
              </div>
            </div>
            <div className="official-links">
              <a
                href={OFFICIAL_PARKING_URLS.parkingNews}
                target="_blank"
                rel="noreferrer"
              >
                CampusParc 最新通知
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
              <a
                href="https://osu.campusparc.com/find-parking/ohio-state-event-parking/"
                target="_blank"
                rel="noreferrer"
              >
                活动停车入口
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
              <a
                href="https://osu.campusparc.com/find-parking/ohio-state-event-parking/ohio-state-football/"
                target="_blank"
                rel="noreferrer"
              >
                Football 当日规则
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            </div>
          </article>

          <article className="insight-card insight-card--transit">
            <div className="insight-card__heading">
              <span>
                <Icon icon="solar:bus-bold-duotone" />
              </span>
              <div>
                <small>离开停车场之后</small>
                <h3>CABS 与 COTA 换乘</h3>
              </div>
            </div>
            <div className="transit-summary">
              <div>
                <strong>{transit.feed.routes.length || "—"}</strong>
                <span>条 CABS 当前线路</span>
              </div>
              <div>
                <strong>{transit.feed.vehicles.length}</strong>
                <span>辆所选线路车辆</span>
              </div>
            </div>
            <p>
              CABS 地图来自 Ohio State App 后端；线路会动态变化。COTA
              市区公交请使用官方行程规划查看到站时间。
            </p>
            <div className="official-links official-links--row">
              <a href="https://ttm.osu.edu/cabs" target="_blank" rel="noreferrer">
                CABS 班次
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
              <a href="https://www.cota.com/" target="_blank" rel="noreferrer">
                COTA 行程规划
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            </div>
          </article>
        </section>

        <footer className="site-footer">
          <div>
            <span className="brand__mark brand__mark--small">
              <Icon icon="solar:garage-bold" />
            </span>
            <span>
              <strong>Buckeye Parking</strong>
              <small>非 Ohio State / CampusParc 官方产品</small>
            </span>
          </div>
          <p>
            无需登录。偏好和上次成功数据仅保存在此浏览器。停车决定请以现场标识与官方通知为准。
          </p>
          <nav aria-label="数据来源">
            <a
              href="https://osu.campusparc.com/"
              target="_blank"
              rel="noreferrer"
            >
              CampusParc
            </a>
            <a href="https://ttm.osu.edu/cabs" target="_blank" rel="noreferrer">
              CABS
            </a>
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>
          </nav>
        </footer>
      </main>

      <nav className="mobile-bottom-nav" aria-label="移动端导航">
        <button
          type="button"
          className={mobileView === "list" ? "is-active" : ""}
          onClick={() => setMobileView("list")}
        >
          <Icon
            icon={
              mobileView === "list"
                ? "solar:list-bold"
                : "solar:list-linear"
            }
          />
          <span>停车</span>
        </button>
        <button
          type="button"
          className={mobileView === "map" ? "is-active" : ""}
          onClick={() => setMobileView("map")}
        >
          <Icon
            icon={
              mobileView === "map"
                ? "solar:map-bold"
                : "solar:map-linear"
            }
          />
          <span>地图</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileView("list");
            setSidebarTab("charging");
            if (!preferences.evMode) update({ evMode: true });
          }}
          className={sidebarTab === "charging" ? "is-active" : ""}
        >
          <Icon
            icon={
              sidebarTab === "charging"
                ? "solar:bolt-circle-bold"
                : "solar:bolt-circle-linear"
            }
          />
          <span>充电</span>
        </button>
        <button type="button" onClick={() => setPermitOpen(true)}>
          <Icon icon="solar:key-square-2-linear" />
          <span>停车证</span>
        </button>
      </nav>

      <PermitSettings
        key={`${permitOpen ? "open" : "closed"}-${preferences.permitCode}`}
        open={permitOpen}
        selectedCode={preferences.permitCode}
        selectedIdentity={preferences.parkingIdentity}
        now={now}
        onSave={handlePermitSave}
        onClose={handlePermitClose}
      />
      <ParkingAccessGuide
        open={accessGuideOpen}
        now={now}
        permitCode={preferences.permitCode}
        permitLabel={permitLabel}
        onClose={handleAccessGuideClose}
        onEditPermit={handleEditPermitFromGuide}
      />
    </div>
  );
}
