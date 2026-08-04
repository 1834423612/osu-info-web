"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  CampusImpactCollection,
  CampusImpactResponse,
} from "@/types/campus-gis";

const EMPTY_COLLECTION: CampusImpactCollection = {
  type: "FeatureCollection",
  features: [],
};

export function useCampusImpacts(enabled: boolean) {
  const [data, setData] = useState<CampusImpactCollection>(EMPTY_COLLECTION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setLoading(true);
      setError(undefined);
    });

    fetch("/api/campus/impacts", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as CampusImpactResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `校园影响请求失败 (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        window.cancelAnimationFrame(frame);
        setData(payload.data);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        window.cancelAnimationFrame(frame);
        const message = reason instanceof Error ? reason.message : "校园影响暂不可用";
        console.error("[OSU GIS] 校园施工影响读取失败", reason);
        setError(message);
        setLoading(false);
      });

    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [enabled, refreshKey]);

  return { data, loading, error, reload };
}
