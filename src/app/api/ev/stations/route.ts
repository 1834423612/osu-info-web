import { NextRequest, NextResponse } from "next/server";

import {
  CAMPUS_EV_SEARCH,
  KNOWN_TESLA_LOCATIONS,
  latestStationUpdate,
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NLR_NEAREST_URL =
  "https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json";
const NLR_CACHE_MS = 6 * 60 * 60 * 1000;
const NLR_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const TESLA_CACHE_MS = 15 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 18_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 90;
const DEFAULT_TESLA_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

type CacheEntry<T> = {
  value: T;
  savedAt: number;
  expiresAt: number;
  staleUntil: number;
};

type FetchResult =
  | { ok: true; payload: unknown; diagnostic: EvUpstreamStatus }
  | { ok: false; diagnostic: EvUpstreamStatus };

type NlrResult = {
  stations?: EvStation[];
  diagnostic: EvUpstreamStatus;
  stale?: boolean;
};

type TeslaResult = {
  station?: EvStation;
  diagnostics: EvUpstreamStatus[];
};

let nlrCache: CacheEntry<EvStation[]> | undefined;
let nlrInFlight: Promise<NlrResult> | undefined;
let nlrFailureUntil = 0;
let nlrLastFailure: EvUpstreamStatus | undefined;

const teslaCache = new Map<string, CacheEntry<EvStation>>();
const teslaInFlight = new Map<string, Promise<TeslaResult>>();
const teslaFailureUntil = new Map<
  string,
  { until: number; diagnostics: EvUpstreamStatus[] }
>();
const requestWindows = new Map<string, { count: number; startsAt: number }>();

function configuredNlrKey() {
  return (
    process.env.NLR_API_KEY ||
    process.env.NREL_API_KEY ||
    process.env.NEXT_PUBLIC_NLR_API_KEY ||
    process.env.NEXT_PUBLIC_NREL_API_KEY ||
    "DEMO_KEY"
  );
}

function nlrFailureCooldown(diagnostic: EvUpstreamStatus) {
  const base =
    diagnostic.status === 429 || diagnostic.failureKind === "rate-limit"
      ? 60 * 60 * 1000
      : 60 * 1000;
  return Math.max(base, (diagnostic.retryAfterSeconds ?? 0) * 1000);
}

function requestId() {
  return globalThis.crypto.randomUUID();
}

function clientAddress(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(request: NextRequest) {
  const now = Date.now();
  const key = clientAddress(request).slice(0, 96);
  const current = requestWindows.get(key);
  if (!current || now - current.startsAt >= RATE_WINDOW_MS) {
    requestWindows.set(key, { count: 1, startsAt: now });
    return false;
  }
  current.count += 1;
  if (requestWindows.size > 2_000) {
    for (const [address, entry] of requestWindows) {
      if (now - entry.startsAt >= RATE_WINDOW_MS) requestWindows.delete(address);
    }
  }
  return current.count > RATE_LIMIT;
}

function describeStatus(service: EvUpstreamService, status: number) {
  if (service === "nlr" && status === 429) {
    return "NLR/AFDC 已触发上游速率限制（HTTP 429）";
  }
  if (service.startsWith("tesla") && (status === 403 || status === 429)) {
    return `Tesla Akamai 边缘验证拒绝或限制了当前服务器/浏览器中继出口（HTTP ${status}）`;
  }
  return `${service} 上游返回 HTTP ${status}`;
}

function sanitizedFailureMessage(reason: unknown) {
  if (reason instanceof DOMException && reason.name === "TimeoutError") {
    return `请求超过 ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)} 秒`;
  }
  if (reason instanceof Error) return reason.message.slice(0, 220);
  return "未知网络错误";
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(raw);
  return Number.isNaN(at)
    ? undefined
    : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function trustedTeslaProxyUrl(upstream: URL | string) {
  const configured = process.env.TESLA_FETCH_PROXY_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost")
    ) {
      throw new Error("TESLA_FETCH_PROXY_URL 必须使用 HTTPS");
    }
    url.searchParams.set("url", String(upstream));
    return url;
  } catch (reason: unknown) {
    console.error("[EV proxy] Invalid TESLA_FETCH_PROXY_URL", {
      message: sanitizedFailureMessage(reason),
    });
    return undefined;
  }
}

function configuredTeslaBrowserUserAgent() {
  const configured = process.env.TESLA_BROWSER_USER_AGENT?.trim();
  return configured && !/[\r\n]/.test(configured)
    ? configured
    : DEFAULT_TESLA_BROWSER_USER_AGENT;
}

function teslaBrowserRequestHeaders(stationId: string) {
  const userAgent = configuredTeslaBrowserUserAgent();
  const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1];
  const platform = userAgent.includes("Windows")
    ? '"Windows"'
    : userAgent.includes("Macintosh")
      ? '"macOS"'
      : '"Linux"';

  return {
    Referer: KNOWN_TESLA_LOCATIONS[stationId].siteUrl,
    "User-Agent": userAgent,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": platform,
    ...(chromeVersion
      ? {
          "Sec-CH-UA":
            `"Not_A Brand";v="99", "Chromium";v="${chromeVersion}", ` +
            `"Google Chrome";v="${chromeVersion}"`,
        }
      : {}),
  };
}

