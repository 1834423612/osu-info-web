"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef } from "react";

import {
  getFacilityNamesByGarageIds,
  PAID_OVERNIGHT_PARKING_GUIDANCE,
  PARKING_FACILITY_DATA_SOURCES,
  PARKING_RATE_PROFILES,
} from "@/data/parking-facilities";
import {
  CAMPUS_PARKING_ACCESS_WINDOWS,
  CAMPUS_PARKING_ZONE_GUIDE,
  classifyCampusParkingTime,
  getCurrentAccessSummary,
  getParkingTimeRangeZh,
  isPermitCode,
  OFFICIAL_PARKING_URLS,
} from "@/data/permits";
import { resolvePermitZones } from "@/lib/permit-map";
import { cn } from "@/lib/utils";

function periodIcon(period: (typeof CAMPUS_PARKING_ACCESS_WINDOWS)[number]["id"]) {
  if (period === "weekday-peak") return "solar:sun-2-bold-duotone";
  if (period === "weekday-off-peak") return "solar:sunset-bold-duotone";
  if (period === "weekend") return "solar:calendar-bold-duotone";
  if (period === "holiday") return "solar:confetti-bold-duotone";
  if (period === "overnight") return "solar:moon-stars-bold-duotone";
  return "solar:ticket-sale-bold-duotone";
}

function currentWindowId(time: ReturnType<typeof classifyCampusParkingTime>) {
  if (time.primary === "peak") return "weekday-peak";
  if (time.primary === "holiday") return "holiday";
  if (time.primary === "overnight") return "overnight";
  const weekendWindow =
    (time.campus.weekday === 5 && time.campus.minuteOfDay >= 16 * 60) ||
    time.campus.weekday === 0 ||
    time.campus.weekday === 6 ||
    (time.campus.weekday === 1 && time.campus.minuteOfDay < 3 * 60);
  return weekendWindow ? "weekend" : "weekday-off-peak";
}

