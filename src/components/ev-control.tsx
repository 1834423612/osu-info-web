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
        <small>附近 DC 快充</small>
        <strong>{loading ? "读取公共数据" : `${stationCount} 个快充站`}</strong>
      </span>
      <i />
    </button>
  );
}
