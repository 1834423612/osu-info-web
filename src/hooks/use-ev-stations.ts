"use client";

import { useEffect, useState } from "react";

import {
  CAMPUS_EV_SEARCH,
  KNOWN_TESLA_LOCATIONS,
  latestStationUpdate,
  mergeCampusStations,
  mergeStationById,
  normalizeAfdcPayload,
} from "@/lib/ev-stations";
import { parseTeslaStation, teslaDetailsEndpoints } from "@/lib/tesla-ev";
import { teslaWestThirdSnapshot } from "@/lib/tesla-snapshot";
import type {
  EvStation,
  EvStationsResponse,
  EvUpstreamService,
  EvUpstreamStatus,
} from "@/types/ev";

const CACHE_KEY = "buckeye-parking:ev-stations:v6";
const REQUEST_GUARD_KEY = "buckeye-parking:ev-stations-request:v2";
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
const STALE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NLR_API_KEY =
  process.env.NEXT_PUBLIC_NLR_API_KEY ||
  process.env.NEXT_PUBLIC_NREL_API_KEY ||
  "DEMO_KEY";
const FAILED_REQUEST_COOLDOWN =
  NLR_API_KEY === "DEMO_KEY" ? 15 * 60 * 1000 : 60 * 1000;
const NLR_TIMEOUT_MS = 18_000;
const TESLA_TIMEOUT_MS = 15_000;
const PROXY_TIMEOUT_MS = 25_000;
const NLR_NEAREST_URL =
  "https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json";

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
  upstreams: EvUpstreamStatus[];
  requestOrigin?: EvStationsResponse["requestOrigin"];
};

type JsonFetchResult =
  | { ok: true; payload: unknown; diagnostic: EvUpstreamStatus }
  | { ok: false; diagnostic: EvUpstreamStatus };

type NlrStationsResult = {
  stations: EvStation[];
  upstreams: EvUpstreamStatus[];
  requestOrigin: "browser" | "mixed";
  warning?: string;
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
const UPSTREAM_SERVICES = new Set([
  "nlr",
  "tesla-charger",
  "tesla-location",
]);
const UPSTREAM_TRANSPORTS = new Set(["browser", "server", "snapshot"]);
const REQUEST_ORIGINS = new Set(["browser", "server", "mixed", "snapshot"]);

let refreshInFlight: Promise<EvStationsResponse> | undefined;

class EvDataError extends Error {
  upstreams: EvUpstreamStatus[];

  constructor(message: string, upstreams: EvUpstreamStatus[] = []) {
    super(message);
    this.name = "EvDataError";
    this.upstreams = upstreams;
  }
}

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

function isUpstreamStatus(value: unknown): value is EvUpstreamStatus {
  return (
    isRecord(value) &&
    typeof value.service === "string" &&
    UPSTREAM_SERVICES.has(value.service) &&
    typeof value.transport === "string" &&
    UPSTREAM_TRANSPORTS.has(value.transport) &&
    typeof value.ok === "boolean" &&
    typeof value.attemptedAt === "string" &&
    (value.status === undefined || typeof value.status === "number") &&
    (value.message === undefined || typeof value.message === "string")
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
    (value.requestOrigin === undefined ||
      (typeof value.requestOrigin === "string" &&
        REQUEST_ORIGINS.has(value.requestOrigin))) &&
    (value.upstreams === undefined ||
      (Array.isArray(value.upstreams) &&
        value.upstreams.every(isUpstreamStatus)))
  );
}

function readCache(maxAge = CACHE_MAX_AGE): CachedStations | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (
      !isRecord(parsed) ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > maxAge ||
      !isStationsResponse(parsed.payload)
    ) {
      console.warn("[EV] 已忽略过期或格式不兼容的浏览器缓存", {
        cacheKey: CACHE_KEY,
      });
      return null;
    }
    return { savedAt: parsed.savedAt, payload: parsed.payload };
  } catch (reason: unknown) {
    console.warn("[EV] 无法解析浏览器缓存", reason);
    return null;
  }
}

function writeCache(payload: EvStationsResponse) {
  const savedAt = Date.now();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ payload, savedAt }));
  } catch (reason: unknown) {
    console.warn("[EV] 无法写入浏览器缓存，当前结果仍可使用", reason);
  }
  return savedAt;
}

