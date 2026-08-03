"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type {
  TransitRouteOverview,
  TransitVehicleMapInfo,
} from "@/lib/transit-map";

function formatVehicleUpdate(value?: string) {
  if (!value) return "等待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待更新";
  return `${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  })} ET`;
}

function formatEta(minutes?: number) {
  if (minutes === undefined) return "预测中";
  if (minutes <= 1) return "即将到站";
  return `${minutes} 分钟`;
}

function nextStopName(info: TransitVehicleMapInfo) {
  return (
    info.nextStop?.stopName ??
    info.upcomingStops[0]?.name ??
    "等待下一次到站预测"
  );
}

export function TransitRoutePanel({
  routes,
  activeRoutes,
  selectedRoute,
  loading,
  error,
  onSelectRoute,
  onToggleRoute,
}: {
  routes: TransitRouteOverview[];
  activeRoutes: string[];
  selectedRoute?: string;
  loading: boolean;
  error?: string;
  onSelectRoute: (code: string) => void;
  onToggleRoute: (code: string) => void;
}) {
  const [expandedVehicle, setExpandedVehicle] = useState<string>();

  if (loading) {
    return (
      <div className="transit-route-panel__state" role="status">
        <Icon icon="solar:bus-bold-duotone" />
        <strong>正在读取 CABS 六条线路</strong>
        <span>完整路线与车辆信息会自动更新</span>
      </div>
    );
  }

  return (
    <div className="transit-route-panel">
      {error && (
        <div className="transit-route-panel__warning">
          <Icon icon="solar:danger-triangle-bold-duotone" />
          <span>{error}</span>
        </div>
      )}
      <div className="transit-route-panel__intro">
        <span>
          <Icon icon="solar:bus-bold" />
        </span>
        <div>
          <strong>全部 CABS 线路</strong>
          <small>展开线路即可在地图显示双向全程路线</small>
        </div>
        <b>{routes.length}</b>
      </div>

      <div className="transit-route-list">
        {routes.map((overview) => {
          const { route } = overview;
          const selected = selectedRoute === route.code;
          const visible = activeRoutes.includes(route.code);
          return (
            <article
              key={route.code}
              className={cn("transit-route-card", selected && "is-selected")}
              style={{ "--route-color": route.color } as React.CSSProperties}
            >
              <div className="transit-route-card__summary">
                <button
                  type="button"
                  className="transit-route-card__main"
                  onClick={() => onSelectRoute(route.code)}
                  aria-expanded={selected}
                >
                  <span className="transit-route-card__code">{route.code}</span>
                  <span className="transit-route-card__copy">
                    <strong>{route.name}</strong>
                    <small>
                      {overview.vehicleCount
                        ? `${overview.vehicleCount} 辆在线`
                        : "当前无在线车辆"}
                      <i />
                      {overview.patterns.length
                        ? `${overview.patterns.length} 个完整方向`
                        : "路线读取中"}
                    </small>
                  </span>
                  <Icon
                    icon={
                      selected
                        ? "solar:alt-arrow-up-linear"
                        : "solar:alt-arrow-down-linear"
                    }
                  />
                </button>
                <button
                  type="button"
                  className={cn(
                    "transit-route-card__map-toggle",
                    visible && "is-active",
                  )}
                  onClick={() => onToggleRoute(route.code)}
                  aria-pressed={visible}
                  title={visible ? "从地图隐藏此线路" : "在地图显示完整线路"}
                >
                  <Icon icon={visible ? "solar:map-point-bold" : "solar:map-point-linear"} />
                  <span>{visible ? "地图显示" : "地图隐藏"}</span>
                </button>
              </div>

              {selected && (
                <div className="transit-route-card__detail">
                  <section className="transit-route-card__path">
                    <header>
                      <span>
                        <Icon icon="solar:route-bold" />
                        全程站序
                      </span>
                      <small>横向滑动查看所有站点</small>
                    </header>
                    {overview.patterns.length ? (
                      <div className="transit-pattern-list">
                        {overview.patterns.map((pattern) => (
                          <div
                            className="transit-pattern-board"
                            key={pattern.pattern.id}
                          >
                            <div className="transit-pattern-board__label">
                              <strong>{pattern.directionLabel}</strong>
                              <small>
                                {pattern.stops.length
                                  ? `${pattern.stops.length} 站`
                                  : "站序匹配中"}
                              </small>
                            </div>
                            {pattern.stops.length ? (
                              <ol aria-label={`${route.name} ${pattern.directionLabel}站序`}>
                                {pattern.stops.map((stop, index) => (
                                  <li key={`${pattern.pattern.id}:${stop.id}:${index}`}>
                                    <i />
                                    <span>{stop.name}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p>完整线路已显示在地图，站点顺序正在匹配。</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="transit-route-card__path-empty">
                        <Icon icon="solar:refresh-circle-linear" />
                        正在读取官方路线几何
                      </div>
                    )}
                  </section>

                  {overview.vehicles.length ? (
                    <div className="transit-vehicle-list">
                      <div className="transit-vehicle-list__heading">
                        <strong>实时车辆</strong>
                        <small>点按车辆展开横向报站</small>
                      </div>
                      {overview.vehicles.map((info) => {
                        const vehicleKey = `${route.code}:${info.vehicle.id}`;
                        const expanded = expandedVehicle === vehicleKey;
                        const upcomingStops = info.upcomingStops.slice(0, 24);
                        return (
                          <section
                            key={vehicleKey}
                            className={cn(
                              "transit-vehicle-board",
                              expanded && "is-expanded",
                            )}
                          >
                            <button
                              type="button"
                              className="transit-vehicle-board__summary"
                              onClick={() =>
                                setExpandedVehicle((current) =>
                                  current === vehicleKey ? undefined : vehicleKey,
                                )
                              }
                              aria-expanded={expanded}
                            >
                              <span className="transit-vehicle-board__icon">
                                <Icon icon="solar:bus-bold" />
                              </span>
                              <span className="transit-vehicle-board__identity">
                                <strong>
                                  车辆 {info.vehicleLabel}
                                  {info.vehicle.delayed && <em>延误</em>}
                                </strong>
                                <small>
                                  {info.routeDirectionLabel ?? "运行方向确认中"}
                                  <i />
                                  {formatVehicleUpdate(info.vehicle.updated)}
                                </small>
                              </span>
                              <span className="transit-vehicle-board__next">
                                <small>下一站</small>
                                <strong>{nextStopName(info)}</strong>
                              </span>
                              <b>{formatEta(info.etaMinutes)}</b>
                              <Icon
                                className="transit-vehicle-board__chevron"
                                icon={
                                  expanded
                                    ? "solar:alt-arrow-up-linear"
                                    : "solar:alt-arrow-down-linear"
                                }
                              />
                            </button>

                            {expanded && (
                              <div className="transit-vehicle-board__trip">
                                <div className="transit-vehicle-board__destination">
                                  <span>开往</span>
                                  <strong>
                                    {info.destination ||
                                      info.terminalStop?.name ||
                                      "线路终点"}
                                  </strong>
                                  {typeof info.vehicle.speed === "number" && (
                                    <small>{Math.round(info.vehicle.speed)} mph</small>
                                  )}
                                </div>
                                <ol className="transit-trip-strip" aria-label={`车辆 ${info.vehicleLabel} 后续报站`}>
                                  {(info.lastReportedStop || info.nearestStop) && (
                                    <li className="is-current">
                                      <i />
                                      <small>
                                        {info.lastReportedStop
                                          ? "最近上报"
                                          : "车辆附近"}
                                      </small>
                                      <strong>
                                        {info.lastReportedStop?.name ??
                                          info.nearestStop?.name}
                                      </strong>
                                      <b>当前位置</b>
                                    </li>
                                  )}
                                  {upcomingStops.map((stop, index) => (
                                    <li
                                      key={`${stop.id ?? stop.name}-${index}`}
                                      className={index === 0 ? "is-next" : ""}
                                    >
                                      <i>
                                        {index === 0 && (
                                          <Icon icon="solar:bus-bold" />
                                        )}
                                      </i>
                                      <small>
                                        {index === 0 ? "下一站" : `第 ${index + 1} 站`}
                                      </small>
                                      <strong>{stop.name}</strong>
                                      <b>{formatEta(stop.etaMinutes)}</b>
                                    </li>
                                  ))}
                                  {!upcomingStops.length && (
                                    <li className="is-next">
                                      <i />
                                      <small>实时到站</small>
                                      <strong>等待下一次车辆预测</strong>
                                      <b>预测中</b>
                                    </li>
                                  )}
                                </ol>
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="transit-route-card__empty">
                      <Icon icon="solar:moon-sleep-bold-duotone" />
                      <span>
                        <strong>当前没有在线车辆</strong>
                        <small>双向完整线路仍会显示；班次以 CABS 官方通知为准。</small>
                      </span>
                    </div>
                  )}
                  <p className="transit-route-card__note">
                    地图路线来自官方完整 polyline；站序为路线匹配结果，到站时间来自车辆实时预测。
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