async function fetchJson(
  url: URL | string,
  service: EvUpstreamService,
  stationId?: string,
): Promise<FetchResult> {
  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  const trustedProxy = stationId ? trustedTeslaProxyUrl(url) : undefined;
  try {
    const response = await fetch(trustedProxy ?? url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(stationId
          ? teslaBrowserRequestHeaders(stationId)
          : {
              "User-Agent":
                "Mozilla/5.0 (compatible; BuckeyeParking/1.0; +https://ttm.osu.edu/)",
            }),
        ...(trustedProxy && process.env.TESLA_FETCH_PROXY_TOKEN
          ? {
              Authorization: `Bearer ${process.env.TESLA_FETCH_PROXY_TOKEN}`,
            }
          : {}),
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      const requestedCooldown = retryAfterSeconds(response);
      return {
        ok: false,
        diagnostic: {
          service,
          transport: "server",
          ok: false,
          status: response.status,
          attemptedAt,
          durationMs,
          stationId,
          cache: "miss",
          ...(requestedCooldown !== undefined
            ? { retryAfterSeconds: requestedCooldown }
            : {}),
          ...(service.startsWith("tesla") &&
          (response.status === 403 || response.status === 429)
            ? { failureKind: "edge-challenge" as const }
            : service === "nlr" && response.status === 429
              ? { failureKind: "rate-limit" as const }
              : {}),
          message: trustedProxy
            ? `配置的 Tesla 受信任出口失败：${describeStatus(service, response.status)}`
            : describeStatus(service, response.status),
        },
      };
    }
    try {
      const payload: unknown = await response.json();
      return {
        ok: true,
        payload,
        diagnostic: {
          service,
          transport: "server",
          ok: true,
          status: response.status,
          attemptedAt,
          durationMs,
          stationId,
          cache: "miss",
          ...(trustedProxy
            ? { message: "已通过配置的 Tesla 受信任出口获取" }
            : {}),
        },
      };
    } catch {
      const isTeslaChallengeHtml =
        service.startsWith("tesla") &&
        response.headers.get("content-type")?.includes("text/html");
      return {
        ok: false,
        diagnostic: {
          service,
          transport: "server",
          ok: false,
          status: response.status,
          attemptedAt,
          durationMs,
          stationId,
          cache: "miss",
          failureKind: isTeslaChallengeHtml
            ? "edge-challenge"
            : "invalid-response",
          message: isTeslaChallengeHtml
            ? "Tesla Akamai 边缘验证返回了 HTML 挑战页，而不是官方详情 JSON"
            : `${service} 返回的内容不是有效 JSON`,
        },
      };
    }
  } catch (reason: unknown) {
    return {
      ok: false,
      diagnostic: {
        service,
        transport: "server",
        ok: false,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        stationId,
        cache: "miss",
        failureKind: "network",
        message: sanitizedFailureMessage(reason),
      },
    };
  }
}

