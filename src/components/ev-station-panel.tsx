"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/ev-station-panel.module.css";
import type {
  EvPricePeriod,
  EvStation,
  EvTeslaPriceAudience,
  EvUpstreamStatus,
} from "@/types/ev";

type StationFilter =
  | "all"
  | "tesla"
  | "dc-fast"
  | "level-2"
  | "campus"
  | "public";
type StationSort = "distance" | "power" | "capacity" | "name";

export type EvStationPanelProps = {
  stations: EvStation[];
  loading: boolean;
  error?: string;
  warning?: string;
  updatedAt?: string;
  upstreams?: EvUpstreamStatus[];
  selectedId?: string;
  onSelectStation?: (station: EvStation) => void;
  mapVisible?: boolean;
  onToggleMap?: () => void;
};

const CAMPUS_CENTER = { latitude: 40.0067, longitude: -83.0305 };
const FILTERS: Array<{ id: StationFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "tesla", label: "Tesla" },
  { id: "dc-fast", label: "其他快充" },
  { id: "level-2", label: "Level 2" },
  { id: "campus", label: "校内" },
  { id: "public", label: "普通公共" },
];
const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const UPSTREAM_LABELS: Record<EvUpstreamStatus["service"], string> = {
  nlr: "NLR 站点",
  "tesla-charger": "Tesla 价格",
  "tesla-location": "Tesla 位置",
};

function sourceHealth(
  upstreams: EvUpstreamStatus[],
  service: EvUpstreamStatus["service"],
) {
  const attempts = upstreams.filter((item) => item.service === service);
  const stationGroups = new Map<string, EvUpstreamStatus[]>();
  for (const attempt of attempts) {
    const key = attempt.stationId ?? "all";
    stationGroups.set(key, [...(stationGroups.get(key) ?? []), attempt]);
  }
  const hasUnrecoveredStation = [...stationGroups.values()].some(
    (group) => !group.some((attempt) => attempt.ok),
  );
  const success =
    attempts.find(
      (item) => item.ok && item.transport === "browser" && item.cache !== "stale",
    ) ??
    attempts.find(
      (item) => item.ok && item.transport === "server" && item.cache !== "stale",
    ) ??
    attempts.find((item) => item.ok);
  if (success) {
    return {
      state: hasUnrecoveredStation ? ("partial" as const) : ("success" as const),
      label:
        hasUnrecoveredStation
          ? "部分站点失败"
          : success.transport === "browser"
          ? "浏览器直连"
          : success.cache === "fresh"
            ? "服务器缓存"
            : success.cache === "stale"
              ? "过期缓存"
              : "服务器代理",
      detail: success.message,
    };
  }
  const failure = attempts.at(-1);
  if (failure) {
    return {
      state: "failure" as const,
      label:
        failure.failureKind === "edge-challenge"
          ? "Akamai 拒绝"
          : failure.status
            ? `HTTP ${failure.status}`
            : "请求失败",
      detail: failure.message,
    };
  }
  return { state: "waiting" as const, label: "等待请求" };
}

function UpstreamHealth({
  upstreams,
}: {
  upstreams: EvUpstreamStatus[];
}) {
  return (
    <div className={styles.upstreamHealth} aria-label="充电数据源状态">
      {(["nlr", "tesla-charger", "tesla-location"] as const).map(
        (service) => {
          const health = sourceHealth(upstreams, service);
          return (
            <span
              key={service}
              className={styles[`${health.state}Health`]}
              title={health.detail}
            >
              <i />
              <b>{UPSTREAM_LABELS[service]}</b>
              <em>{health.label}</em>
            </span>
          );
        },
      )}
    </div>
  );
}

