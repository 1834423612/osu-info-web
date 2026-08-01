"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  TransitFeed,
  TransitRoute,
  TransitRouteDetail,
  TransitVehicle,
} from "@/types/transit";

const POLL_INTERVAL = 15_000;

type RouteResponse = {
  routes?: TransitRoute[];
  lastModified?: string;
};

type DetailResponse = TransitRouteDetail;

type VehicleResponse = {
  vehicles?: TransitVehicle[];
  lastModified?: string;
};

export function useTransit(enabled: boolean) {
  const [routes, setRoutes] = useState<TransitRoute[]>([]);
  const [details, setDetails] = useState<Record<string, TransitRouteDetail>>({});
  const [vehicles, setVehicles] = useState<TransitVehicle[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
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
        const nextRoutes = Array.isArray(payload.routes) ? payload.routes : [];
        setRoutes(nextRoutes);
        setActiveRoutes((current) =>
          current.length
            ? current
            : nextRoutes.filter((route) => route.showByDefault).map((route) => route.code),
        );
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "CABS 线路暂不可用");
        }
      })

    return () => controller.abort();
  }, [enabled]);

  const activeKey = useMemo(
    () => [...activeRoutes].sort().join(","),
    [activeRoutes],
  );

  useEffect(() => {
    if (!enabled || !activeKey) return;
    const controller = new AbortController();
    const missing = activeRoutes.filter((code) => !details[code]);
    if (!missing.length) return;

    Promise.all(
      missing.map(async (code) => {
        const response = await fetch(`/api/transit/routes/${encodeURIComponent(code)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as DetailResponse;
      }),
    ).then((payloads) => {
      if (controller.signal.aborted) return;
      setDetails((current) => {
        const next = { ...current };
        payloads.forEach((payload) => {
          if (payload?.code) next[payload.code] = payload;
        });
        return next;
      });
    });

    return () => controller.abort();
  }, [activeKey, activeRoutes, details, enabled]);

  const refreshVehicles = useCallback(async () => {
    if (!enabled || !activeKey) {
      setVehicles([]);
      return;
    }

    try {
      const response = await fetch(
        `/api/transit/vehicles?routes=${encodeURIComponent(activeKey)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`车辆请求失败 (${response.status})`);
      const payload = (await response.json()) as VehicleResponse;
      setVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
      setLastUpdated(payload.lastModified);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "CABS 实时车辆暂不可用");
    }
  }, [activeKey, enabled]);

  useEffect(() => {
    if (!enabled || !activeKey) return;
    const initialRefresh = window.setTimeout(() => {
      void refreshVehicles();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshVehicles();
    }, POLL_INTERVAL);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [activeKey, enabled, refreshVehicles]);

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
    error,
  };

  return {
    feed,
    activeRoutes,
    toggleRoute,
    loading: enabled && routes.length === 0 && !error,
  };
}
