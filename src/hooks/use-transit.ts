"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { decodePolyline } from "@/lib/polyline";
import { buildTransitRouteOverviews } from "@/lib/transit-map";
import type {
  TransitFeed,
  TransitRoute,
  TransitRouteDetail,
  TransitVehicle,
} from "@/types/transit";

const POLL_INTERVAL = 15_000;
const DETAIL_REFRESH_INTERVAL = 10 * 60_000;
const DETAIL_RETRY_DELAYS = [4_000, 12_000] as const;
const CORE_CABS_ROUTE_CODES = new Set(["BE", "CC", "CLS", "ER", "MC", "NWC"]);

type RouteResponse = {
  routes?: TransitRoute[];
  lastModified?: string;
};

type DetailResponse = TransitRouteDetail;

type VehicleResponse = {
  vehicles?: TransitVehicle[];
  lastModified?: string;
};

function hasRenderablePolyline(encodedPolyline: unknown) {
  if (typeof encodedPolyline !== "string" || !encodedPolyline) return false;
  try {
    const coordinates = decodePolyline(encodedPolyline);
    return (
      coordinates.length > 1 &&
      coordinates.every(
        ([longitude, latitude]) =>
          Number.isFinite(longitude) &&
          Number.isFinite(latitude) &&
          longitude >= -180 &&
          longitude <= 180 &&
          latitude >= -90 &&
          latitude <= 90,
      )
    );
  } catch {
    return false;
  }
}