function nlrUrl() {
  const url = new URL(NLR_NEAREST_URL);
  url.searchParams.set("api_key", configuredNlrKey());
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

async function requestNlrUpstream(): Promise<NlrResult> {
  const fetched = await fetchJson(nlrUrl(), "nlr");
  if (!fetched.ok) return { diagnostic: fetched.diagnostic };
  const stations = normalizeAfdcPayload(fetched.payload);
  if (!stations.length) {
    return {
      diagnostic: {
        ...fetched.diagnostic,
        ok: false,
        message: "NLR/AFDC 响应成功，但没有可解析的校园附近公开充电站",
      },
    };
  }
  const now = Date.now();
  nlrCache = {
    value: stations,
    savedAt: now,
    expiresAt: now + NLR_CACHE_MS,
    staleUntil: now + NLR_STALE_MS,
  };
  nlrFailureUntil = 0;
  nlrLastFailure = undefined;
  return { stations, diagnostic: fetched.diagnostic };
}

async function getNlrStations(): Promise<NlrResult> {
  const now = Date.now();
  if (nlrCache && nlrCache.expiresAt > now) {
    return {
      stations: nlrCache.value,
      diagnostic: {
        service: "nlr",
        transport: "server",
        ok: true,
        status: 200,
        attemptedAt: new Date(nlrCache.savedAt).toISOString(),
        cache: "fresh",
        message: "服务器 6 小时缓存命中",
      },
    };
  }
  if (nlrFailureUntil > now && nlrLastFailure) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((nlrFailureUntil - now) / 1000),
    );
    if (nlrCache && nlrCache.staleUntil > now) {
      return {
        stations: nlrCache.value,
        stale: true,
        diagnostic: {
          ...nlrLastFailure,
          cache: "stale",
          retryAfterSeconds,
          message: `${nlrLastFailure.message ?? "NLR 请求失败"}；服务器返回最近一次可用缓存`,
        },
      };
    }
    return {
      diagnostic: {
        ...nlrLastFailure,
        retryAfterSeconds,
        message: `${nlrLastFailure.message ?? "NLR 请求失败"}；服务器正按上游限流窗口冷却，避免重复请求`,
      },
    };
  }
  if (!nlrInFlight) {
    nlrInFlight = requestNlrUpstream()
      .then((result) => {
        if (!result.stations) {
          const now = Date.now();
          const cooldown = nlrFailureCooldown(result.diagnostic);
          const diagnostic: EvUpstreamStatus = {
            ...result.diagnostic,
            ...(result.diagnostic.status === 429 ||
            result.diagnostic.failureKind === "rate-limit"
              ? { retryAfterSeconds: Math.ceil(cooldown / 1000) }
              : {}),
          };
          nlrLastFailure = diagnostic;
          nlrFailureUntil = now + cooldown;
          if (nlrCache && nlrCache.staleUntil > Date.now()) {
            return {
              stations: nlrCache.value,
              stale: true,
              diagnostic: {
                ...diagnostic,
                cache: "stale" as const,
                message: `${diagnostic.message ?? "NLR 请求失败"}；服务器返回最近一次可用缓存`,
              },
            };
          }
          return { diagnostic };
        }
        return result;
      })
      .finally(() => {
        nlrInFlight = undefined;
      });
  }
  return nlrInFlight;
}

async function requestTeslaUpstream(stationId: string): Promise<TeslaResult> {
  const identity = KNOWN_TESLA_LOCATIONS[stationId];
  const endpoints = teslaDetailsEndpoints(identity.locationSlug);
  const [charger, location] = await Promise.all([
    fetchJson(endpoints.chargerDetails, "tesla-charger", stationId),
    fetchJson(endpoints.locationDetails, "tesla-location", stationId),
  ]);
  const diagnostics = [charger.diagnostic, location.diagnostic];
  if (!charger.ok || !location.ok) return { diagnostics };
  try {
    const parsed = parseTeslaStation(
      charger.payload,
      location.payload,
      "live",
      new Date().toISOString(),
      identity,
    );
    const station = { ...parsed, id: stationId };
    const now = Date.now();
    teslaCache.set(stationId, {
      value: station,
      savedAt: now,
      expiresAt: now + TESLA_CACHE_MS,
      staleUntil: now + 24 * 60 * 60 * 1000,
    });
    teslaFailureUntil.delete(stationId);
    return { station, diagnostics };
  } catch (reason: unknown) {
    const message = `Tesla 两个 GET 均响应成功，但详情解析失败：${sanitizedFailureMessage(reason)}`;
    return {
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        ok: false,
        message,
      })),
    };
  }
}

