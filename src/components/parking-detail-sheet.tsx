"use client";

import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";

import type { ParkingAccessPresentation } from "@/components/parking-card";
import { OccupancyRing } from "@/components/ui/occupancy-ring";
import { CABS_ROUTE_LABELS } from "@/data/parking-locations";
import { formatCampusModified } from "@/lib/parking-feed";
import {
  cn,
  directionsUrl,
  formatNumber,
  occupancyLabel,
} from "@/lib/utils";
import type { EvStation } from "@/types/ev";
import type { ParkingLocation } from "@/types/parking";

function accessText(type: number) {
  if (type === 2) {
    return {
      title: "当前仅显示停车证通行",
      detail: "访客入口通常不开放；请以入口提示及停车证具体权限为准。",
    };
  }
  if (type === 3) {
    return {
      title: "访客停车为主",
      detail: "此地点通常保留给访客或患者；停车证持有人可能受时段限制。",
    };
  }
  return {
    title: "访客与停车证入口开放",
    detail: "实时入口类型不等于你的停车证一定有效，请继续核对停车证规则。",
  };
}

function accessIcon(status: ParkingAccessPresentation["status"]) {
  if (status === "included") return "solar:shield-check-bold";
  if (status === "later") return "solar:clock-circle-bold";
  if (status === "visitor-paid") return "solar:wallet-money-bold";
  return "solar:forbidden-circle-bold";
}

