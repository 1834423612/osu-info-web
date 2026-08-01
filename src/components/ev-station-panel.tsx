"use client";

import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";

import styles from "@/components/ev-station-panel.module.css";
import type {
  EvPricePeriod,
  EvStation,
  EvTeslaPriceAudience,
} from "@/types/ev";

type StationFilter = "all" | "dc-fast" | "level-2" | "campus";

export type EvStationPanelProps = {
  stations: EvStation[];
  loading: boolean;
  error?: string;
  warning?: string;
  updatedAt?: string;
  selectedId?: string;
  onSelectStation?: (station: EvStation) => void;
  mapVisible?: boolean;
  onToggleMap?: () => void;
};

const CAMPUS_CENTER = { latitude: 40.0067, longitude: -83.0305 };
const FILTERS: Array<{ id: StationFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "dc-fast", label: "DC 快充" },
  { id: "level-2", label: "Level 2" },
  { id: "campus", label: "校内" },
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
  const source = station.sources[0];
  const sourceUrl = safeHttpsUrl(source?.url);
  const website = safeHttpsUrl(station.website);
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
      <TeslaPricing station={station} />
      <footer>
        <span>
          {station.availabilityIsRealtime
            ? "实时端口状态"
            : "未公开实时空闲端口"}
        </span>
        <div>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              数据来源
            </a>
          )}
          {website && website !== sourceUrl && (
            <a href={website} target="_blank" rel="noreferrer">
              运营商页面
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
  selectedId,
  onSelectStation,
  mapVisible,
  onToggleMap,
}: EvStationPanelProps) {
  const [filter, setFilter] = useState<StationFilter>("all");
  const [expandedId, setExpandedId] = useState<string | undefined>(selectedId);
  const sortedStations = useMemo(
    () =>
      [...stations].sort((left, right) => {
        if (left.campusLocation && !right.campusLocation) return -1;
        if (!left.campusLocation && right.campusLocation) return 1;
        return distanceMiles(left) - distanceMiles(right);
      }),
    [stations],
  );
  const filteredStations = sortedStations.filter((station) => {
    if (filter === "all") return true;
    if (filter === "campus") return Boolean(station.campusLocation);
    return station.chargingSpeeds?.includes(filter) ?? false;
  });
  const counts: Record<StationFilter, number> = {
    all: stations.length,
    "dc-fast": stations.filter((station) =>
      station.chargingSpeeds?.includes("dc-fast"),
    ).length,
    "level-2": stations.filter((station) =>
      station.chargingSpeeds?.includes("level-2"),
    ).length,
    campus: stations.filter((station) => station.campusLocation).length,
  };

  return (
    <section className={styles.panel} aria-label="校园附近充电站">
      <div className={styles.heading}>
        <div>
          <small>EV CHARGING</small>
          <h2>校园附近充电站</h2>
          <p>校内 Level 2 与周边公共充电站统一查看，费用和接口按来源分别标注。</p>
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

      {(warning || error) && (
        <div className={error ? styles.errorNotice : styles.warningNotice}>
          <Icon
            icon={
              error
                ? "solar:danger-triangle-bold"
                : "solar:info-circle-bold"
            }
          />
          <span>{error ?? warning}</span>
        </div>
      )}

      <div className={styles.dataLine}>
        <span>
          {loading && stations.length === 0
            ? "正在读取充电网络…"
            : filteredStations.length + " 个站点"}
        </span>
        {updatedAt && <span>数据 {formatTimestamp(updatedAt)}</span>}
      </div>

      <div className={styles.stationList}>
        {filteredStations.map((station) => {
          const expanded =
            expandedId === station.id || selectedId === station.id;
          const distance = distanceMiles(station);
          const isTesla = station.networkKind === "tesla-supercharger";
          const cardClass =
            styles.stationCard +
            (expanded ? " " + styles.expandedCard : "");
          const iconClass =
            styles.networkIcon + (isTesla ? " " + styles.teslaIcon : "");
          return (
            <article key={station.id} className={cardClass}>
              <button
                type="button"
                className={styles.stationSummary}
                onClick={() => {
                  setExpandedId((current) =>
                    current === station.id ? undefined : station.id,
                  );
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
