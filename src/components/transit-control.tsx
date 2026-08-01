"use client";

import { Icon } from "@iconify/react";

import { cn } from "@/lib/utils";
import type { TransitRoute } from "@/types/transit";

export function TransitControl({
  routes,
  activeRoutes,
  vehicles,
  enabled,
  loading,
  error,
  onToggleEnabled,
  onToggleRoute,
}: {
  routes: TransitRoute[];
  activeRoutes: string[];
  vehicles: number;
  enabled: boolean;
  loading: boolean;
  error?: string;
  onToggleEnabled: () => void;
  onToggleRoute: (code: string) => void;
}) {
  return (
    <div className="map-control-card map-control-card--transit">
      <button
        type="button"
        className="map-control-card__summary"
        onClick={onToggleEnabled}
        aria-expanded={enabled}
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
            enabled
              ? "solar:alt-arrow-up-linear"
              : "solar:alt-arrow-down-linear"
          }
        />
      </button>
      {enabled && (
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
                  {route.code}
                </button>
              );
            })}
          </div>
          <p>
            车辆每 15 秒更新；停运时显示 0 辆，不代表数据故障。
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
