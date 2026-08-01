"use client";

import { Icon } from "@iconify/react";

export function EvControl({
  enabled,
  stationCount,
  loading,
  onToggle,
}: {
  enabled: boolean;
  stationCount: number;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`map-layer-button${enabled ? " is-active" : ""}`}
      onClick={onToggle}
      aria-pressed={enabled}
    >
      <Icon icon="solar:bolt-circle-bold" />
      <span>
        <small>EV 图层</small>
        <strong>{loading ? "查找中" : `${stationCount} 个充电点`}</strong>
      </span>
      <i />
    </button>
  );
}