function readLastAttempt() {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(REQUEST_GUARD_KEY) ?? "null",
    );
    return isRecord(parsed) && typeof parsed.at === "number" ? parsed.at : 0;
  } catch (reason: unknown) {
    console.warn("[EV] 无法读取请求冷却记录", reason);
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
  } catch (reason: unknown) {
    console.warn("[EV] 无法写入请求冷却记录", reason);
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
    upstreams: payload.upstreams ?? [],
    requestOrigin: payload.requestOrigin,
  };
}

function localFallback(
  reason: string,
  upstreams: EvUpstreamStatus[] = [],
): EvStationsResponse {
  const stations = mergeCampusStations([teslaWestThirdSnapshot()]);
  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestStationUpdate(stations),
    isFallback: true,
    warning: `${reason}；当前仅显示 Ohio State 官方地点及 Tesla West 3rd 官方接口快照，均非实时。`,
    requestOrigin: "snapshot",
    upstreams,
  };
}

function diagnosticMessage(
  service: EvUpstreamService,
  status: number | undefined,
  reason?: string,
) {
  if (service === "nlr" && status === 429) {
    return "NLR/AFDC 浏览器请求触发速率限制（HTTP 429）";
  }
  if (service.startsWith("tesla") && status === 403) {
    return "Tesla Akamai/CORS 拒绝浏览器请求（HTTP 403）";
  }
  if (status !== undefined) return `${service} 浏览器 GET 返回 HTTP ${status}`;
  return `${service} 浏览器 GET 无法完成（${reason || "网络、DNS 或 CORS"}）`;
}

function logDiagnostic(diagnostic: EvUpstreamStatus, stationCount?: number) {
  const context = {
    service: diagnostic.service,
    transport: diagnostic.transport,
    ok: diagnostic.ok,
    status: diagnostic.status,
    stationId: diagnostic.stationId,
    durationMs: diagnostic.durationMs,
    cache: diagnostic.cache,
    requestId: diagnostic.requestId,
    message: diagnostic.message,
    ...(stationCount !== undefined ? { stationCount } : {}),
  };
  if (diagnostic.ok) console.info("[EV] 上游请求成功", context);
  else console.error("[EV] 上游请求失败", context);
}

async function browserJson(
  url: URL | string,
  service: EvUpstreamService,
  timeout: number,
  stationId?: string,
): Promise<JsonFetchResult> {
  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(timeout),
    });
    const base = {
      service,
      transport: "browser" as const,
      status: response.status,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      stationId,
      cache: "miss" as const,
    };
    if (!response.ok) {
      const diagnostic: EvUpstreamStatus = {
        ...base,
        ok: false,
        message: diagnosticMessage(service, response.status),
      };
      logDiagnostic(diagnostic);
      return { ok: false, diagnostic };
    }
    try {
      const payload: unknown = await response.json();
      const diagnostic: EvUpstreamStatus = { ...base, ok: true };
      return { ok: true, payload, diagnostic };
    } catch {
      const diagnostic: EvUpstreamStatus = {
        ...base,
        ok: false,
        message: `${service} 浏览器 GET 返回的内容不是有效 JSON`,
      };
      logDiagnostic(diagnostic);
      return { ok: false, diagnostic };
    }
  } catch (reason: unknown) {
    const detail = reason instanceof Error ? reason.message : "未知网络错误";
    const diagnostic: EvUpstreamStatus = {
      service,
      transport: "browser",
      ok: false,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      stationId,
      cache: "miss",
      message: diagnosticMessage(service, undefined, detail),
    };
    logDiagnostic(diagnostic);
    return { ok: false, diagnostic };
  }
}

async function proxyPayload(source: "nlr" | "tesla", stationId?: string) {
  const url = new URL("/api/ev/stations", window.location.origin);
  url.searchParams.set("source", source);
  if (stationId) url.searchParams.set("stationId", stationId);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    const raw: unknown = await response.json().catch(() => undefined);
    if (!isStationsResponse(raw)) {
      throw new EvDataError(
        `EV 同源代理返回了无法识别的响应（HTTP ${response.status}）`,
      );
    }
    const upstreams = (raw.upstreams ?? []).map((diagnostic) => ({
      ...diagnostic,
      requestId: diagnostic.requestId ?? raw.requestId,
    }));
    const payload = { ...raw, upstreams };
    upstreams.forEach((diagnostic) => logDiagnostic(diagnostic));
    if (!response.ok) {
      throw new EvDataError(
        raw.warning ?? `EV 同源代理返回 HTTP ${response.status}`,
        upstreams,
      );
    }
    console.info("[EV] 同源代理响应完成", {
      source,
      stationId,
      requestId: raw.requestId,
      status: response.status,
      durationMs: Date.now() - startedAt,
      stationCount: raw.stations.length,
      requestOrigin: raw.requestOrigin,
    });
    return payload;
  } catch (reason: unknown) {
    if (reason instanceof EvDataError) throw reason;
    const message =
      reason instanceof Error ? reason.message : "EV 同源代理网络错误";
    console.error("[EV] 同源代理请求失败", {
      source,
      stationId,
      durationMs: Date.now() - startedAt,
      message,
    });
    throw new EvDataError(`EV 同源代理失败（${message}）`);
  }
}