export function useTransit(mapVisible: boolean) {
  // Data remains live for the route-list tab; this flag controls map layers in
  // the caller and intentionally no longer disables the feed itself.
  void mapVisible;
  const [routes, setRoutes] = useState<TransitRoute[]>([]);
  const [details, setDetails] = useState<Record<string, TransitRouteDetail>>({});
  const [vehicles, setVehicles] = useState<TransitVehicle[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [routeListError, setRouteListError] = useState<string>();
  const [routeDetailError, setRouteDetailError] = useState<string>();
  const [vehicleError, setVehicleError] = useState<string>();
  const detailsRef = useRef<Record<string, TransitRouteDetail>>({});

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/transit/routes", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`线路请求失败 (${response.status})`);
        return (await response.json()) as RouteResponse;
      })
      .then((payload) => {
        // The shared OSU feed also publishes medical-center shuttle services
        // such as WMC. This browser's CABS tab intentionally tracks the six
        // core campus routes requested by the user.
        const nextRoutes = Array.isArray(payload.routes)
          ? payload.routes.filter((route) =>
              typeof route?.code === "string" &&
              CORE_CABS_ROUTE_CODES.has(route.code.trim().toUpperCase()),
            )
          : [];
        setRoutes(nextRoutes);
        setActiveRoutes((current) =>
          current.length
            ? current
            : nextRoutes.filter((route) => route.showByDefault).map((route) => route.code),
        );
        setRouteListError(undefined);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRouteListError(
            reason instanceof Error ? reason.message : "CABS 线路暂不可用",
          );
        }
      });

    return () => controller.abort();
  }, []);

  const catalogRoutes = useMemo(
    () =>
      routes
        .map((route) => route.code.trim().toUpperCase())
        .filter(Boolean)
        .sort(),
    [routes],
  );
  const catalogKey = useMemo(() => catalogRoutes.join(","), [catalogRoutes]);

  useEffect(() => {
    if (!catalogKey) {
      const clearTimer = window.setTimeout(
        () => setRouteDetailError(undefined),
        0,
      );
      return () => window.clearTimeout(clearTimer);
    }
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const resetErrorTimer = window.setTimeout(
      () => setRouteDetailError(undefined),
      0,
    );
    const missing = catalogRoutes.filter((code) => !detailsRef.current[code]);

    const loadDetails = async (codes: string[], attempt: number) => {
      const results = await Promise.allSettled(
        codes.map(async (code) => {
          const response = await fetch(
            `/api/transit/routes/${encodeURIComponent(code)}`,
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!response.ok) {
            throw new Error(`${code}: ${response.status}`);
          }
          const payload = (await response.json()) as Partial<DetailResponse>;
          const patterns = Array.isArray(payload.patterns)
            ? payload.patterns.filter((pattern) =>
                hasRenderablePolyline(pattern?.encodedPolyline),
              )
            : [];
          if (typeof payload.code !== "string" || patterns.length === 0) {
            throw new Error(`${code}: invalid route geometry`);
          }
          return {
            code: payload.code,
            patterns,
            stops: Array.isArray(payload.stops) ? payload.stops : [],
            lastModified: payload.lastModified,
          } satisfies DetailResponse;
        }),
      );

      if (controller.signal.aborted) return;

      const loaded: DetailResponse[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value?.code) {
          loaded.push(result.value);
        } else {
          failed.push(codes[index]);
        }
      });

      if (loaded.length) {
        const next = { ...detailsRef.current };
        loaded.forEach((payload) => {
          next[payload.code] = payload;
        });
        detailsRef.current = next;
        setDetails(next);
      }

      if (!failed.length) {
        setRouteDetailError(undefined);
        return;
      }

      const retryDelay = DETAIL_RETRY_DELAYS[attempt];
      if (retryDelay !== undefined) {
        retryTimer = window.setTimeout(() => {
          void loadDetails(failed, attempt + 1);
        }, retryDelay);
        return;
      }

      setRouteDetailError(`部分 CABS 线路图暂不可用（${failed.join(" / ")}）`);
    };

    if (missing.length) void loadDetails(missing, 0);
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDetails(catalogRoutes, 0);
      }
    }, DETAIL_REFRESH_INTERVAL);

    return () => {
      controller.abort();
      window.clearTimeout(resetErrorTimer);
      window.clearInterval(refreshInterval);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [catalogKey, catalogRoutes]);

  useEffect(() => {
    if (!catalogKey) {
      const clearTimer = window.setTimeout(() => {
        setVehicles([]);
        setLastUpdated(undefined);
        setVehicleError(undefined);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }

    let disposed = false;
    let requestController: AbortController | undefined;
    const resetErrorTimer = window.setTimeout(
      () => setVehicleError(undefined),
      0,
    );

    const refreshVehicles = async () => {
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;

      try {
        const response = await fetch(
          `/api/transit/vehicles?routes=${encodeURIComponent(catalogKey)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(`车辆请求失败 (${response.status})`);
        const payload = (await response.json()) as VehicleResponse;
        if (disposed || controller.signal.aborted) return;
        setVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
        setLastUpdated(payload.lastModified);
        setVehicleError(undefined);
      } catch (reason) {
        if (disposed || controller.signal.aborted) return;
        setVehicleError(
          reason instanceof Error ? reason.message : "CABS 实时车辆暂不可用",
        );
      }
    };

    const initialRefresh = window.setTimeout(() => {
      void refreshVehicles();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshVehicles();
    }, POLL_INTERVAL);
    return () => {
      disposed = true;
      requestController?.abort();
      window.clearTimeout(resetErrorTimer);
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [catalogKey]);

  const toggleRoute = useCallback((code: string) => {
    setActiveRoutes((current) =>
      current.includes(code)
        ? current.filter((route) => route !== code)
        : [...current, code],
    );
  }, []);

  const feed: TransitFeed = {
    routes,
    details,
    vehicles,
    lastUpdated,
    error: routeListError ?? routeDetailError ?? vehicleError,
  };
  const routeOverviews = useMemo(
    () => buildTransitRouteOverviews({ routes, details, vehicles }),
    [details, routes, vehicles],
  );

  return {
    feed,
    routeOverviews,
    activeRoutes,
    toggleRoute,
    loading: routes.length === 0 && !routeListError,
  };
}