export function ParkingDetailSheet({
  location,
  access,
  permitName,
  permitMessage,
  nearestFastCharger,
  escapeEnabled = true,
  onClose,
  onToggleFavorite,
}: {
  location?: ParkingLocation;
  access?: ParkingAccessPresentation;
  permitName: string;
  permitMessage: string;
  nearestFastCharger?: EvStation;
  escapeEnabled?: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const detailSheetRef = useRef<HTMLElement>(null);
  const [isModal, setIsModal] = useState(false);
  const locationId = location?.GarageId;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const syncMode = () => setIsModal(media.matches);
    const frame = window.requestAnimationFrame(syncMode);
    media.addEventListener("change", syncMode);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", syncMode);
    };
  }, []);

  useEffect(() => {
    if (!location || !escapeEnabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !isModal || !detailSheetRef.current) return;
      const focusable = Array.from(
        detailSheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (!detailSheetRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [escapeEnabled, isModal, location, onClose]);

  useEffect(() => {
    if (locationId === undefined) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) {
          previousFocus.focus({ preventScroll: true });
          return;
        }
        const fallbacks = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".parking-card__main, .map-workspace [role='region'], .permit-quick-button",
          ),
        );
        fallbacks
          .find((element) => element.getClientRects().length > 0)
          ?.focus({ preventScroll: true });
      });
    };
  }, [locationId]);

  if (!location) return null;

  const fallbackAccess = accessText(location.GarageType);

  return (
    <div className="detail-layer detail-layer--workspace">
      <button
        type="button"
        className="detail-backdrop"
        onClick={onClose}
        aria-label="关闭停车详情"
      />
      <aside
        ref={detailSheetRef}
        className="detail-sheet"
        role="dialog"
        aria-modal={isModal || undefined}
        aria-labelledby="parking-detail-title"
      >
        <div className="detail-sheet__handle" aria-hidden="true" />
        <header className="detail-sheet__hero">
          <div className="detail-sheet__hero-actions">
            <span className="detail-sheet__eyebrow">
              {location.kind === "surface" ? "SURFACE LOT" : "PARKING GARAGE"}
            </span>
            <div>
              <button
                type="button"
                className={cn(
                  "circle-button circle-button--glass",
                  location.isFavorite && "is-active",
                )}
                onClick={onToggleFavorite}
                aria-label={location.isFavorite ? "取消收藏" : "收藏"}
              >
                <Icon
                  icon={
                    location.isFavorite
                      ? "solar:star-bold"
                      : "solar:star-linear"
                  }
                />
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                className="circle-button circle-button--glass"
                onClick={onClose}
                aria-label="关闭"
              >
                <Icon icon="solar:close-circle-linear" />
              </button>
            </div>
          </div>

          <div className="detail-sheet__title-row">
            <div>
              <h2 id="parking-detail-title">{location.GarageName}</h2>
              <p>
                <Icon icon="solar:map-point-linear" />
                {location.address}
              </p>
            </div>
            <OccupancyRing percentage={location.UsePercentage} size={62} />
          </div>
        </header>

        <div className="detail-sheet__body">
          <section className="detail-availability">
            <div>
              <span>预计空位</span>
              <strong>{formatNumber(location.available)}</strong>
              <small>
                {occupancyLabel(location.UsePercentage, location.Closed)}
              </small>
            </div>
            <dl>
              <div>
                <dt>已占用</dt>
                <dd>{formatNumber(location.GarageCount)}</dd>
              </div>
              <div>
                <dt>总容量</dt>
                <dd>{formatNumber(location.GarageCapacity)}</dd>
              </div>
            </dl>
          </section>

          <section className="detail-section">
            <div className="detail-section__heading">
              <span className="section-icon section-icon--scarlet">
                <Icon icon="solar:key-square-2-bold" />
              </span>
              <div>
                <h3>通行判断</h3>
                <p>{permitName}</p>
              </div>
            </div>
            <div
              className={cn(
                "access-callout",
                access && `access-callout--${access.status}`,
              )}
            >
              <Icon
                icon={
                  access
                    ? accessIcon(access.status)
                    : "solar:verified-check-bold"
                }
              />
              <div>
                <strong>{access?.title ?? fallbackAccess.title}</strong>
                <p>
                  {access?.detail || permitMessage || fallbackAccess.detail}
                </p>
                {access?.nextAccessLabel && (
                  <span className="access-callout__next">
                    <Icon icon="solar:calendar-mark-bold" />
                    {access.nextAccessLabel}
                  </span>
                )}
              </div>
              {access?.requiresPayment && (
                <span className="access-callout__payment">需按访客标准付费</span>
              )}
            </div>
          </section>

          {(location.evCharging || nearestFastCharger) && (
            <section className="detail-section">
              <div className="detail-section__heading">
                <span className="section-icon section-icon--green">
                  <Icon icon="solar:bolt-circle-bold" />
                </span>
                <div>
                  <h3>EV 充电</h3>
                  <p>现场慢充与附近快充</p>
                </div>
              </div>
              <div className="detail-info-list">
                {location.evCharging && (
                  <div>
                    <Icon icon="solar:plug-circle-bold-duotone" />
                    <span>
                      <strong>此处有官方 Level 2 充电位</strong>
                      <small>ChargePoint 双枪；需同时满足该区域停车权限</small>
                    </span>
                  </div>
                )}
                {nearestFastCharger && (
                  <div>
                    <Icon
                      icon={
                        nearestFastCharger.networkKind ===
                        "tesla-supercharger"
                          ? "simple-icons:tesla"
                          : "solar:bolt-circle-bold-duotone"
                      }
                    />
                    <span>
                      <strong>{nearestFastCharger.name}</strong>
                      <small>
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
                          .join(" · ") || "附近直流快充"}
                      </small>
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {!!location.routeHints.length && (
            <section className="detail-section">
              <div className="detail-section__heading">
                <span className="section-icon section-icon--blue">
                  <Icon icon="solar:bus-bold" />
                </span>
                <div>
                  <h3>附近 CABS</h3>
                  <p>校园公交线路提示</p>
                </div>
              </div>
              <div className="route-pills">
                {location.routeHints.map((route) => (
                  <span key={route}>
                    <b>{route}</b>
                    {CABS_ROUTE_LABELS[
                      route as keyof typeof CABS_ROUTE_LABELS
                    ] ?? "校园线路"}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="detail-section detail-section--quiet">
            <div className="detail-section__heading">
              <span className="section-icon">
                <Icon icon="solar:refresh-circle-linear" />
              </span>
              <div>
                <h3>数据时间</h3>
                <p>{formatCampusModified(location.Modified)}</p>
              </div>
            </div>
            <p className="detail-note">
              空位是入口计数的估算值，可能有数分钟延迟。现场标牌、封闭通知和活动安排始终优先。
            </p>
          </section>
        </div>

        <footer className="detail-sheet__footer">
          <a
            className="button button--primary"
            href={directionsUrl(location.latitude, location.longitude)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon icon="solar:map-arrow-up-bold" />
            开始导航
          </a>
          <a
            className="button button--secondary"
            href={location.GarageUrl}
            target="_blank"
            rel="noreferrer"
          >
            官方详情
            <Icon icon="solar:arrow-right-up-linear" />
          </a>
        </footer>
      </aside>
    </div>
  );
}