async function getTeslaStation(stationId: string): Promise<TeslaResult> {
  const now = Date.now();
  const cached = teslaCache.get(stationId);
  if (cached && cached.expiresAt > now) {
    return {
      station: cached.value,
      diagnostics: (["tesla-charger", "tesla-location"] as const).map(
        (service) => ({
          service,
          transport: "server",
          ok: true,
          status: 200,
          stationId,
          attemptedAt: new Date(cached.savedAt).toISOString(),
          cache: "fresh",
          message: "服务器 15 分钟缓存命中",
        }),
      ),
    };
  }
  const recentFailure = teslaFailureUntil.get(stationId);
  if (recentFailure && recentFailure.until > now) {
    if (cached && cached.staleUntil > now) {
      return {
        station: cached.value,
        diagnostics: recentFailure.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          cache: "stale",
          message: `${diagnostic.message ?? "Tesla 请求失败"}；服务器返回最近一次可用缓存`,
        })),
      };
    }
    return { diagnostics: recentFailure.diagnostics };
  }
  const existing = teslaInFlight.get(stationId);
  if (existing) return existing;
  const pending = requestTeslaUpstream(stationId)
    .then((result) => {
      if (!result.station) {
        teslaFailureUntil.set(stationId, {
          until: Date.now() + 2 * 60 * 1000,
          diagnostics: result.diagnostics,
        });
        if (cached && cached.staleUntil > Date.now()) {
          return {
            station: cached.value,
            diagnostics: result.diagnostics.map((diagnostic) => ({
              ...diagnostic,
              cache: "stale" as const,
            })),
          };
        }
      }
      return result;
    })
    .finally(() => {
      teslaInFlight.delete(stationId);
    });
  teslaInFlight.set(stationId, pending);
  return pending;
}

function json(
  payload: EvStationsResponse,
  status: number,
  id: string,
  source: string,
) {
  const retryAfter = payload.upstreams
    ?.filter(
      (diagnostic) =>
        diagnostic.status === 429 &&
        diagnostic.retryAfterSeconds !== undefined,
    )
    .reduce(
      (longest, diagnostic) =>
        Math.max(longest, diagnostic.retryAfterSeconds ?? 0),
      0,
    );
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control":
        status === 200 && payload.requestOrigin !== "snapshot"
          ? source === "nlr"
            ? "public, s-maxage=21600, stale-while-revalidate=86400"
            : "public, s-maxage=900, stale-while-revalidate=3600"
          : "no-store",
      "X-EV-Request-Id": id,
      "X-EV-Source": source,
      "X-EV-Upstream-State":
        status === 200 && !payload.isFallback ? "success" : "degraded",
      ...(status === 429 && retryAfter
        ? { "Retry-After": String(retryAfter) }
        : {}),
    },
  });
}