function distanceMiles(station: EvStation) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(station.latitude - CAMPUS_CENTER.latitude);
  const longitudeDelta = toRadians(station.longitude - CAMPUS_CENTER.longitude);
  const campusLatitude = toRadians(CAMPUS_CENTER.latitude);
  const stationLatitude = toRadians(station.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(campusLatitude) *
      Math.cos(stationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    3958.8 *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function speedLabel(station: EvStation) {
  return (station.chargingSpeeds ?? ["unknown"])
    .map((speed) => {
      if (speed === "dc-fast") return "DC 快充";
      if (speed === "level-2") return "Level 2";
      if (speed === "level-1") return "Level 1";
      return "功率级别未公开";
    })
    .join(" + ");
}

function maximumPower(station: EvStation) {
  return station.connectors.reduce(
    (maximum, connector) => Math.max(maximum, connector.powerKw ?? 0),
    0,
  );
}

function formatTimestamp(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    date.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    }) + " ET"
  );
}

function safeHttpsUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function minutes(value: string) {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
}

function periodDuration(period: EvPricePeriod) {
  const difference =
    (minutes(period.endTime) - minutes(period.startTime) + 1440) % 1440;
  return difference || 1440;
}

function formatRate(rate: number, currencyCode: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rate);
}

function currentSiteDay(timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone,
  })
    .format(new Date())
    .toLowerCase();
  return DAY_NAMES.includes(weekday as (typeof DAY_NAMES)[number])
    ? (weekday as (typeof DAY_NAMES)[number])
    : "sunday";
}

function PriceChart({
  group,
  congestion,
  currentHour,
}: {
  group: EvTeslaPriceAudience;
  congestion: number[];
  currentHour: number;
}) {
  const periods: EvPricePeriod[] = group.periods.length
    ? group.periods
    : group.baseRate !== undefined
      ? [
          {
            startTime: "00:00",
            endTime: "00:00",
            days: [],
            rate: group.baseRate,
            currencyCode: "USD",
            unit: "kWh",
          },
        ]
      : [];

  return (
    <div className={styles.priceChart}>
      {periods.length > 0 ? (
        <div className={styles.priceSegments} aria-label="全天分时充电价格">
          {periods.map((period, index) => (
            <div
              key={period.startTime + "-" + period.endTime + "-" + index}
              style={{ flexGrow: periodDuration(period) }}
            >
              <strong>{formatRate(period.rate, period.currencyCode)}</strong>
              <span>
                {period.startTime}–
                {period.endTime === "00:00" ? "24:00" : period.endTime}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.emptyPricing}>Tesla 当前未返回分时电价数组</p>
      )}
      {congestion.length === 24 && (
        <div
          className={styles.congestionChart}
          aria-label="今日典型每小时拥挤度"
        >
          {congestion.map((value, hour) => (
            <i
              key={hour}
              className={hour === currentHour ? styles.currentBar : undefined}
              style={{ height: Math.max(8, value * 100) + "%" }}
              title={
                hour +
                ":00 · 预计拥挤度 " +
                Math.round(value * 100) +
                "%"
              }
            />
          ))}
        </div>
      )}
      <div className={styles.chartAxis} aria-hidden="true">
        <span>0时</span>
        <span>6时</span>
        <span>12时</span>
        <span>18时</span>
        <span>24时</span>
      </div>
      {group.congestionFee && (
        <p className={styles.congestionFee}>
          高占用时拥堵费最高{" "}
          <strong>
            {formatRate(
              group.congestionFee.rate,
              group.congestionFee.currencyCode,
            )}
            /分钟
          </strong>
        </p>
      )}
    </div>
  );
}

function TeslaPricing({ station }: { station: EvStation }) {
  const details = station.teslaDetails;
  if (!details) return null;
  const day = currentSiteDay(details.timeZone);
  const dayIndex = DAY_NAMES.indexOf(day);
  const congestion = details.congestionByDay[day] ?? [];
  const currentHour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: details.timeZone,
      }).format(new Date()),
    ) % 24;

  return (
    <section className={styles.teslaPricing}>
      <header>
        <div>
          <strong>Tesla 官方价格</strong>
          <span>
            {details.dataState === "live"
              ? "本次实时接口获取 · " + formatTimestamp(details.fetchedAt)
              : "官方接口快照 · 非实时 · " +
                formatTimestamp(details.fetchedAt)}
          </span>
        </div>
        <i
          className={
            details.dataState === "live" ? styles.liveDot : styles.snapshotDot
          }
        />
      </header>
      {details.adapterNote && (
        <div className={styles.adapterNote}>
          <Icon icon="solar:adapter-bold-duotone" />
          <span>{details.adapterNote}</span>
        </div>
      )}
      {details.pricing.map((group, index) => (
        <details key={group.audience} open={index === 0}>
          <summary>
            <span>
              {group.audience === "tesla-member"
                ? "Tesla 车辆与会员"
                : "非 Tesla 车辆"}
            </span>
            <Icon icon="solar:alt-arrow-down-linear" />
          </summary>
          <PriceChart
            group={{
              ...group,
              periods: group.periods.filter(
                (period) =>
                  period.days.length === 0 || period.days.includes(dayIndex),
              ),
            }}
            congestion={congestion}
            currentHour={currentHour}
          />
        </details>
      ))}
      <p className={styles.forecastNote}>
        <Icon icon="solar:info-circle-linear" />
        灰色柱为 Tesla 返回的典型时段拥挤度，并非当前空闲桩数量；最终价格以
        Tesla App 开始充电前显示为准。
      </p>
    </section>
  );
}