function nlrUrl() {
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
  return url;
}

async function fetchNlrStations(): Promise<NlrStationsResult> {
  const direct = await browserJson(nlrUrl(), "nlr", NLR_TIMEOUT_MS);
  if (direct.ok) {
    const stations = normalizeAfdcPayload(direct.payload);
    if (stations.length) {
      logDiagnostic(direct.diagnostic, stations.length);
      return {
        stations,
        upstreams: [direct.diagnostic],
        requestOrigin: "browser",
      };
    }
    direct.diagnostic.ok = false;
    direct.diagnostic.message =
      "NLR/AFDC 响应成功，但没有可解析的校园附近公开充电站";
    logDiagnostic(direct.diagnostic);
  }

  const directFailure = direct.diagnostic;
  console.warn("[EV] NLR 浏览器直连失败，切换同源 GET 代理", {
    status: directFailure.status,
    message: directFailure.message,
  });
  try {
    const proxied = await proxyPayload("nlr");
    if (!proxied.stations.length) {
      throw new EvDataError(
        proxied.warning ?? "NLR 同源代理未返回任何站点",
        proxied.upstreams,
      );
    }
    return {
      stations: proxied.stations,
      upstreams: [directFailure, ...(proxied.upstreams ?? [])],
      requestOrigin: "mixed",
      warning: proxied.warning,
    };
  } catch (reason: unknown) {
    const proxyError =
      reason instanceof EvDataError
        ? reason
        : new EvDataError("NLR 同源代理失败");
    throw new EvDataError(
      `NLR 浏览器直连与服务器代理均失败：${proxyError.message}`,
      [directFailure, ...proxyError.upstreams],
    );
  }
}

async function fetchTeslaDirect(baseStation: EvStation) {
  const identity = KNOWN_TESLA_LOCATIONS[baseStation.id];
  if (!identity) {
    return { station: baseStation, diagnostics: [] as EvUpstreamStatus[] };
  }
  const endpoints = teslaDetailsEndpoints(identity.locationSlug);
  const [charger, location] = await Promise.all([
    browserJson(
      endpoints.chargerDetails,
      "tesla-charger",
      TESLA_TIMEOUT_MS,
      baseStation.id,
    ),
    browserJson(
      endpoints.locationDetails,
      "tesla-location",
      TESLA_TIMEOUT_MS,
      baseStation.id,
    ),
  ]);
  const diagnostics = [charger.diagnostic, location.diagnostic];
  if (!charger.ok || !location.ok) return { diagnostics };
  try {
    const station = parseTeslaStation(
      charger.payload,
      location.payload,
      "live",
      new Date().toISOString(),
      { ...identity, baseStation },
    );
    diagnostics.forEach((diagnostic) => logDiagnostic(diagnostic));
    return { station, diagnostics };
  } catch (reason: unknown) {
    const detail = reason instanceof Error ? reason.message : "格式异常";
    const failed = diagnostics.map((diagnostic) => ({
      ...diagnostic,
      ok: false,
      message: `Tesla 两个 GET 成功，但详情解析失败（${detail}）`,
    }));
    failed.forEach((diagnostic) => logDiagnostic(diagnostic));
    return { diagnostics: failed };
  }
}

function mergeTeslaDetails(base: EvStation, enriched: EvStation): EvStation {
  return {
    ...base,
    ...enriched,
    id: base.id,
    sources: [
      ...enriched.sources,
      ...base.sources.filter(
        (source) =>
          !enriched.sources.some((current) => current.url === source.url),
      ),
    ],
  };
}

