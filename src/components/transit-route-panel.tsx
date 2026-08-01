"use client";

import { Icon } from "@iconify/react";

import { cn } from "@/lib/utils";
import type { TransitRouteOverview } from "@/lib/transit-map";

function formatVehicleUpdate(value?: string) {
  if (!value) return "等待车辆更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待车辆更新";
  return `更新 ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  })} ET`;
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
  if (loading) {
    return (
      <div className="transit-route-panel__state" role="status">
        <Icon icon="solar:bus-bold-duotone" />
        <strong>正在读取 CABS 六条线路</strong>
        <span>路线与车辆信息会自动更新</span>
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
          <small>选择线路查看车辆号、下一站与到站预测</small>
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
                        ? `${overview.vehicleCount} 辆车在线`
                        : "当前无在线车辆"}
                      <i />
                      {overview.patterns.length} 个运行方向
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
                  title={visible ? "取消选择此线路" : "选择此线路显示在地图"}
                >
                  <Icon icon={visible ? "solar:eye-bold" : "solar:eye-closed-bold"} />
                  <span>{visible ? "已选择" : "未选择"}</span>
                </button>
              </div>

              {selected && (
                <div className="transit-route-card__detail">
                  <div className="transit-route-directions">
                    {overview.patterns.map((pattern) => (
                      <span key={pattern.pattern.id}>
                        <i />
                        <b>{pattern.directionLabel}</b>
                        <small>{pattern.stops.length} 个估算站序</small>
                      </span>
                    ))}
                  </div>

                  {overview.vehicles.length ? (
                    <div className="transit-vehicle-list">
                      {overview.vehicles.map((info) => (
                        <section
                          key={`${route.code}:${info.vehicle.id}`}
                          className="transit-vehicle-board"
                        >
                          <header>
                            <span>
                              <Icon icon="solar:bus-bold" />
                            </span>
                            <div>
                              <strong>
                                车辆 {info.vehicleLabel}
                                {info.vehicle.delayed && <em>可能延误</em>}
                              </strong>
                              <small>{formatVehicleUpdate(info.vehicle.updated)}</small>
                            </div>
                            {typeof info.vehicle.speed === "number" && (
                              <b>{Math.round(info.vehicle.speed)} mph</b>
                            )}
                          </header>

                          <div className="transit-vehicle-board__destination">
                            <span>开往</span>
                            <strong>
                              {info.destination || info.terminalStop?.name || "线路终点"}
                            </strong>
                          </div>

                          <div className="transit-vehicle-board__stops">
                            {(info.lastReportedStop || info.nearestStop) && (
                              <div className="is-current">
                                <i />
                                <span>
                                  <small>
                                    {info.lastReportedStop ? "最近上报站" : "车辆附近 · 位置估算"}
                                  </small>
                                  <strong>
                                    {info.lastReportedStop?.name ?? info.nearestStop?.name}
                                  </strong>
                                </span>
                              </div>
                            )}
                            {info.upcomingStops.slice(0, 3).map((stop, index) => (
                              <div
                                key={`${stop.id ?? stop.name}-${index}`}
                                className={index === 0 ? "is-next" : ""}
                              >
                                <i>{index === 0 ? <Icon icon="solar:bus-bold" /> : null}</i>
                                <span>
                                  <small>{index === 0 ? "下一站" : `后续第 ${index + 1} 站`}</small>
                                  <strong>{stop.name}</strong>
                                </span>
                                <b>
                                  {stop.etaMinutes === undefined
                                    ? "预测中"
                                    : stop.etaMinutes <= 1
                                      ? "即将到站"
                                      : `${stop.etaMinutes} 分`}
                                </b>
                              </div>
                            ))}
                            {!info.upcomingStops.length && (
                              <div className="is-next">
                                <i />
                                <span>
                                  <small>实时到站</small>
                                  <strong>等待车辆下一次预测</strong>
                                </span>
                              </div>
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="transit-route-card__empty">
                      <Icon icon="solar:moon-sleep-bold-duotone" />
                      <span>
                        <strong>当前没有在线车辆</strong>
                        <small>完整线路仍可在地图显示；班次以 CABS 官方通知为准。</small>
                      </span>
                    </div>
                  )}
                  <p className="transit-route-card__note">
                    线路来自官方完整 polyline；静态站序为地图匹配估算，车辆到站时间来自实时 predictions。
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
