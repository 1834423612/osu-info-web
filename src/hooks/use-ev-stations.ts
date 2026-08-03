"use client";

import { useEffect, useState } from "react";

import teslaChargerSnapshot from "../../data-example/get-charger-details.json";
import teslaLocationSnapshot from "../../data-example/get-location-details.json";

import {
  CAMPUS_EV_SEARCH,
  KNOWN_TESLA_LOCATIONS,
  latestStationUpdate,
  mergeCampusStations,
  mergeStationById,
  normalizeAfdcPayload,
} from "@/lib/ev-stations";
import { parseTeslaStation, teslaDetailsEndpoints } from "@/lib/tesla-ev";
import type { EvStation, EvStationsResponse } from "@/types/ev";

const CACHE_KEY = "buckeye-parking:ev-stations:v4";
const REQUEST_GUARD_KEY = "buckeye-parking:ev-stations-request:v1";
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
const STALE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NLR_API_KEY =
  process.env.NEXT_PUBLIC_NLR_API_KEY ||
  process.env.NEXT_PUBLIC_NREL_API_KEY ||
  "DEMO_KEY";
const FAILED_REQUEST_COOLDOWN =
  NLR_API_KEY === "DEMO_KEY" ? 6 * 60 * 60 * 1000 : 15 * 60 * 1000;
const NLR_TIMEOUT_MS = 15_000;
const TESLA_TIMEOUT_MS = 12_000;
const NLR_NEAREST_URL =
  "https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json";
const SOURCE_CHECK_AT = "2026-08-01T00:00:00-04:00";

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

let refreshInFlight: Promise<EvStationsResponse> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStation(value: unknown): value is EvStation {
  if (!isRecord(value)) return false;
  const speedsAreValid =
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
    speedsAreValid &&
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
    (value.warning === undefined || typeof value.warning === "string") &&
    (value.requestOrigin === undefined || value.requestOrigin === "browser")
  );
}

function readCache(maxAge = CACHE_MAX_AGE): CachedStations | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (
      !isRecord(parsed) ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > maxAge ||
      !isStationsResponse(parsed.payload)
    ) {
      return null;
    }
    return { savedAt: parsed.savedAt, payload: parsed.payload };
  } catch {
    return null;
  }
}

function writeCache(payload: EvStationsResponse) {
  const savedAt = Date.now();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ payload, savedAt }));
  } catch {
    // The in-memory result remains usable when storage is disabled or full.
  }
  return savedAt;
}

function readLastAttempt() {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(REQUEST_GUARD_KEY) ?? "null",
    );
    return isRecord(parsed) && typeof parsed.at === "number" ? parsed.at : 0;
  } catch {
    return 0;
  }
}

function markRequestAttempt() {
  try {
    localStorage.setItem(
      REQUEST_GUARD_KEY,
      JSON.stringify({
        at: Date.now(),
        keyMode: NLR_API_KEY === "DEMO_KEY" ? "demo" : "configured",
      }),
    );
  } catch {
    // Same-page single-flight still prevents duplicate requests.
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

function staticWestThird(baseStation?: EvStation) {
  const identity = KNOWN_TESLA_LOCATIONS["afdc-320148"];
  return parseTeslaStation(
    teslaChargerSnapshot,
    teslaLocationSnapshot,
    "static-snapshot",
    SOURCE_CHECK_AT,
    { ...identity, baseStation },
  );
}

function localFallback(reason: string): EvStationsResponse {
  const stations = mergeCampusStations([staticWestThird()]);
  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestStationUpdate(stations),
    isFallback: true,
    warning: `${reason}；当前仅显示 Ohio State 官方地点及 Tesla West 3rd 官方接口快照，均非实时。`,
    requestOrigin: "browser",
  };
}

async function fetchNlrStations() {
  const url = new URL(NLR_NEAREST_URL);
  url.searchParams.set("api_key", NLR_API_KEY);
  url.searchParams.set("latitude", String(CAMPUS_EV_SEARCH.latitude));
  url.searchParams.set("longitude", String(CAMPUS_EV_SEARCH.longitude));
  url.searchParams.set("radius", String(CAMPUS_EV_SEARCH.radiusMiles));
  url.searchParams.set("fuel_type", "ELEC");
  url.searchParams.set("access", "public");
  url.searchParams.set("status", "E");
  url.searchParams.set("country", "US");
  url.searchParams.set("limit", "all");

  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(NLR_TIMEOUT_MS),
  });
  if (!response.ok) {
    const rateHint = response.status === 429 ? "，已触发上游速率限制" : "";
    throw new Error(`NLR/AFDC 浏览器请求失败（${response.status}${rateHint}）`);
  }
  const payload: unknown = await response.json();
  const stations = normalizeAfdcPayload(payload);
  if (!stations.length) {
    throw new Error("NLR/AFDC 未返回校园 5 英里内的公开充电站");
  }
  return stations;
}