async function enrichTeslaStations(initialStations: EvStation[]) {
  const targets = initialStations.filter(
    (station) =>
      station.networkKind === "tesla-supercharger" &&
      Boolean(KNOWN_TESLA_LOCATIONS[station.id]),
  );
  const attempts = await Promise.all(
    targets.map(async (base) => {
      const direct = await fetchTeslaDirect(base);
      if (direct.station) {
        return {
          station: direct.station,
          diagnostics: direct.diagnostics,
          warning: undefined,
          usedProxy: false,
        };
      }

      console.warn("[EV] Tesla 浏览器直连失败，切换同源 GET 代理", {
        stationId: base.id,
        stationName: base.name,
      });
      let proxyDiagnostics: EvUpstreamStatus[] = [];
      let proxyWarning: string | undefined;
      try {
        const proxied = await proxyPayload("tesla", base.id);
        proxyDiagnostics = proxied.upstreams ?? [];
        proxyWarning = proxied.warning;
        const enriched = proxied.stations[0];
        if (enriched) {
          return {
            station: mergeTeslaDetails(base, enriched),
            diagnostics: [...direct.diagnostics, ...proxyDiagnostics],
            warning:
              enriched.teslaDetails?.dataState === "static-snapshot"
                ? `${base.name}：Tesla 官方 GET 被拒绝，已使用明确标注的官方接口快照。`
                : proxyWarning,
            usedProxy: true,
          };
        }
      } catch (reason: unknown) {
        if (reason instanceof EvDataError) {
          proxyDiagnostics = reason.upstreams;
          proxyWarning = reason.message;
        } else {
          proxyWarning = "Tesla 同源代理失败";
        }
      }

      if (base.id === "afdc-320148") {
        return {
          station: teslaWestThirdSnapshot(base),
          diagnostics: [...direct.diagnostics, ...proxyDiagnostics],
          warning: `${base.name}：${proxyWarning ?? "Tesla 官方 GET 当前不可读"}；使用官方接口快照，价格与拥挤度非实时。`,
          usedProxy: true,
        };
      }
      return {
        station: base,
        diagnostics: [...direct.diagnostics, ...proxyDiagnostics],
        warning: `${base.name}：${proxyWarning ?? "Tesla 官方 GET 当前不可读"}；保留本次 NLR 基础资料，不显示伪实时价格。`,
        usedProxy: true,
      };
    }),
  );

  let stations = initialStations;
  for (const attempt of attempts) {
    stations = mergeStationById(stations, attempt.station);
  }
  return {
    stations,
    upstreams: attempts.flatMap((attempt) => attempt.diagnostics),
    warnings: attempts
      .map((attempt) => attempt.warning)
      .filter((warning): warning is string => Boolean(warning)),
    usedProxy: attempts.some((attempt) => attempt.usedProxy),
  };
}

async function fetchFreshStations(): Promise<EvStationsResponse> {
  const nlr = await fetchNlrStations();
  const tesla = await enrichTeslaStations(nlr.stations);
  const stations = mergeCampusStations(tesla.stations);
  const warnings = [nlr.warning, ...tesla.warnings].filter(
    (warning): warning is string => Boolean(warning),
  );
  return {
    stations,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: latestStationUpdate(stations),
    isFallback: warnings.length > 0,
    ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    requestOrigin:
      nlr.requestOrigin === "mixed" || tesla.usedProxy ? "mixed" : "browser",
    upstreams: [...nlr.upstreams, ...tesla.upstreams],
  };
}

function refreshStations() {
  const freshCache = readCache();
  if (freshCache) return Promise.resolve(freshCache.payload);
  if (refreshInFlight) return refreshInFlight;

  const sinceLastAttempt = Date.now() - readLastAttempt();
  if (sinceLastAttempt < FAILED_REQUEST_COOLDOWN) {
    return Promise.reject(
      new EvDataError(
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
    upstreams: [],
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
        showPayload(await refreshStations());
      } catch (reason: unknown) {
        const message =
          reason instanceof Error ? reason.message : "充电站数据暂不可用";
        const upstreams =
          reason instanceof EvDataError ? reason.upstreams : ([] as EvUpstreamStatus[]);
        console.error("[EV] 充电站刷新最终失败", {
          message,
          upstreams,
        });
        const stale = readCache(STALE_CACHE_MAX_AGE);
        showPayload(
          stale
            ? {
                ...stale.payload,
                isFallback: true,
                warning: `${message}；当前继续显示浏览器中已缓存的数据，不会在冷却期内重复请求。`,
                upstreams:
                  upstreams.length > 0
                    ? upstreams
                    : stale.payload.upstreams,
              }
            : localFallback(message, upstreams),
          stale ? undefined : message,
        );
      }
    };

    const cached = readCache();
    if (cached) {
      console.info("[EV] 使用 6 小时浏览器缓存", {
        stationCount: cached.payload.stations.length,
        savedAt: new Date(cached.savedAt).toISOString(),
        requestOrigin: cached.payload.requestOrigin,
      });
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