function StationDetails({ station }: { station: EvStation }) {
  const stationPage = safeHttpsUrl(station.website);
  const networkPage = station.sources.find((source) => {
    const url = safeHttpsUrl(source.url);
    return (
      url &&
      url !== stationPage &&
      !url.includes("/api/") &&
      !source.label.includes("接口")
    );
  });
  const networkPageUrl = safeHttpsUrl(networkPage?.url);
  return (
    <div className={styles.stationDetails}>
      <dl>
        <div>
          <dt>接口</dt>
          <dd>
            {station.connectors.length
              ? station.connectors
                  .map((connector) =>
                    [
                      connector.type === "other" ? "未公开" : connector.type,
                      connector.count ? "×" + connector.count : undefined,
                      connector.powerKw
                        ? connector.powerKw + " kW"
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  )
                  .join(" / ")
              : "运营商未公开"}
          </dd>
        </div>
        <div>
          <dt>费用</dt>
          <dd>{station.pricing ?? "运营商未公开；以 App 或现场为准"}</dd>
        </div>
        {station.hours && (
          <div>
            <dt>开放</dt>
            <dd>{station.hours}</dd>
          </div>
        )}
        {station.address && (
          <div>
            <dt>地址</dt>
            <dd>{station.address}</dd>
          </div>
        )}
      </dl>
      {station.accessNote && (
        <p className={styles.accessNote}>{station.accessNote}</p>
      )}
      {station.networkKind === "tesla-supercharger" &&
        !station.teslaDetails && (
          <p className={styles.teslaUnavailable}>
            <Icon icon="solar:shield-warning-bold-duotone" />
            Tesla 详情与价格 GET 已由浏览器直接请求；若 Tesla 的跨域防护拦截，本站仅显示
            NLR 公开资料，价格与拥挤度不会伪装为实时。
          </p>
        )}
      <TeslaPricing station={station} />
      <footer>
        <span>
          {station.availabilityIsRealtime
            ? "实时端口状态"
            : "未公开实时空闲端口"}
        </span>
        <div>
          {stationPage && (
            <a
              className={styles.primaryLink}
              href={stationPage}
              target="_blank"
              rel="noreferrer"
            >
              {station.networkKind === "tesla-supercharger"
                ? "打开 Tesla 站点详情"
                : station.campusLocation
                  ? "打开校方站点详情"
                  : "打开 AFDC 站点详情"}
            </a>
          )}
          {networkPageUrl && (
            <a href={networkPageUrl} target="_blank" rel="noreferrer">
              {networkPage?.label ?? "运营商官网"}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}

export function EvStationPanel({
  stations,
  loading,
  error,
  warning,
  updatedAt,
  upstreams = [],
  selectedId,
  onSelectStation,
  mapVisible,
  onToggleMap,
}: EvStationPanelProps) {
  const [filter, setFilter] = useState<StationFilter>("all");
  const [sort, setSort] = useState<StationSort>("distance");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string>();
  const [collapsedSelectedId, setCollapsedSelectedId] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!selectedId || !stations.some((station) => station.id === selectedId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      const list = listRef.current;
      const card = cardRefs.current.get(selectedId);
      if (!list || !card) return;
      list.scrollTo({
        top: Math.max(0, card.offsetTop - list.offsetTop - 8),
        behavior: "smooth",
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedId, stations]);

  const filteredStations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchesFilter = (station: EvStation) => {
      if (filter === "all") return true;
      if (filter === "tesla") {
        return station.networkKind === "tesla-supercharger";
      }
      if (filter === "campus") return Boolean(station.campusLocation);
      if (filter === "public") {
        return (
          !station.campusLocation &&
          station.networkKind !== "tesla-supercharger"
        );
      }
      if (filter === "dc-fast") {
        return (
          station.networkKind !== "tesla-supercharger" &&
          Boolean(station.chargingSpeeds?.includes("dc-fast"))
        );
      }
      return Boolean(station.chargingSpeeds?.includes("level-2"));
    };
    const matchesQuery = (station: EvStation) =>
      !normalizedQuery ||
      [station.name, station.operator, station.address]
        .filter(Boolean)
        .some((value) =>
          value!.toLocaleLowerCase().includes(normalizedQuery),
        );

    return stations
      .filter(
        (station) =>
          station.id === selectedId ||
          (matchesFilter(station) && matchesQuery(station)),
      )
      .sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name);
        if (sort === "capacity") {
          return (
            (right.capacity ?? 0) - (left.capacity ?? 0) ||
            distanceMiles(left) - distanceMiles(right)
          );
        }
        if (sort === "power") {
          return (
            maximumPower(right) - maximumPower(left) ||
            distanceMiles(left) - distanceMiles(right)
          );
        }
        return distanceMiles(left) - distanceMiles(right);
      });
  }, [filter, query, selectedId, sort, stations]);

  const counts: Record<StationFilter, number> = {
    all: stations.length,
    tesla: stations.filter(
      (station) => station.networkKind === "tesla-supercharger",
    ).length,
    "dc-fast": stations.filter((station) =>
      station.networkKind !== "tesla-supercharger" &&
      station.chargingSpeeds?.includes("dc-fast"),
    ).length,
    "level-2": stations.filter((station) =>
      station.chargingSpeeds?.includes("level-2"),
    ).length,
    campus: stations.filter((station) => station.campusLocation).length,
    public: stations.filter(
      (station) =>
        !station.campusLocation &&
        station.networkKind !== "tesla-supercharger",
    ).length,
  };

  return (
    <section className={styles.panel} aria-label="校园附近充电站">
      <div className={styles.panelHeader}>
        <div className={styles.heading}>
          <div>
            <small>EV CHARGING</small>
            <h2>校园附近充电站</h2>
            <p>
              浏览器优先直连官方 GET；失败时自动切换同源代理，并单独标注实时、缓存或快照。
            </p>
          </div>
          {onToggleMap && (
            <button type="button" onClick={onToggleMap} aria-pressed={mapVisible}>
              <Icon icon={mapVisible ? "solar:map-bold" : "solar:map-linear"} />
              {mapVisible ? "地图已显示" : "显示在地图"}
            </button>
          )}
        </div>

        <div className={styles.filters} role="tablist" aria-label="充电站类型">
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={filter === option.id ? styles.activeFilter : undefined}
              onClick={() => setFilter(option.id)}
              role="tab"
              aria-selected={filter === option.id}
            >
              {option.label}
              <span>{counts[option.id]}</span>
            </button>
          ))}
        </div>

        <div className={styles.listTools}>
          <label className={styles.searchField}>
            <Icon icon="solar:magnifer-linear" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索站名、地址或运营商"
              aria-label="搜索充电站"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清空搜索"
              >
                <Icon icon="solar:close-circle-bold" />
              </button>
            )}
          </label>
          <label className={styles.sortField}>
            <Icon icon="solar:sort-vertical-linear" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as StationSort)}
              aria-label="充电站排序"
            >
              <option value="distance">距校园最近</option>
              <option value="power">功率最高</option>
              <option value="capacity">端口最多</option>
              <option value="name">名称 A–Z</option>
            </select>
          </label>
        </div>

        <UpstreamHealth upstreams={upstreams} />

        {(warning || error) && (
          <details className={error ? styles.errorNotice : styles.warningNotice}>
            <summary>
              <Icon
                icon={
                  error
                    ? "solar:danger-triangle-bold"
                    : "solar:info-circle-bold"
                }
              />
              <span>{error ? "公共站点读取受限" : "部分详情已安全降级"}</span>
              <Icon icon="solar:alt-arrow-down-linear" />
            </summary>
            <p>{error ?? warning}</p>
            {upstreams.length > 0 && (
              <ul className={styles.diagnosticList}>
                {upstreams.map((diagnostic, index) => (
                  <li key={`${diagnostic.service}-${diagnostic.stationId ?? "all"}-${diagnostic.transport}-${index}`}>
                    <strong>{UPSTREAM_LABELS[diagnostic.service]}</strong>
                    <span>
                      {diagnostic.transport === "browser"
                        ? "浏览器"
                        : diagnostic.transport === "server"
                          ? "服务器"
                          : "快照"}
                      {diagnostic.stationId ? ` · ${diagnostic.stationId}` : ""}
                      {diagnostic.status ? ` · HTTP ${diagnostic.status}` : ""}
                      {diagnostic.requestId
                        ? ` · ID ${diagnostic.requestId.slice(0, 8)}`
                        : ""}
                    </span>
                    <em>{diagnostic.message ?? (diagnostic.ok ? "成功" : "失败")}</em>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}

        <div className={styles.dataLine}>
          <span>
            {loading && stations.length === 0
              ? "正在从浏览器读取充电网络…"
              : `${filteredStations.length} / ${stations.length} 个站点`}
          </span>
          {updatedAt && <span>数据 {formatTimestamp(updatedAt)}</span>}
        </div>
      </div>

      <div className={styles.stationList} ref={listRef}>
        {filteredStations.map((station) => {
          const expanded =
            expandedId === station.id ||
            (selectedId === station.id && collapsedSelectedId !== station.id);
          const distance = distanceMiles(station);
          const isTesla = station.networkKind === "tesla-supercharger";
          const cardClass =
            styles.stationCard +
            (expanded ? " " + styles.expandedCard : "");
          const iconClass =
            styles.networkIcon + (isTesla ? " " + styles.teslaIcon : "");
          return (
            <article
              key={station.id}
              className={cardClass}
              ref={(node) => {
                if (node) cardRefs.current.set(station.id, node);
                else cardRefs.current.delete(station.id);
              }}
            >
              <button
                type="button"
                className={styles.stationSummary}
                onClick={() => {
                  if (expanded) {
                    setExpandedId(undefined);
                    if (selectedId === station.id) {
                      setCollapsedSelectedId(station.id);
                    }
                  } else {
                    setExpandedId(station.id);
                    setCollapsedSelectedId(undefined);
                  }
                  onSelectStation?.(station);
                }}
                aria-expanded={expanded}
              >
                <span className={iconClass}>
                  {isTesla ? (
                    <Icon icon="simple-icons:tesla" />
                  ) : (
                    <Icon icon="solar:bolt-circle-bold-duotone" />
                  )}
                </span>
                <span className={styles.stationName}>
                  <small>
                    {station.campusLocation
                      ? "OSU 校内"
                      : station.operator ?? "公共充电站"}
                  </small>
                  <strong>{station.name}</strong>
                  <em>
                    {speedLabel(station)} · {distance.toFixed(1)} mi
                  </em>
                </span>
                <span className={styles.capacity}>
                  <strong>{station.capacity ?? "—"}</strong>
                  <small>端口</small>
                </span>
                <Icon
                  className={styles.chevron}
                  icon="solar:alt-arrow-down-linear"
                />
              </button>
              {expanded && <StationDetails station={station} />}
            </article>
          );
        })}
        {!loading && filteredStations.length === 0 && (
          <div className={styles.emptyState}>
            <Icon icon="solar:bolt-circle-linear" />
            <strong>此分类暂无站点</strong>
            <span>切换到“全部”查看其他充电类型。</span>
          </div>
        )}
      </div>
    </section>
  );
}
