"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import fallbackStatus from "../../status-example.json";
import {
  GARAGE_API_URL,
  parseGarageResponse,
} from "@/lib/parking-feed";
import type {
  GarageApiResponse,
  ParkingFeedState,
} from "@/types/parking";

const CACHE_KEY = "buckeye-parking:garage-feed:v1";
const REFRESH_INTERVAL = 60_000;
const REQUEST_TIMEOUT = 12_000;

type CachedFeed = {
  savedAt: number;
  payload: GarageApiResponse;
};

type HookState = {
  data: GarageApiResponse;
  state: ParkingFeedState;
  fetchedAt?: number;
  error?: string;
};

const fallback = parseGarageResponse(fallbackStatus) ?? { Garages: [] };

function readCache(): CachedFeed | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as {
      savedAt?: unknown;
      payload?: unknown;
    } | null;
    const payload = parseGarageResponse(parsed?.payload);
    if (!payload || typeof parsed?.savedAt !== "number") return null;
    return { payload, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function useParkingStatus() {
  const [feed, setFeed] = useState<HookState>({
    data: fallback,
    state: "loading",
  });
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (background = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    if (!background) setRefreshing(true);

    try {
      const response = await fetch(GARAGE_API_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`CampusParc 返回 HTTP ${response.status}`);
      }

      const payload = parseGarageResponse(await response.json());
      if (!payload) throw new Error("CampusParc 数据结构不符合预期");

      const fetchedAt = Date.now();
      setFeed({ data: payload, state: "live", fetchedAt });
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ payload, savedAt: fetchedAt }),
        );
      } catch {
        // Browsing still works when storage is disabled or full.
      }
    } catch (error) {
      if (controller.signal.aborted && requestRef.current !== controller) return;
      setFeed((current) => ({
        ...current,
        state: current.fetchedAt ? "cached" : "error",
        error:
          error instanceof Error
            ? error.name === "AbortError"
              ? "实时数据请求超时"
              : error.message
            : "实时数据暂时不可用",
      }));
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
      if (!background) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setFeed({
        data: cached.payload,
        state: "cached",
        fetchedAt: cached.savedAt,
      });
    }

    void refresh(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, REFRESH_INTERVAL);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const handleOnline = () => void refresh(true);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      requestRef.current?.abort();
    };
  }, [refresh]);

  return { ...feed, refresh: () => refresh(false), refreshing };
}