export async function GET(request: NextRequest) {
  const id = requestId();
  const source = request.nextUrl.searchParams.get("source") ?? "nlr";
  if (isRateLimited(request)) {
    return NextResponse.json(
      {
        stations: [],
        generatedAt: new Date().toISOString(),
        isFallback: true,
        warning: "EV 同源代理请求过于频繁，请在 60 秒后重试。",
        requestOrigin: "server",
        requestId: id,
      } satisfies EvStationsResponse,
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
          "X-EV-Request-Id": id,
        },
      },
    );
  }

  if (source === "nlr") {
    const result = await getNlrStations();
    if (!result.stations) {
      console.error("[EV proxy] NLR request failed", {
        requestId: id,
        status: result.diagnostic.status,
        retryAfterSeconds: result.diagnostic.retryAfterSeconds,
        message: result.diagnostic.message,
      });
      return json(
        {
          stations: [],
          generatedAt: new Date().toISOString(),
          isFallback: true,
          warning: result.diagnostic.message ?? "NLR/AFDC 服务器代理失败",
          requestOrigin: "server",
          upstreams: [result.diagnostic],
          requestId: id,
        },
        result.diagnostic.status === 429 ? 429 : 502,
        id,
        source,
      );
    }
    if (result.stale) {
      console.warn("[EV proxy] NLR stale cache used", {
        requestId: id,
        status: result.diagnostic.status,
        message: result.diagnostic.message,
      });
    } else {
      console.info("[EV proxy] NLR stations ready", {
        requestId: id,
        count: result.stations.length,
        cache: result.diagnostic.cache,
      });
    }
    return json(
      {
        stations: result.stations,
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: latestStationUpdate(result.stations),
        isFallback: Boolean(result.stale),
        ...(result.stale
          ? { warning: result.diagnostic.message ?? "正在使用 NLR 最近缓存" }
          : {}),
        requestOrigin: "server",
        upstreams: [result.diagnostic],
        requestId: id,
      },
      200,
      id,
      source,
    );
  }

  if (source === "tesla") {
    const stationId = request.nextUrl.searchParams.get("stationId") ?? "";
    if (!KNOWN_TESLA_LOCATIONS[stationId]) {
      return NextResponse.json(
        {
          stations: [],
          generatedAt: new Date().toISOString(),
          isFallback: true,
          warning: "未知 Tesla 站点；代理仅允许应用内的官方站点白名单。",
          requestOrigin: "server",
          requestId: id,
        } satisfies EvStationsResponse,
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await getTeslaStation(stationId);
    if (!result.station) {
      console.error("[EV proxy] Tesla requests failed", {
        requestId: id,
        stationId,
        upstreams: result.diagnostics.map((diagnostic) => ({
          service: diagnostic.service,
          status: diagnostic.status,
          message: diagnostic.message,
        })),
      });
      const rawSnapshot =
        stationId === "afdc-320148" ? teslaWestThirdSnapshot() : undefined;
      const snapshot = rawSnapshot
        ? { ...rawSnapshot, id: stationId }
        : undefined;
      const failureMessages = [
        ...new Set(
          result.diagnostics
            .map((diagnostic) => diagnostic.message)
            .filter((message): message is string => Boolean(message)),
        ),
      ];
      return json(
        {
          stations: snapshot ? [snapshot] : [],
          generatedAt: new Date().toISOString(),
          sourceUpdatedAt: snapshot?.updatedAt,
          isFallback: true,
          warning: [
            ...failureMessages,
            snapshot
              ? "服务器已返回随应用发布的 Tesla 官方接口快照；不是当前价格或空闲状态。"
              : "该站没有可验证的 Tesla 官方详情快照，保留 NLR 基础资料。",
          ].join("；"),
          requestOrigin: snapshot ? "snapshot" : "server",
          upstreams: result.diagnostics,
          requestId: id,
        },
        200,
        id,
        source,
      );
    }
    console.info("[EV proxy] Tesla details ready", {
      requestId: id,
      stationId,
      cache: result.diagnostics[0]?.cache,
    });
    return json(
      {
        stations: [result.station],
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: result.station.updatedAt,
        isFallback: result.diagnostics.some(
          (diagnostic) => diagnostic.cache === "stale",
        ),
        requestOrigin: "server",
        upstreams: result.diagnostics,
        requestId: id,
      },
      200,
      id,
      source,
    );
  }

  return NextResponse.json(
    {
      stations: [],
      generatedAt: new Date().toISOString(),
      isFallback: true,
      warning: "source 仅支持 nlr 或 tesla。",
      requestOrigin: "server",
      requestId: id,
    } satisfies EvStationsResponse,
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
