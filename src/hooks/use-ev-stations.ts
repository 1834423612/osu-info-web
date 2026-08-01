"use client";

import { useEffect, useState } from "react";

import type { EvStation, EvStationsResponse } from "@/types/ev";

const CACHE_KEY = "buckeye-parking:ev-stations:v3";
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 15 * 60 * 1000;
const EV_STATIONS_ENDPOINT = "/api/ev/stations";

type CachedStations = {
  savedAt: number;
  payload: EvStationsResponse;
};

type EvStationsState = {
  stations: EvStation[];
  loading: boolean;
  error?: string;
  warning?: string;
  isFallback: boolean;
  updatedAt?: string;
};

const NETWORK_KINDS = new Set([
  "tesla-supercharger",
  "chargepoint",
  "electrify-america",
  "evgo",
  "other",
]);
const CHARGING_SPEEDS = new Set([
  "level-1",
  "level-2",
  "dc-fast",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStation(value: unknown): value is EvStation {
  if (!isRecord(value)) return false;

  const chargingSpeedsAreValid =
    value.chargingSpeeds === undefined ||
    (Array.isArray(value.chargingSpeeds) &&
      value.chargingSpeeds.every(
        (speed) => typeof speed === "string" && CHARGING_SPEEDS.has(speed),
      ));
  const teslaDetailsAreValid =
    value.teslaDetails === undefined ||
    (isRecord(value.teslaDetails) &&
      typeof value.teslaDetails.locationSlug === "string" &&
      (value.teslaDetails.dataState === "live" ||
        value.teslaDetails.dataState === "static-snapshot") &&
      typeof value.teslaDetails.fetchedAt === "string" &&
      Array.isArray(value.teslaDetails.pricing) &&
      Array.isArray(value.teslaDetails.amenities) &&
      isRecord(value.teslaDetails.congestionByDay));

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    typeof value.networkKind === "string" &&
    NETWORK_KINDS.has(value.networkKind) &&
    Array.isArray(value.connectors) &&
    typeof value.availabilityIsRealtime === "boolean" &&
    typeof value.status === "string" &&
    Array.isArray(value.sources) &&
    typeof value.isTesla === "boolean" &&
    typeof value.source === "string" &&
    chargingSpeedsAreValid &&
    teslaDetailsAreValid
  );
}

function isStationsResponse(value: unknown): value is EvStationsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.stations) &&
    value.stations.every(isStation) &&
    typeof value.generatedAt === "string" &&
    typeof value.isFallback === "boolean" &&
    (value.warning === undefined || typeof value.warning === "string")
  );
}

function readCache(): CachedStations | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(CACHE_KEY) ?? "null",
    );
    if (
      !isRecord(parsed) ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > CACHE_MAX_AGE ||
      !isStationsResponse(parsed.payload)
    ) {
      return null;
    }
    return { savedAt: parsed.savedAt, payload: parsed.payload };
  } catch {
    return null;
  }
}

function stateFromPayload(
  payload: EvStationsResponse,
  error?: string,
): EvStationsState {
  return {
    stations: payload.stations,
    loading: false,
    error,
    warning: payload.warning,
    isFallback: payload.isFallback,
    updatedAt: payload.sourceUpdatedAt ?? payload.generatedAt,
  };
}

export function useEvStations() {
  const [state, setState] = useState<EvStationsState>({
    stations: [],
    loading: false,
    isFallback: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    const cached = readCache();
    let latestFetchAt = cached?.savedAt ?? 0;
    let cacheRestoreFrame: number | undefined;
    let loadingFrame: number | undefined;
    let inFlight: Promise<void> | undefined;

    if (cached) {
      // Restore browser-only state after hydration so the server and first
      // client render both start from the same markup.
      cacheRestoreFrame = window.requestAnimationFrame(() => {
        if (!controller.signal.aborted) {
          setState(stateFromPayload(cached.payload));
        }
      });
    }

    const refresh = (showLoading = false) => {
      if (inFlight) return inFlight;

      if (showLoading) {
        loadingFrame = window.requestAnimationFrame(() => {
          setState((current) => ({
            ...current,
            loading: true,
            error: undefined,
          }));
        });
      }

      inFlight = (async () => {
        try {
          const response = await fetch(EV_STATIONS_ENDPOINT, {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          const payload: unknown = await response.json();

          if (!response.ok) {
            throw new Error(`充电站数据请求失败 (${response.status})`);
          }
          if (!isStationsResponse(payload)) {
            throw new Error("充电站数据格式异常");
          }

          latestFetchAt = Date.now();
          if (cacheRestoreFrame !== undefined) {
            window.cancelAnimationFrame(cacheRestoreFrame);
            cacheRestoreFrame = undefined;
          }
          setState(stateFromPayload(payload));
          try {
            localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({ payload, savedAt: latestFetchAt }),
            );
          } catch {
            // Keep the in-memory result when browser storage is unavailable.
          }
        } catch (reason: unknown) {
          if (!controller.signal.aborted) {
            setState((current) => ({
              ...current,
              loading: false,
              error:
                reason instanceof Error ? reason.message : "充电站数据暂不可用",
            }));
          }
        } finally {
          if (loadingFrame !== undefined) {
            window.cancelAnimationFrame(loadingFrame);
            loadingFrame = undefined;
          }
          if (!controller.signal.aborted) {
            setState((current) => ({ ...current, loading: false }));
          }
          inFlight = undefined;
        }
      })();

      return inFlight;
    };

    if (!cached || Date.now() - cached.savedAt >= REFRESH_INTERVAL) {
      void refresh(!cached);
    }

    // EV summary cards remain visible even when the map layer is hidden.
    const refreshTimer = window.setInterval(
      () => void refresh(),
      REFRESH_INTERVAL,
    );

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - latestFetchAt >= REFRESH_INTERVAL
      ) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (cacheRestoreFrame !== undefined) {
        window.cancelAnimationFrame(cacheRestoreFrame);
      }
      if (loadingFrame !== undefined) window.cancelAnimationFrame(loadingFrame);
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controller.abort();
    };
  }, []);

  return state;
}
