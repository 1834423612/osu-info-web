"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type MapLayerSettingKey =
  | "chargingStations"
  | "permitAreas"
  | "parkingLocations"
  | "transitVehicles"
  | "transitRoutes"
  | "transitEndpoints"
  | "constructionImpacts";

export type MapLayerVisibility = Record<MapLayerSettingKey, boolean>;

export type MapLayerSettingItem = {
  id: MapLayerSettingKey;
  group: "parking" | "transit" | "campus";
  label: string;
  detail: string;
  icon: string;
  tone:
    | "green"
    | "scarlet"
    | "blue"
    | "orange"
    | "violet"
    | "navy"
    | "amber";
  visible: boolean;
  disabled?: boolean;
};

export function MapLayerSettingsDock({
  items,
  onChange,
  onChangeAll,
  children,
}: {
  items: readonly MapLayerSettingItem[];
  onChange: (id: MapLayerSettingKey, visible: boolean) => void;
  onChangeAll?: (visible: boolean) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const visibleCount = items.filter((item) => item.visible).length;
  const groupedItems = useMemo(
    () => [
      {
        id: "parking" as const,
        label: "地点与停车",
        items: items.filter((item) => item.group === "parking"),
      },
      {
        id: "transit" as const,
        label: "CABS 公交",
        items: items.filter((item) => item.group === "transit"),
      },
      {
        id: "campus" as const,
        label: "校园动态",
        items: items.filter((item) => item.group === "campus"),
      },
    ],
    [items],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => {
        toggleRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <aside
      className={cn(
        "parking-layer-dock",
        "map-layer-settings-dock",
        open && "is-open",
      )}
      aria-label="地图显示设置"
    >
      <button
        ref={toggleRef}
        type="button"
        className="parking-layer-dock__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="map-layer-settings-panel"
      >
        <span>
          <Icon icon="solar:tuning-square-2-bold-duotone" />
        </span>
        <span>
          <small>地图显示</small>
          <strong>
            {open
              ? "按需精简地图内容"
              : `${visibleCount} / ${items.length} 个图层`}
          </strong>
          {!open && (
            <span
              className="map-layer-settings__summary-icons"
              role="img"
              aria-label={items
                .map((item) => `${item.label}${item.visible ? "已显示" : "已隐藏"}`)
                .join("，")}
            >
              {items.map((item) => (
                <i
                  key={item.id}
                  aria-hidden="true"
                  className={cn(
                    `is-${item.tone}`,
                    item.visible ? "is-active" : "is-inactive",
                  )}
                  title={`${item.label}：${item.visible ? "已显示" : "已隐藏"}`}
                >
                  <Icon icon={item.icon} />
                </i>
              ))}
            </span>
          )}
        </span>
        <Icon
          icon={
            open
              ? "solar:minimize-square-2-linear"
              : "solar:maximize-square-3-linear"
          }
        />
      </button>

      {open && (
        <div className="parking-layer-dock__body" id="map-layer-settings-panel">
          <div className="map-layer-settings__intro">
            <span>
              <Icon icon="solar:eye-scan-bold-duotone" />
            </span>
            <p>
              <strong>只保留现在需要的信息</strong>
              <small>关闭图层不会清除筛选或线路选择。</small>
            </p>
            <div className="map-layer-settings__quick-actions">
              <button
                type="button"
                onClick={() => {
                  if (onChangeAll) onChangeAll(true);
                  else {
                    items
                      .filter((item) => !item.disabled && !item.visible)
                      .forEach((item) => onChange(item.id, true));
                  }
                }}
                disabled={items.every((item) => item.disabled || item.visible)}
              >
                全开
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onChangeAll) onChangeAll(false);
                  else {
                    items
                      .filter((item) => !item.disabled && item.visible)
                      .forEach((item) => onChange(item.id, false));
                  }
                }}
                disabled={items.every((item) => item.disabled || !item.visible)}
              >
                清空
              </button>
            </div>
          </div>
          {groupedItems.map((group) => (
            <section
              className="map-layer-settings__group"
              key={group.id}
              aria-label={group.label}
            >
              <h3>{group.label}</h3>
              <div className="map-layer-settings__list">
                {group.items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={cn(
                      "map-layer-setting",
                      `is-${item.tone}`,
                      item.visible && "is-active",
                    )}
                    onClick={() => onChange(item.id, !item.visible)}
                    aria-pressed={item.visible}
                    disabled={item.disabled}
                  >
                    <span className="map-layer-setting__icon">
                      <Icon icon={item.icon} />
                    </span>
                    <span className="map-layer-setting__copy">
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span
                      className="map-layer-setting__switch"
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {children && (
            <div className="map-layer-settings__details">
              <p>停车内容细分</p>
              {children}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