async function fetchTeslaDetails(baseStation: EvStation) {
  const identity = KNOWN_TESLA_LOCATIONS[baseStation.id];
  if (!identity) return baseStation;
  const endpoints = teslaDetailsEndpoints(identity.locationSlug);
  const request = (url: string) =>
    fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(TESLA_TIMEOUT_MS),
    });
  const [chargerResponse, locationResponse] = await Promise.all([
    request(endpoints.chargerDetails),
    request(endpoints.locationDetails),
  ]);
  if (!chargerResponse.ok || !locationResponse.ok) {
    throw new Error(
      `充电 ${chargerResponse.status} / 位置 ${locationResponse.status}`,
    );
  }
  const [chargerPayload, locationPayload]: [unknown, unknown] =
    await Promise.all([chargerResponse.json(), locationResponse.json()]);
  return parseTeslaStation(
    chargerPayload,
    locationPayload,
    "live",
    new Date().toISOString(),
    { ...identity, baseStation },
  );
}

async function enrichTeslaStations(initialStations: EvStation[]) {
  const targets = initialStations.filter(
    (station) =>
      station.networkKind === "tesla-supercharger" &&
      Boolean(KNOWN_TESLA_LOCATIONS[station.id]),
  );
  const settled = await Promise.allSettled(targets.map(fetchTeslaDetails));
  let stations = initialStations;
  const failures: string[] = [];

  settled.forEach((result, index) => {
    const base = targets[index];
    if (result.status === "fulfilled") {
      stations = mergeStationById(stations, result.value);
      return;
    }
    const detail =
      result.reason instanceof Error ? result.reason.message : "网络/CORS 拒绝";
    failures.push(`${base.name}（${detail}）`);
    if (base.id === "afdc-320148") {
      stations = mergeStationById(stations, staticWestThird(base));
    }
  });

  return {
    stations,
    warning: failures.length
      ? `Tesla 两个官方详情/价格接口已使用浏览器 GET 直连，但被 Tesla Akamai/CORS 防护拒绝时浏览器无法读取响应（服务端实测为 403 且无 ACAO）。失败站点：${failures.join("、")}；West 3rd 价格和典型拥挤度使用官方快照并标为非实时，其余站点保留 NLR 实时查询结果。`
      : undefined,
  };
}

async function fetchFreshStations(): Promise<EvStationsResponse> {
  const nlrStations = await fetchNlrStations();
  const tesla = await enrichTeslaStations(nlrStations);
  const stations = mergeCampusStations(tesla.stations);
  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestStationUpdate(stations),
    isFallback: Boolean(tesla.warning),
    ...(tesla.warning ? { warning: tesla.warning } : {}),
    requestOrigin: "browser",
  };
}

function refreshBrowserStations() {
  const freshCache = readCache();
  if (freshCache) return Promise.resolve(freshCache.payload);
  if (refreshInFlight) return refreshInFlight;

  const sinceLastAttempt = Date.now() - readLastAttempt();
  if (sinceLastAttempt < FAILED_REQUEST_COOLDOWN) {
    return Promise.reject(
      new Error(
        `为遵守 NLR 速率限制，失败后 ${Math.ceil((FAILED_REQUEST_COOLDOWN - sinceLastAttempt) / 60_000)} 分钟内不重复请求`,
      ),
    );
  }

  markRequestAttempt();
  refreshInFlight = fetchFreshStations()
    .then((payload) => {
      writeCache(payload);
      return payload;
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

export function useEvStations() {
  const [state, setState] = useState<EvStationsState>({
    stations: [],
    loading: true,
    isFallback: false,
  });

  useEffect(() => {
    let active = true;
    let expiryTimer: number | undefined;

    const showPayload = (payload: EvStationsResponse, error?: string) => {
      if (active) setState(stateFromPayload(payload, error));
    };

    const refresh = async () => {
      if (active) {
        setState((current) => ({ ...current, loading: true, error: undefined }));
      }
      try {
        showPayload(await refreshBrowserStations());
      } catch (reason: unknown) {
        const message =
          reason instanceof Error ? reason.message : "充电站数据暂不可用";
        const stale = readCache(STALE_CACHE_MAX_AGE);
        showPayload(
          stale
            ? {
                ...stale.payload,
                isFallback: true,
                warning: `${message}；当前继续显示浏览器中已缓存的数据，不会在冷却期内重复请求。`,
              }
            : localFallback(message),
          stale ? undefined : message,
        );
      }
    };

    const cached = readCache();
    if (cached) {
      showPayload(cached.payload);
      expiryTimer = window.setTimeout(
        () => void refresh(),
        Math.max(1_000, CACHE_MAX_AGE - (Date.now() - cached.savedAt)),
      );
    } else {
      void refresh();
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CACHE_KEY) return;
      const shared = readCache();
      if (shared) showPayload(shared.payload);
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return state;
}
