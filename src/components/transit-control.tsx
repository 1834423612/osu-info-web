"use client";

import { Icon } from "@iconify/react";

import { cn } from "@/lib/utils";
import type { TransitRoute } from "@/types/transit";

export function TransitControl({
  routes,
  activeRoutes,
  vehicles,
  expanded,
  visible,
  loading,
  error,
  onToggleExpanded,
  onToggleVisible,
  onToggleRoute,
}: {
  routes: TransitRoute[];
  activeRoutes: string[];
  vehicles: number;
  expanded: boolean;
  visible: boolean;
  loading: boolean;
  error?: string;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onToggleRoute: (code: string) => void;
}) {
  return (
    <div className="map-control-card map-control-card--transit">
      <div className="map-control-card__header">
        <button
          type="button"
          className="map-control-card__summary"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          <span className="map-control-card__icon">
            <Icon icon="solar:bus-bold" />
          </span>
          <span>
            <small>CABS 实时</small>
            <strong>
              {loading ? "正在连接" : error ? "暂时离线" : `${vehicles} 辆车在线`}
            </strong>
          </span>
          <Icon
            className="map-control-card__chevron"
            icon={
              expanded
                ? "solar:alt-arrow-up-linear"
                : "solar:alt-arrow-down-linear"
            }
          />
        </button>
        <button
          type="button"
          className={cn(
            "map-control-card__visibility",
            visible && "is-active",
          )}
          onClick={onToggleVisible}
          aria-pressed={visible}
          aria-label={visible ? "隐藏地图公交" : "显示地图公交"}
          title={visible ? "隐藏地图公交" : "显示地图公交"}
        >
          <Icon icon={visible ? "solar:eye-bold" : "solar:eye-closed-bold"} />
          <i />
        </button>
      </div>
      {expanded && (
        <div className="map-control-card__routes">
          <div>
            {routes.map((route) => {
              const active = activeRoutes.includes(route.code);
              return (
                <button
                  type="button"
                  key={route.code}
                  className={cn("route-chip", active && "is-active")}
                  style={
                    {
                      "--route-color": route.color,
                    } as React.CSSProperties
                  }
                  onClick={() => onToggleRoute(route.code)}
                  aria-pressed={active}
                  title={route.name}
                >
                  <i />
                  <b>{route.code}</b>
                  <span>{route.name}</span>
                </button>
              );
            })}
          </div>
          <p>
            地图显示 {activeRoutes.length} / {routes.length} 条完整线路；车辆每
            15 秒更新。折叠面板不会隐藏路线。
            <a
              href="https://ttm.osu.edu/cabs"
              target="_blank"
              rel="noreferrer"
            >
              查看班次
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
