"use client";

import { useEffect, useState } from "react";

import type { EvStation } from "@/types/ev";

const CACHE_KEY = "buckeye-parking:ev-stations:v1";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const CAMPUS_CENTER = { latitude: 40.0067, longitude: -83.0305 };

type OverpassElement = {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type CachedStations = {
  savedAt: number;
  stations: EvStation[];
};

const fallbackTesla: EvStation = {
  id: "fallback-tesla-third",
  name: "Tesla Supercharger · Grandview Yard",
  latitude: 39.9859,
  longitude: -83.0252,
  address: "820 W 3rd Ave, Columbus",
  operator: "Tesla",
  capacity: 8,
  power: "最高约 250 kW",
  openingHours: "24/7",
  website: "https://www.tesla.com/findus",
  isTesla: true,
  source: "osm",
};

function readCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as
      | CachedStations
      | null;
    if (
      !parsed ||
      !Array.isArray(parsed.stations) ||
      Date.now() - parsed.savedAt > CACHE_MAX_AGE
    ) {
      return null;
    }
    return parsed.stations;
  } catch {
    return null;
  }
}

function toStation(element: OverpassElement): EvStation | null {
  const tags = element.tags ?? {};
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const operator = tags.operator ?? tags.brand ?? tags.network;
  const isTesla = /tesla/i.test(
    `${operator ?? ""} ${tags.name ?? ""} ${tags["socket:nacs"] ?? ""}`,
  );
  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const address = [street, tags["addr:city"]].filter(Boolean).join(", ");
  const power =
    tags["socket:nacs:output"] ??
    tags["socket:type2_combo:output"] ??
    tags["socket:type2:output"] ??
    tags.capacity;

  return {
    id: `${element.type}-${element.id}`,
    name: tags.name ?? `${operator ?? "公共"}充电站`,
    latitude,
    longitude,
    address: address || undefined,
    operator,
    capacity: tags.capacity ? Number(tags.capacity) || undefined : undefined,
    openingHours: tags.opening_hours,
    power,
    website: tags.website,
    isTesla,
    source: "osm",
  };
}

export function useEvStations(enabled: boolean) {
  const [stations, setStations] = useState<EvStation[]>(
    () => readCache() ?? [fallbackTesla],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    if (readCache()) return;

    const controller = new AbortController();
    const query = `[out:json][timeout:15];nwr["amenity"="charging_station"](around:16000,${CAMPUS_CENTER.latitude},${CAMPUS_CENTER.longitude});out center tags;`;
    const loadingFrame = window.requestAnimationFrame(() => setLoading(true));

    fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`充电站数据请求失败 (${response.status})`);
        return (await response.json()) as { elements?: OverpassElement[] };
      })
      .then((payload) => {
        const next = (payload.elements ?? [])
          .map(toStation)
          .filter((station): station is EvStation => station !== null);
        const useful = next.length ? next : [fallbackTesla];
        setStations(useful);
        setError(undefined);
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ stations: useful, savedAt: Date.now() }),
          );
        } catch {
          // Keep the in-memory result when browser storage is unavailable.
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "充电站数据暂不可用");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      window.cancelAnimationFrame(loadingFrame);
      controller.abort();
    };
  }, [enabled]);

  return { stations, loading, error };
}
