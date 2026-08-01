"use client";

import { Icon } from "@iconify/react";

import {
  cn,
  formatNumber,
  occupancyLabel,
  occupancyLevel,
} from "@/lib/utils";
import type { ParkingLocation } from "@/types/parking";

function accessLabel(type: number) {
  if (type === 2) return "停车证通行";
  if (type === 3) return "访客停车";
  return "访客 · 停车证";
}

export function ParkingCard({
  location,
  selected,
  onSelect,
  onToggleFavorite,
}: {
  location: ParkingLocation;
  selected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const level = occupancyLevel(location.UsePercentage);

  return (
    <article
      className={cn(
        "parking-card",
        selected && "parking-card--selected",
        location.Closed && "parking-card--closed",
      )}
    >
      <button
        type="button"
        className="parking-card__main"
        onClick={onSelect}
        aria-label={`查看 ${location.GarageName} 详情`}
      >
        <div className="parking-card__identity">
          <div className="min-w-0 flex-1">
            <div className="parking-card__title-row">
              <h3 className="truncate">{location.GarageName}</h3>
              {location.evCharging && (
                <span className="mini-tag mini-tag--ev" title="有校内充电位">
                  <Icon icon="solar:bolt-circle-bold" />
                  EV
                </span>
              )}
            </div>
            <p className="parking-card__meta truncate">
              <Icon
                icon={
                  location.kind === "surface"
                    ? "solar:map-point-bold"
                    : "solar:buildings-2-bold"
                }
              />
              {location.kind === "surface" ? "露天停车场" : "停车楼"}
              <span>·</span>
              {accessLabel(location.GarageType)}
            </p>
          </div>
        </div>

        <div className="parking-card__metrics">
          <div className="parking-card__available">
            <strong>{formatNumber(location.available)}</strong>
            <span>预计空位</span>
          </div>

          <div className="parking-card__occupancy">
            <span className="parking-card__occupancy-value">
              <strong>{Math.round(location.UsePercentage)}%</strong>
              <small>占用</small>
            </span>
            <span
              className={`parking-card__status availability-label level-${level}`}
            >
              <i />
              {occupancyLabel(location.UsePercentage, location.Closed)}
            </span>
          </div>

          <dl className="parking-card__totals">
            <div>
              <dt>已占</dt>
              <dd>{formatNumber(location.GarageCount)}</dd>
            </div>
            <div>
              <dt>总容量</dt>
              <dd>{formatNumber(location.GarageCapacity)}</dd>
            </div>
          </dl>
        </div>
      </button>

      <button
        type="button"
        className={cn(
          "parking-card__favorite",
          location.isFavorite && "is-active",
        )}
        onClick={onToggleFavorite}
        aria-label={location.isFavorite ? "从收藏移除" : "收藏此停车点"}
        aria-pressed={location.isFavorite}
      >
        <Icon
          icon={
            location.isFavorite
              ? "solar:star-bold"
              : "solar:star-linear"
          }
        />
      </button>
    </article>
  );
}