export function ParkingAccessGuide({
  open,
  now,
  permitCode,
  permitLabel,
  onClose,
  onEditPermit,
}: {
  open: boolean;
  now: number;
  permitCode: string;
  permitLabel: string;
  onClose: () => void;
  onEditPermit: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const time = useMemo(() => classifyCampusParkingTime(now), [now]);
  const summary = useMemo(
    () =>
      isPermitCode(permitCode)
        ? getCurrentAccessSummary(permitCode, now)
        : undefined,
    [now, permitCode],
  );
  const currentZones = useMemo(
    () => new Set(summary ? resolvePermitZones(summary) : []),
    [summary],
  );
  const activeWindow = currentWindowId(time);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>('button[aria-label="关闭通行时段说明"]')
        ?.focus({ preventScroll: true });
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const noPermit = permitCode === "none";
  const visitor = permitCode === "visitor";
  const showPaidOvernightFallback =
    activeWindow === "overnight" &&
    !noPermit &&
    !visitor &&
    currentZones.size === 0;
  const paidAcademicGarages = getFacilityNamesByGarageIds(
    PAID_OVERNIGHT_PARKING_GUIDANCE.academicGarageIds,
  );
  const paidMedicalGarages = getFacilityNamesByGarageIds(
    PAID_OVERNIGHT_PARKING_GUIDANCE.medicalCenterGarageIds,
  );

  return (
    <div className="modal-layer access-guide-layer">
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        tabIndex={-1}
        aria-label="关闭通行时段说明"
      />
      <section
        ref={dialogRef}
        className="access-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-guide-title"
        tabIndex={-1}
      >
        <header className="access-guide__header">
          <div>
            <span className="eyebrow">CAMPUSPARC ACCESS GUIDE</span>
            <h2 id="access-guide-title">停车时段与字母区域</h2>
            <p>以下为 CampusParc 一般规则；现场标牌、封闭通知和活动地图始终优先。</p>
          </div>
          <button
            type="button"
            className="circle-button"
            onClick={onClose}
            aria-label="关闭通行时段说明"
          >
            <Icon icon="solar:close-circle-linear" />
          </button>
        </header>

        <div className="access-guide__body">
          <section className="access-guide-current">
            <span className="access-guide-current__icon">
              <Icon icon="solar:clock-circle-bold-duotone" />
            </span>
            <div>
              <small>当前 · Columbus 美东时间</small>
              <strong>{time.labelZh}</strong>
              <p>
                <b>{getParkingTimeRangeZh(time)}</b>
                <span>{permitLabel}</span>
              </p>
            </div>
            <button type="button" onClick={onEditPermit}>
              修改停车证
              <Icon icon="solar:alt-arrow-right-linear" />
            </button>
          </section>

          {showPaidOvernightFallback && (
            <section className="access-guide-paid-fallback" role="note">
              <header>
                <span>
                  <Icon icon="solar:moon-stars-bold-duotone" />
                </span>
                <div>
                  <small>停车证当前没有通用准停区</small>
                  <h3>仍可改用明确开放的访客付费停车</h3>
                  <p>
                    下列选项不是停车证权益；必须走访客入口或停入按小时位置并完成付款。
                  </p>
                </div>
              </header>
              <div className="access-guide-paid-fallback__groups">
                <article>
                  <b>Academic 24/7 访客车库</b>
                  <p>{paidAcademicGarages.join(" · ")}</p>
                  <span>
                    {PARKING_RATE_PROFILES["academic-garage"].startingRateZh} · 日上限 $
                    {PARKING_RATE_PROFILES["academic-garage"].dailyMaximumUsd}
                  </span>
                </article>
                <article>
                  <b>Medical Center 24/7 访客车库</b>
                  <p>{paidMedicalGarages.join(" · ")}</p>
                  <span>
                    {PARKING_RATE_PROFILES["medical-center-garage"].startingRateZh} · 日上限 $
                    {PARKING_RATE_PROFILES["medical-center-garage"].dailyMaximumUsd}
                  </span>
                </article>
                <article>
                  <b>明确标出的按小时地面位</b>
                  <p>{PAID_OVERNIGHT_PARKING_GUIDANCE.surfaceScopeZh}</p>
                  <span>
                    {PARKING_RATE_PROFILES["surface-hourly"].startingRateZh} · 非高峰上限 $
                    {PARKING_RATE_PROFILES["surface-hourly"].offPeakMaximumUsd}
                  </span>
                </article>
              </div>
              <footer>
                <p>
                  <Icon icon="solar:danger-triangle-bold-duotone" />
                  {PAID_OVERNIGHT_PARKING_GUIDANCE.warningZh}
                </p>
                <div>
                  <a
                    href={PARKING_FACILITY_DATA_SOURCES.visitorParking}
                    target="_blank"
                    rel="noreferrer"
                  >
                    官方访客费率
                    <Icon icon="solar:arrow-right-up-linear" />
                  </a>
                  <a
                    href={PARKING_FACILITY_DATA_SOURCES.lateNight}
                    target="_blank"
                    rel="noreferrer"
                  >
                    持证 late-night 区
                    <Icon icon="solar:arrow-right-up-linear" />
                  </a>
                </div>
              </footer>
            </section>
          )}

          <section className="access-guide-section">
            <div className="access-guide-section__title">
              <div>
                <small>OFFICIAL WINDOWS</small>
                <h3>所有相关停车时段</h3>
              </div>
              <a
                href={OFFICIAL_PARKING_URLS.offPeakRules}
                target="_blank"
                rel="noreferrer"
              >
                官方非高峰规则
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            </div>
            <div className="access-window-grid">
              {CAMPUS_PARKING_ACCESS_WINDOWS.map((window) => (
                <article
                  key={window.id}
                  className={cn(
                    "access-window-card",
                    `is-${window.tone}`,
                    window.id === activeWindow && "is-current",
                  )}
                >
                  <span>
                    <Icon icon={periodIcon(window.id)} />
                  </span>
                  <div>
                    <small>{window.timeZh}</small>
                    <h4>{window.titleZh}</h4>
                    <p>{window.summaryZh}</p>
                    <em>{window.restrictionsZh}</em>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="access-guide-section">
            <div className="access-guide-section__title">
              <div>
                <small>SPACE CATEGORIES</small>
                <h3>字母区域快速对比</h3>
              </div>
              <a
                href={OFFICIAL_PARKING_URLS.parkingDefinitions}
                target="_blank"
                rel="noreferrer"
              >
                官方停车定义
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            </div>
            <p className="access-zone-intro">
              状态按“{permitLabel}”和当前时段计算；只代表一般非保留地面位。
              Hourly、Reserved、ADA、State Vehicle 与 Loading Zone 始终按独立标牌执行。
            </p>
            <div className="access-zone-grid">
              {CAMPUS_PARKING_ZONE_GUIDE.map((zone) => {
                const isAvailable = currentZones.has(zone.code);
                const state = visitor
                  ? "visitor"
                  : noPermit
                    ? "unset"
                    : isAvailable
                      ? "available"
                      : "unavailable";
                return (
                  <article
                    key={zone.code}
                    className={`access-zone-card is-${zone.tone} state-${state}`}
                  >
                    <b>{zone.code}</b>
                    <div>
                      <small>{zone.locationZh}</small>
                      <h4>{zone.titleZh}</h4>
                      <p>{zone.requirementZh}</p>
                    </div>
                    <span>
                      <Icon
                        icon={
                          state === "available"
                            ? "solar:check-circle-bold"
                            : state === "visitor"
                              ? "solar:dollar-minimalistic-circle-bold"
                              : state === "unset"
                                ? "solar:question-circle-bold"
                                : "solar:close-circle-bold"
                        }
                      />
                      {state === "available"
                        ? "当前可用"
                        : state === "visitor"
                          ? "字母位非访客位"
                          : state === "unset"
                            ? "先设置证件"
                            : "当前不可用"}
                    </span>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="event-parking-alert">
            <span>
              <Icon icon="solar:ticket-sale-bold-duotone" />
            </span>
            <div>
              <small>活动时段可能改变日常权限</small>
              <h3>先看当次活动地图，再按现场入口行驶</h3>
              <ul>
                <li>日、数日及月度访客证不适用于活动停车。</li>
                <li>普通活动中，keycard 通常不开放活动车库；年证已有的普通车库权限除外。</li>
                <li>Global Event 可能扩大 keycard 范围；活动专用区仍须对应活动证。</li>
                <li>费率、入口、无免费再入场和散场后的追加计费均可能变化。</li>
              </ul>
            </div>
            <a
              href={OFFICIAL_PARKING_URLS.eventParking}
              target="_blank"
              rel="noreferrer"
            >
              查看官方活动规则
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
          </section>

          <nav className="access-guide-sources" aria-label="CampusParc 官方规则来源">
            <span>规则来源</span>
            <a
              href={OFFICIAL_PARKING_URLS.offPeakRules}
              target="_blank"
              rel="noreferrer"
            >
              非高峰时段
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
            <a
              href={OFFICIAL_PARKING_URLS.longTermLateNight}
              target="_blank"
              rel="noreferrer"
            >
              夜间与长期停车
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
            <a
              href={OFFICIAL_PARKING_URLS.parkingDefinitions}
              target="_blank"
              rel="noreferrer"
            >
              字母位定义
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
            <a
              href={OFFICIAL_PARKING_URLS.eventParking}
              target="_blank"
              rel="noreferrer"
            >
              活动停车
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
          </nav>
        </div>

        <footer className="access-guide__footer">
          <p>
            <Icon icon="solar:danger-triangle-linear" />
            这是规划提示，不替代现场标牌、车库入口读卡结果或 CampusParc 当日通知。
          </p>
          <button type="button" className="button button--primary" onClick={onClose}>
            我知道了
          </button>
        </footer>
      </section>
    </div>
  );
}
