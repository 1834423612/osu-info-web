"use client";

import type { FeatureCollection } from "geojson";
import { useCallback, useEffect, useMemo, useState } from "react";

const emptyCollection: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

type PermitAreaRequestState = {
  zoneKey: string;
  data: FeatureCollection;
  loading: boolean;
  error?: string;
};

export function usePermitAreas(zones: readonly string[], enabled: boolean) {
  const [requestState, setRequestState] = useState<PermitAreaRequestState>({
    zoneKey: "",
    data: emptyCollection,
    loading: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const zoneKey = useMemo(
    () => Array.from(new Set(zones)).sort().join(","),
    [zones],
  );
  const reload = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !zoneKey) {
      const frame = window.requestAnimationFrame(() => {
        setRequestState((current) =>
          zoneKey && current.zoneKey === zoneKey
            ? { ...current, loading: false }
            : {
                zoneKey: "",
                data: emptyCollection,
                loading: false,
              },
        );
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setRequestState((current) => ({
        zoneKey,
        data: current.zoneKey === zoneKey ? current.data : emptyCollection,
        loading: true,
      }));
    });

    fetch(`/api/parking-areas?zones=${encodeURIComponent(zoneKey)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`停车区域请求失败 (${response.status})`);
        return (await response.json()) as FeatureCollection;
      })
      .then((payload) => {
        if (payload.type !== "FeatureCollection") {
          throw new Error("停车区域数据结构不符合预期");
        }
        if (controller.signal.aborted) return;
        window.cancelAnimationFrame(frame);
        setRequestState({
          zoneKey,
          data: payload,
          loading: false,
        });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          window.cancelAnimationFrame(frame);
          setRequestState({
            zoneKey,
            data: emptyCollection,
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "停车区域暂不可用",
          });
        }
      });

    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [enabled, refreshKey, zoneKey]);

  const isCurrentRequest = requestState.zoneKey === zoneKey;

  return {
    data:
      zoneKey && isCurrentRequest
        ? requestState.data
        : emptyCollection,
    loading:
      Boolean(enabled && zoneKey && isCurrentRequest) &&
      requestState.loading,
    error:
      enabled && zoneKey && isCurrentRequest
        ? requestState.error
        : undefined,
    reload,
  };
}
